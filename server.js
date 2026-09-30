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

// ランダムチャットの待機列: [{ socketId, name }, ...]
let randomQueue = [];

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

function removeFromRandomQueue(socketId) {
  randomQueue = randomQueue.filter((w) => w.socketId !== socketId);
}

function makeRoom(type, limit) {
  return { type, limit, members: [], msgSeq: 0, messages: new Map() };
}

// メッセージの既読・リアクション状態を保持する Map は、部屋あたり最大件数を超えたら
// 古いものから捨てる(長時間の利用でメモリが際限なく増えるのを防ぐため)
const MAX_TRACKED_MESSAGES = 300;
function trackMessage(room, id, authorSocketId) {
  room.messages.set(id, { reactions: new Map(), readBy: new Set([authorSocketId]), authorSocketId });
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
      const { displayName, code, mode, avatar } =
        payload && typeof payload === "object" ? payload : {};

      const name = String(displayName || "名無し").trim().slice(0, 20) || "名無し";
      const roomCode = normalizeCode(code);
      const roomType = mode === "group" ? "group" : "personal";
      const myAvatar = sanitizeAvatar(avatar);

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

      room.members.push({ socketId: socket.id, name, avatar: myAvatar });
      socketRoom.set(socket.id, roomCode);
      socket.join(roomCode);

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

  // ---- ランダムチャット(コード不要・自動で2人組にする) ----
  socket.on("join_random", (payload) => {
    try {
      const { displayName, avatar } = payload && typeof payload === "object" ? payload : {};
      const name = String(displayName || "名無し").trim().slice(0, 20) || "名無し";
      const myAvatar = sanitizeAvatar(avatar);

      leaveCurrentRoom(socket, true);

      if (randomQueue.length > 0) {
        const partner = randomQueue.shift();
        const partnerSocket = io.sockets.sockets.get(partner.socketId);

        if (!partnerSocket) {
          // 相手がすでに切断していた場合は、自分を待機列に入れる
          randomQueue.push({ socketId: socket.id, name, avatar: myAvatar });
          socket.emit("waiting", { code: null });
          return;
        }

        const roomCode = randomRoomCode();
        const room = makeRoom("personal", 2);
        room.members = [
          { socketId: partner.socketId, name: partner.name, avatar: partner.avatar || null },
          { socketId: socket.id, name, avatar: myAvatar },
        ];
        rooms.set(roomCode, room);
        socketRoom.set(partner.socketId, roomCode);
        socketRoom.set(socket.id, roomCode);
        partnerSocket.join(roomCode);
        socket.join(roomCode);

        io.to(partner.socketId).emit("matched", { code: roomCode, partnerName: name, partnerAvatar: myAvatar, initiator: true });
        io.to(socket.id).emit("matched", { code: roomCode, partnerName: partner.name, partnerAvatar: partner.avatar || null, initiator: false });
        console.log(`[random match] code=${roomCode} ${partner.name} <-> ${name}`);
      } else {
        randomQueue.push({ socketId: socket.id, name, avatar: myAvatar });
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

      const id = `${code}-${++room.msgSeq}`;
      trackMessage(room, id, socket.id);

      io.to(code).emit("chat_message", {
        id,
        from: socket.id,
        name: me.name,
        text: trimmed.slice(0, 1000),
        // 色は #rrggbb の形式だけ通す(それ以外は null)
        nameColor: sanitizeColor(payload.nameColor),
        textColor: sanitizeColor(payload.textColor),
        ts: Date.now(),
      });
    } catch (err) {
      console.error("[send_message error]", err);
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
