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

// code -> { type: 'personal'|'group', limit: number, members: [{ socketId, name }] }
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
        members: remaining.map((m) => ({ name: m.name })),
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
      const { displayName, code, mode } =
        payload && typeof payload === "object" ? payload : {};

      const name = String(displayName || "名無し").trim().slice(0, 20) || "名無し";
      const roomCode = normalizeCode(code);
      const roomType = mode === "group" ? "group" : "personal";

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
        room = { type: roomType, limit, members: [] };
        rooms.set(roomCode, room);
      }

      if (room.members.length >= room.limit) {
        socket.emit("join_error", {
          code: roomType === "group" ? "full_group" : "full_personal",
          message: roomType === "group" ? "このグループは満員です" : "この部屋はすでに満室です",
        });
        return;
      }

      room.members.push({ socketId: socket.id, name });
      socketRoom.set(socket.id, roomCode);
      socket.join(roomCode);

      if (roomType === "personal") {
        if (room.members.length === 2) {
          const [a, b] = room.members;
          // initiator: 通話のoffer(発信)側。先に入った a が担当
          io.to(a.socketId).emit("matched", { code: roomCode, partnerName: b.name, initiator: true });
          io.to(b.socketId).emit("matched", { code: roomCode, partnerName: a.name, initiator: false });
          console.log(`[match] code=${roomCode} ${a.name} <-> ${b.name}`);
        } else {
          socket.emit("waiting", { code: roomCode });
          console.log(`[queue] ${name} が code=${roomCode} で待機中`);
        }
      } else {
        io.to(roomCode).emit("group_update", {
          code: roomCode,
          limit: room.limit,
          members: room.members.map((m) => ({ name: m.name })),
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
      const { displayName } = payload && typeof payload === "object" ? payload : {};
      const name = String(displayName || "名無し").trim().slice(0, 20) || "名無し";

      leaveCurrentRoom(socket, true);

      if (randomQueue.length > 0) {
        const partner = randomQueue.shift();
        const partnerSocket = io.sockets.sockets.get(partner.socketId);

        if (!partnerSocket) {
          // 相手がすでに切断していた場合は、自分を待機列に入れる
          randomQueue.push({ socketId: socket.id, name });
          socket.emit("waiting", { code: null });
          return;
        }

        const roomCode = randomRoomCode();
        const room = {
          type: "personal",
          limit: 2,
          members: [
            { socketId: partner.socketId, name: partner.name },
            { socketId: socket.id, name },
          ],
        };
        rooms.set(roomCode, room);
        socketRoom.set(partner.socketId, roomCode);
        socketRoom.set(socket.id, roomCode);
        partnerSocket.join(roomCode);
        socket.join(roomCode);

        io.to(partner.socketId).emit("matched", { code: roomCode, partnerName: name, initiator: true });
        io.to(socket.id).emit("matched", { code: roomCode, partnerName: partner.name, initiator: false });
        console.log(`[random match] code=${roomCode} ${partner.name} <-> ${name}`);
      } else {
        randomQueue.push({ socketId: socket.id, name });
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

      io.to(code).emit("chat_message", {
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
