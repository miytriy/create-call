// =============================================================
// 部屋コード方式マッチング サーバー(バグ修正版)
// -------------------------------------------------------------
// 修正点:
//   1) join_room 時に、すでに部屋にいる場合は先に退出させる
//      (二重参加・自分自身とのマッチを防止)
//   2) イベントの引数が未定義/不正でもサーバーが落ちないようにする
//   3) send_message の入力チェック(文字列・空文字)を追加
// =============================================================

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

// code -> [{ socketId, name }, ...]  (最大2人)
const rooms = new Map();

// socketId -> 現在参加している部屋コード
const socketRoom = new Map();

function normalizeCode(raw) {
  const halfWidth = String(raw || "").replace(/[\uFF01-\uFF5E]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)
  );
  return halfWidth.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

function leaveCurrentRoom(socket, notifyPartner = true) {
  const code = socketRoom.get(socket.id);
  if (!code) return;

  const members = rooms.get(code) || [];
  const remaining = members.filter((m) => m.socketId !== socket.id);

  if (remaining.length > 0) {
    rooms.set(code, remaining);
    if (notifyPartner) {
      io.to(remaining[0].socketId).emit("partner_left");
    }
  } else {
    rooms.delete(code);
  }

  socket.leave(code);
  socketRoom.delete(socket.id);
}

io.on("connection", (socket) => {
  socket.on("join_room", (payload) => {
    try {
      const { displayName, code } =
        payload && typeof payload === "object" ? payload : {};

      const name =
        String(displayName || "名無し").trim().slice(0, 20) || "名無し";
      const roomCode = normalizeCode(code);

      if (!roomCode) {
        socket.emit("join_error", { message: "部屋コードを入力してください" });
        return;
      }

      // 修正1: すでに部屋にいるなら先に退出(二重参加防止)
      leaveCurrentRoom(socket, true);

      const members = rooms.get(roomCode) || [];

      if (members.length >= 2) {
        socket.emit("join_error", { message: "この部屋はすでに満室です" });
        return;
      }

      const newMembers = [...members, { socketId: socket.id, name }];
      rooms.set(roomCode, newMembers);
      socketRoom.set(socket.id, roomCode);
      socket.join(roomCode);

      if (newMembers.length === 2) {
        const [a, b] = newMembers;
        // initiator: 通話のoffer(発信)側。先に入った a が担当
        io.to(a.socketId).emit("matched", { code: roomCode, partnerName: b.name, initiator: true });
        io.to(b.socketId).emit("matched", { code: roomCode, partnerName: a.name, initiator: false });
        console.log(`[match] code=${roomCode} ${a.name} <-> ${b.name}`);
      } else {
        socket.emit("waiting", { code: roomCode });
        console.log(`[queue] ${name} が code=${roomCode} で待機中`);
      }
    } catch (err) {
      console.error("[join_room error]", err);
      socket.emit("join_error", { message: "参加中にエラーが発生しました" });
    }
  });

  socket.on("send_message", (payload) => {
    try {
      // 修正3: 入力チェック
      const text = payload && typeof payload.text === "string" ? payload.text : "";
      const trimmed = text.trim();
      if (!trimmed) return;

      const code = socketRoom.get(socket.id);
      if (!code) return;
      const members = rooms.get(code) || [];
      const me = members.find((m) => m.socketId === socket.id);
      if (!me) return;

      io.to(code).emit("chat_message", {
        from: socket.id,
        name: me.name,
        text: trimmed.slice(0, 1000),
        ts: Date.now(),
      });
    } catch (err) {
      console.error("[send_message error]", err);
    }
  });

  // WebRTC シグナリング: offer / answer / ICE candidate を相手に中継するだけ
  socket.on("signal", (payload) => {
    try {
      if (!payload || !["offer", "answer", "candidate"].includes(payload.type)) return;
      const code = socketRoom.get(socket.id);
      if (!code) return;
      const partner = (rooms.get(code) || []).find((m) => m.socketId !== socket.id);
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
  console.log(`Code-room matching server listening on http://localhost:${PORT}`);
});
