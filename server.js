// =============================================================
// マッチング・チャットサーバー
// -------------------------------------------------------------
// モード:
//   personal … 部屋コードで2人がマッチング。音声通話+チャット
//   group    … 部屋コードで複数人が参加。テキストチャットのみ。
//              人数上限は、部屋を新規に作った人(最初の入室者)が指定
//   random   … コード不要。待機列から自動で2人組にする。音声通話+チャット
// =============================================================

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

// code -> { type: 'personal'|'group', limit: number, members: [{ socketId, name }],
//           msgSeq: number, messages: Map(id -> { reactions: Map(emoji->Set(socketId)), readBy: Set(socketId), authorSocketId }) }
const rooms = new Map();

// socketId -> 現在参加している部屋コード
const socketRoom = new Map();

// ランダムチャットの待機列: [{ socketId, name, clientId }, ...]
let randomQueue = [];

// 通報によるブロック: clientId -> Set(ブロックしたclientId)
// clientId はブラウザごとに割り振る簡易的な識別子で、アカウントとは無関係(サインイン不要)。
// ランダムチャットの相手選びの際、お互いにブロック関係があれば組ませない。
const blocks = new Map();
function isBlockedPair(a, b) {
  if (!a || !b) return false;
  return (blocks.get(a) && blocks.get(a).has(b)) || (blocks.get(b) && blocks.get(b).has(a));
}

// 履歴として見せる範囲(直近1日)
const HISTORY_WINDOW_MS = 24 * 60 * 60 * 1000;
function buildHistory(room) {
  const now = Date.now();
  const list = [];
  for (const [id, m] of room.messages) {
    if (now - m.ts > HISTORY_WINDOW_MS) continue;
    list.push({
      id,
      from: m.authorSocketId,
      name: m.name,
      text: m.text,
      nameColor: m.nameColor,
      textColor: m.textColor,
      replyTo: m.replyTo,
      ts: m.ts,
      edited: !!m.edited,
      reactions: [...m.reactions.entries()].map(([e, s]) => ({ emoji: e, socketIds: [...s] })),
    });
  }
  return list;
}

// チャットの色として許可する形式(#rrggbb)
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
function sanitizeColor(value) {
  return typeof value === "string" && HEX_COLOR.test(value) ? value : null;
}

// アイコン画像(data URL)。形式と大きさだけ確認する(中身の画像検証はしない簡易チェック)。
const MAX_AVATAR_LENGTH = 40000; // 128x128のJPEGなら十分収まるサイズ
function sanitizeAvatar(value) {
  if (typeof value !== "string") return null;
  if (!value.startsWith("data:image/")) return null;
  if (value.length > MAX_AVATAR_LENGTH) return null;
  return value;
}

function normalizeCode(raw) {
  const halfWidth = String(raw || "").replace(/[\uFF01-\uFF5E]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)
  );
  return halfWidth.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

function randomRoomCode() {
  return "R" + Math.random().toString(36).slice(2, 8).toUpperCase();
}

// オープンチャット用の部屋コード(他の部屋と衝突しないことを確認してから使う)
function uniqueOpenRoomCode() {
  let code;
  do {
    code = "O" + Math.random().toString(36).slice(2, 8).toUpperCase();
  } while (rooms.has(code));
  return code;
}

// オープンチャット: 鍵付きの部屋に設定する招待コード(6桁の英数字)
function genInviteCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 紛らわしい 0/O, 1/I は除外
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// オープンチャットで選べるタグ(サーバー側でもホワイトリストとして検証する)
const OPEN_TAGS = ["雑談", "ゲーム", "音楽", "勉強", "その他"];
function sanitizeOpenTags(tags) {
  if (!Array.isArray(tags)) return [];
  const out = [];
  for (const t of tags) {
    if (typeof t === "string" && OPEN_TAGS.includes(t) && !out.includes(t)) out.push(t);
    if (out.length >= 3) break;
  }
  return out;
}

const OPEN_RESTRICTIONS = ["none", "account", "verified"];
function sanitizeRestriction(v) {
  return OPEN_RESTRICTIONS.includes(v) ? v : "none";
}

function removeFromRandomQueue(socketId) {
  randomQueue = randomQueue.filter((w) => w.socketId !== socketId);
}

function makeRoom(type, limit) {
  return { type, limit, members: [], msgSeq: 0, messages: new Map() };
}

// メッセージの既読・リアクション状態を保持する Map は、部屋あたり最大件数を超えたら
// 古いものから捨てる(長時間の利用でメモリが際限なく増えるのを防ぐため)
const MAX_TRACKED_MESSAGES = 300;
function trackMessage(room, id, fields) {
  room.messages.set(id, {
    reactions: new Map(),
    readBy: new Set([fields.authorSocketId]),
    authorSocketId: fields.authorSocketId,
    authorClientId: fields.authorClientId || null,
    name: fields.name,
    text: fields.text,
    nameColor: fields.nameColor,
    textColor: fields.textColor,
    replyTo: fields.replyTo,
    ts: Date.now(),
    edited: false,
  });
  if (room.messages.size > MAX_TRACKED_MESSAGES) {
    const oldestKey = room.messages.keys().next().value;
    room.messages.delete(oldestKey);
  }
}

// 現在の部屋から退出させる。group の場合は残ったメンバーに更新を通知する。
function leaveCurrentRoom(socket, notifyPartner = true) {
  removeFromRandomQueue(socket.id);

  const code = socketRoom.get(socket.id);
  if (!code) return;

  const room = rooms.get(code);

  // 先に部屋から抜けておく(この後の通知を自分が受け取らないようにするため)
  socket.leave(code);
  socketRoom.delete(socket.id);

  if (!room) return;

  const leavingMember = room.members.find((m) => m.socketId === socket.id);
  const remaining = room.members.filter((m) => m.socketId !== socket.id);

  if (remaining.length > 0) {
    room.members = remaining;
    if (room.type === "personal") {
      if (notifyPartner) io.to(remaining[0].socketId).emit("partner_left");
    } else {
      io.to(code).emit("group_update", {
        code,
        limit: room.limit,
        members: remaining.map((m) => ({ socketId: m.socketId, name: m.name, avatar: m.avatar || null })),
        leftName: leavingMember ? leavingMember.name : null,
        roomTitle: room.isOpen ? room.title : null,
      });
    }
  } else {
    rooms.delete(code);
  }
}

io.on("connection", (socket) => {
  // ---- 個人チャット / グループチャット(部屋コード方式) ----
  socket.on("join_room", (payload) => {
    try {
      const { displayName, code, mode, avatar, clientId } =
        payload && typeof payload === "object" ? payload : {};

      const name = String(displayName || "名無し").trim().slice(0, 20) || "名無し";
      const roomCode = normalizeCode(code);
      const roomType = mode === "group" ? "group" : "personal";
      const myAvatar = sanitizeAvatar(avatar);
      const myClientId = typeof clientId === "string" ? clientId.slice(0, 64) : null;

      if (!roomCode) {
        socket.emit("join_error", { code: "need_code", message: "部屋コードを入力してください" });
        return;
      }

      // すでに別の部屋にいるなら先に退出(二重参加防止)
      leaveCurrentRoom(socket, true);

      let room = rooms.get(roomCode);

      if (room && room.type !== roomType) {
        socket.emit("join_error", { code: "wrong_type", message: "このコードは別の種類のチャットで使用されています" });
        return;
      }

      if (room && room.isOpen) {
        socket.emit("join_error", {
          code: "wrong_type",
          message: "このコードはオープンチャットの部屋です。オープンチャット一覧から参加してください",
        });
        return;
      }

      if (!room) {
        let limit = 2;
        if (roomType === "group") {
          const parsed = parseInt(payload && payload.limit, 10);
          limit = Number.isFinite(parsed) ? Math.min(20, Math.max(2, parsed)) : 10;
        }
        room = makeRoom(roomType, limit);
        rooms.set(roomCode, room);
      }

      if (room.members.length >= room.limit) {
        socket.emit("join_error", {
          code: roomType === "group" ? "full_group" : "full_personal",
          message: roomType === "group" ? "このグループは満員です" : "この部屋はすでに満室です",
        });
        return;
      }

      room.members.push({ socketId: socket.id, name, avatar: myAvatar, clientId: myClientId });
      socketRoom.set(socket.id, roomCode);
      socket.join(roomCode);

      // 直近1日の履歴を、入室した本人にだけ送る
      socket.emit("chat_history", { messages: buildHistory(room) });

      if (roomType === "personal") {
        if (room.members.length === 2) {
          const [a, b] = room.members;
          // initiator: 通話のoffer(発信)側。先に入った a が担当
          io.to(a.socketId).emit("matched", { code: roomCode, partnerName: b.name, partnerAvatar: b.avatar, initiator: true });
          io.to(b.socketId).emit("matched", { code: roomCode, partnerName: a.name, partnerAvatar: a.avatar, initiator: false });
          console.log(`[match] code=${roomCode} ${a.name} <-> ${b.name}`);
        } else {
          socket.emit("waiting", { code: roomCode });
          console.log(`[queue] ${name} が code=${roomCode} で待機中`);
        }
      } else {
        io.to(roomCode).emit("group_update", {
          code: roomCode,
          limit: room.limit,
          members: room.members.map((m) => ({ socketId: m.socketId, name: m.name, avatar: m.avatar || null })),
          joinedName: name,
        });
        console.log(`[group] ${name} が code=${roomCode} に参加(${room.members.length}/${room.limit})`);
      }
    } catch (err) {
      console.error("[join_room error]", err);
      socket.emit("join_error", { message: "参加中にエラーが発生しました" });
    }
  });

  // ---- オープンチャット: 公開中の部屋一覧 ----
  socket.on("list_open_rooms", () => {
    try {
      const list = [];
      for (const [code, room] of rooms) {
        if (!room.isOpen) continue;
        list.push({
          code,
          title: room.title,
          tags: room.tags,
          locked: room.locked,
          memberRestriction: room.memberRestriction,
          limit: room.limit,
          memberCount: room.members.length,
        });
      }
      // 新しく出来た部屋を上に
      list.sort((a, b) => b.code.localeCompare(a.code));
      socket.emit("open_rooms_list", { rooms: list });
    } catch (err) {
      console.error("[list_open_rooms error]", err);
      socket.emit("open_rooms_list", { rooms: [] });
    }
  });

  // ---- オープンチャット: 部屋を作成する ----
  socket.on("create_open_room", (payload) => {
    try {
      const { displayName, avatar, clientId } = payload && typeof payload === "object" ? payload : {};
      const name = String(displayName || "名無し").trim().slice(0, 20) || "名無し";
      const myAvatar = sanitizeAvatar(avatar);
      const myClientId = typeof clientId === "string" ? clientId.slice(0, 64) : null;

      const title = String((payload && payload.title) || "").trim().slice(0, 30);
      if (!title) {
        socket.emit("join_error", { code: "need_title", message: "部屋名を入力してください" });
        return;
      }

      const tags = sanitizeOpenTags(payload && payload.tags);
      const locked = !!(payload && payload.locked);
      const memberRestriction = sanitizeRestriction(payload && payload.memberRestriction);
      const parsedLimit = parseInt(payload && payload.limit, 10);
      const limit = Number.isFinite(parsedLimit) ? Math.min(50, Math.max(2, parsedLimit)) : 10;

      leaveCurrentRoom(socket, true);

      const roomCode = uniqueOpenRoomCode();
      const room = makeRoom("group", limit);
      room.isOpen = true;
      room.title = title;
      room.tags = tags;
      room.locked = locked;
      room.inviteCode = locked ? genInviteCode() : null;
      room.memberRestriction = memberRestriction;
      rooms.set(roomCode, room);

      room.members.push({ socketId: socket.id, name, avatar: myAvatar, clientId: myClientId });
      socketRoom.set(socket.id, roomCode);
      socket.join(roomCode);

      socket.emit("chat_history", { messages: buildHistory(room) });
      io.to(roomCode).emit("group_update", {
        code: roomCode,
        limit: room.limit,
        members: room.members.map((m) => ({ socketId: m.socketId, name: m.name, avatar: m.avatar || null })),
        joinedName: name,
        roomTitle: room.title,
      });
      socket.emit("open_room_created", { title: room.title, inviteCode: room.inviteCode });
      console.log(`[open create] code=${roomCode} title="${title}" by ${name}`);
    } catch (err) {
      console.error("[create_open_room error]", err);
      socket.emit("join_error", { message: "部屋の作成中にエラーが発生しました" });
    }
  });

  // ---- オープンチャット: 一覧から部屋に参加する ----
  socket.on("join_open_room", (payload) => {
    try {
      const { displayName, code, inviteCode, avatar, clientId } =
        payload && typeof payload === "object" ? payload : {};
      const name = String(displayName || "名無し").trim().slice(0, 20) || "名無し";
      const myAvatar = sanitizeAvatar(avatar);
      const myClientId = typeof clientId === "string" ? clientId.slice(0, 64) : null;

      const roomCode = normalizeCode(code);
      const room = rooms.get(roomCode);

      if (!room || !room.isOpen) {
        socket.emit("join_error", { code: "not_found", message: "この部屋は見つかりませんでした(すでに解散した可能性があります)" });
        return;
      }

      if (room.locked) {
        const given = String(inviteCode || "").trim().toUpperCase();
        if (!given || given !== room.inviteCode) {
          socket.emit("join_error", { code: "bad_invite", message: "招待コードが正しくありません" });
          return;
        }
      }

      if (room.members.length >= room.limit) {
        socket.emit("join_error", { code: "full_group", message: "この部屋は満員です" });
        return;
      }

      leaveCurrentRoom(socket, true);

      room.members.push({ socketId: socket.id, name, avatar: myAvatar, clientId: myClientId });
      socketRoom.set(socket.id, roomCode);
      socket.join(roomCode);

      socket.emit("chat_history", { messages: buildHistory(room) });
      io.to(roomCode).emit("group_update", {
        code: roomCode,
        limit: room.limit,
        members: room.members.map((m) => ({ socketId: m.socketId, name: m.name, avatar: m.avatar || null })),
        joinedName: name,
        roomTitle: room.title,
      });
      console.log(`[open join] code=${roomCode} title="${room.title}" ${name} (${room.members.length}/${room.limit})`);
    } catch (err) {
      console.error("[join_open_room error]", err);
      socket.emit("join_error", { message: "参加中にエラーが発生しました" });
    }
  });

  // ---- ランダムチャット(コード不要・自動で2人組にする) ----
  socket.on("join_random", (payload) => {
    try {
      const { displayName, avatar, clientId } = payload && typeof payload === "object" ? payload : {};
      const name = String(displayName || "名無し").trim().slice(0, 20) || "名無し";
      const myAvatar = sanitizeAvatar(avatar);
      const myClientId = typeof clientId === "string" ? clientId.slice(0, 64) : null;

      leaveCurrentRoom(socket, true);

      // 待機列から、ブロック関係にない相手を探す(つながっていない/古い相手はその場で取り除く)
      let partner = null;
      while (randomQueue.length > 0) {
        const idx = randomQueue.findIndex((w) => !isBlockedPair(myClientId, w.clientId));
        if (idx === -1) break; // 残りは全員ブロック関係 → 自分は待機列へ
        const candidate = randomQueue[idx];
        const candidateSocket = io.sockets.sockets.get(candidate.socketId);
        if (!candidateSocket) { randomQueue.splice(idx, 1); continue; } // すでに切断済み
        randomQueue.splice(idx, 1);
        partner = candidate;
        break;
      }

      if (partner) {
        const roomCode = randomRoomCode();
        const room = makeRoom("personal", 2);
        room.members = [
          { socketId: partner.socketId, name: partner.name, avatar: partner.avatar || null, clientId: partner.clientId || null },
          { socketId: socket.id, name, avatar: myAvatar, clientId: myClientId },
        ];
        rooms.set(roomCode, room);
        socketRoom.set(partner.socketId, roomCode);
        socketRoom.set(socket.id, roomCode);
        const partnerSocket = io.sockets.sockets.get(partner.socketId);
        partnerSocket.join(roomCode);
        socket.join(roomCode);

        io.to(partner.socketId).emit("matched", { code: roomCode, partnerName: name, partnerAvatar: myAvatar, initiator: true });
        io.to(socket.id).emit("matched", { code: roomCode, partnerName: partner.name, partnerAvatar: partner.avatar || null, initiator: false });
        console.log(`[random match] code=${roomCode} ${partner.name} <-> ${name}`);
      } else {
        randomQueue.push({ socketId: socket.id, name, avatar: myAvatar, clientId: myClientId });
        socket.emit("waiting", { code: null });
        console.log(`[random queue] ${name} が待機中`);
      }
    } catch (err) {
      console.error("[join_random error]", err);
      socket.emit("join_error", { message: "参加中にエラーが発生しました" });
    }
  });

  // ---- チャット送信(個人・グループ・ランダム共通) ----
  socket.on("send_message", (payload) => {
    try {
      const text = payload && typeof payload.text === "string" ? payload.text : "";
      const trimmed = text.trim();
      if (!trimmed) return;

      const code = socketRoom.get(socket.id);
      if (!code) return;
      const room = rooms.get(code);
      if (!room) return;
      const me = room.members.find((m) => m.socketId === socket.id);
      if (!me) return;

      // 返信先(あれば): id・名前・本文の抜粋だけを軽く検証して載せる
      let replyTo = null;
      const rt = payload.replyTo;
      if (rt && typeof rt === "object" && typeof rt.id === "string") {
        replyTo = {
          id: rt.id,
          name: String(rt.name || "").slice(0, 20),
          text: String(rt.text || "").slice(0, 120),
        };
      }

      const id = `${code}-${++room.msgSeq}`;
      const finalText = trimmed.slice(0, 1000);
      const nameColor = sanitizeColor(payload.nameColor);
      const textColor = sanitizeColor(payload.textColor);

      trackMessage(room, id, {
        authorSocketId: socket.id,
        authorClientId: me.clientId || null,
        name: me.name,
        text: finalText,
        nameColor,
        textColor,
        replyTo,
      });

      io.to(code).emit("chat_message", {
        id,
        from: socket.id,
        name: me.name,
        text: finalText,
        nameColor,
        textColor,
        replyTo,
        ts: Date.now(),
      });
    } catch (err) {
      console.error("[send_message error]", err);
    }
  });

  // ---- メッセージの編集(自分が送ったものだけ) ----
  socket.on("edit_message", (payload) => {
    try {
      const id = payload && payload.id;
      const text = payload && typeof payload.text === "string" ? payload.text.trim().slice(0, 1000) : "";
      if (typeof id !== "string" || !text) return;

      const code = socketRoom.get(socket.id);
      if (!code) return;
      const room = rooms.get(code);
      if (!room) return;
      const entry = room.messages.get(id);
      if (!entry || entry.authorSocketId !== socket.id) return;

      entry.text = text;
      entry.edited = true;

      io.to(code).emit("message_edited", { id, text });
    } catch (err) {
      console.error("[edit_message error]", err);
    }
  });

  // ---- 既読 ----
  socket.on("read_message", (payload) => {
    try {
      const id = payload && payload.id;
      if (typeof id !== "string") return;
      const code = socketRoom.get(socket.id);
      if (!code) return;
      const room = rooms.get(code);
      if (!room) return;
      const entry = room.messages.get(id);
      // 自分自身のメッセージや、既に既読済みなら何もしない
      if (!entry || entry.authorSocketId === socket.id || entry.readBy.has(socket.id)) return;
      entry.readBy.add(socket.id);
      const count = entry.readBy.size - 1; // 送信者本人は数えない
      io.to(code).emit("read_update", { id, count });
    } catch (err) {
      console.error("[read_message error]", err);
    }
  });

  // ---- リアクション(絵文字) ----
  socket.on("toggle_reaction", (payload) => {
    try {
      const id = payload && payload.id;
      const emoji = payload && payload.emoji;
      if (typeof id !== "string" || typeof emoji !== "string") return;
      const clean = emoji.trim().slice(0, 8);
      if (!clean) return;

      const code = socketRoom.get(socket.id);
      if (!code) return;
      const room = rooms.get(code);
      if (!room) return;
      const entry = room.messages.get(id);
      if (!entry) return;

      let set = entry.reactions.get(clean);
      if (!set) { set = new Set(); entry.reactions.set(clean, set); }
      if (set.has(socket.id)) set.delete(socket.id);
      else set.add(socket.id);
      if (set.size === 0) entry.reactions.delete(clean);

      const reactions = [...entry.reactions.entries()].map(([e, s]) => ({ emoji: e, socketIds: [...s] }));
      io.to(code).emit("reaction_update", { id, reactions });
    } catch (err) {
      console.error("[toggle_reaction error]", err);
    }
  });

  // ---- 通報(ログに記録し、通報した相手を自動でブロックする) ----
  // 悪意のある通報も起こり得るため、相手を強制退出させたりはしない。
  // ブロックは「今後のランダムチャットの組み合わせから外れる」効果のみ。
  socket.on("report_message", (payload) => {
    try {
      const id = payload && payload.id;
      if (typeof id !== "string") return;
      const code = socketRoom.get(socket.id);
      if (!code) return;
      const room = rooms.get(code);
      if (!room) return;
      const entry = room.messages.get(id);
      if (!entry) return;
      const reporter = room.members.find((m) => m.socketId === socket.id);
      if (!reporter) return;

      const reporterClientId = reporter.clientId || null;
      const reportedClientId = entry.authorClientId || null;

      console.warn("[REPORT]", {
        time: new Date().toISOString(),
        room: code,
        reporterName: reporter.name,
        reporterClientId,
        reportedName: entry.name,
        reportedClientId,
        messageId: id,
        messageText: entry.text,
      });

      if (reporterClientId && reportedClientId) {
        if (!blocks.has(reporterClientId)) blocks.set(reporterClientId, new Set());
        blocks.get(reporterClientId).add(reportedClientId);
      }
    } catch (err) {
      console.error("[report_message error]", err);
    }
  });

  // ---- 入力中の表示(本文は送らず、誰が入力中かだけを相手に伝える) ----
  socket.on("typing", () => {
    try {
      const code = socketRoom.get(socket.id);
      if (!code) return;
      const room = rooms.get(code);
      if (!room) return;
      const me = room.members.find((m) => m.socketId === socket.id);
      if (!me) return;
      socket.to(code).emit("typing", { name: me.name });
    } catch (err) {
      console.error("[typing error]", err);
    }
  });

  // WebRTC シグナリング: offer / answer / ICE candidate を相手に中継するだけ
  // (personal / random の2人部屋でのみ使われる)
  socket.on("signal", (payload) => {
    try {
      if (!payload || !["offer", "answer", "candidate"].includes(payload.type)) return;
      const code = socketRoom.get(socket.id);
      if (!code) return;
      const room = rooms.get(code);
      if (!room) return;
      const partner = room.members.find((m) => m.socketId !== socket.id);
      if (!partner) return;
      io.to(partner.socketId).emit("signal", {
        type: payload.type,
        sdp: payload.sdp,
        candidate: payload.candidate,
      });
    } catch (err) {
      console.error("[signal error]", err);
    }
  });

  socket.on("leave_room", () => {
    leaveCurrentRoom(socket, true);
  });

  socket.on("disconnect", () => {
    leaveCurrentRoom(socket, true);
    console.log(`[disconnect] ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Matching/chat server listening on http://localhost:${PORT}`);
});
