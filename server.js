// =============================================================
// 部屋コード方式マッチング サーバー
// -------------------------------------------------------------
// アーキテクチャ概要:
//   1) クライアントが「表示名」と「部屋コード」を送って join_room する。
//   2) サーバーは rooms(Map: コード -> 参加者配列) を見て、
//      同じコードの部屋がまだ無ければ新規作成して1人目として入れる。
//   3) 同じコードの部屋に2人目が来たら、その時点で socket.io の room
//      (コード自体をroom名として使う) に両方を入れ、両者に matched を通知。
//   4) 3人目以降が同じコードで来た場合は room_full を返す(1対1限定)。
//   5) 誰かが退出/切断したら、残った側に partner_left を通知し、
//      部屋を空にする(その後また誰かがそのコードで入れば1人目に戻る)。
//
// 状態はメモリ上に保持するデモ実装です。
// 本番で複数サーバーに分散させる場合は Redis 等の外部ストアで
// rooms を共有する必要があります。
// =============================================================

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

// --- 部屋の状態管理 -----------------------------------------------

// code -> [{ socketId, name }, ...]  (最大2人)
const rooms = new Map();

// socketId -> 現在参加している部屋コード（未参加なら未設定）
const socketRoom = new Map();

function normalizeCode(raw) {
  // 全角英数字(日本語キーボードで入力しがち)を半角に変換してから正規化する
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
  socket.on("join_room", ({ displayName, code }) => {
    const name = String(displayName || "名無し").trim().slice(0, 20) || "名無し";
    const roomCode = normalizeCode(code);

    if (!roomCode) {
      socket.emit("join_error", { message: "部屋コードを入力してください" });
      return;
    }

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
      io.to(a.socketId).emit("matched", { code: roomCode, partnerName: b.name });
      io.to(b.socketId).emit("matched", { code: roomCode, partnerName: a.name });
      console.log(`[match] code=${roomCode} ${a.name} <-> ${b.name}`);
    } else {
      socket.emit("waiting", { code: roomCode });
      console.log(`[queue] ${name} が code=${roomCode} で待機中`);
    }
  });

  socket.on("send_message", ({ text }) => {
    const code = socketRoom.get(socket.id);
    if (!code) return;
    const members = rooms.get(code) || [];
    const me = members.find((m) => m.socketId === socket.id);
    if (!me) return;
    io.to(code).emit("chat_message", {
      from: socket.id,
      name: me.name,
      text: String(text).slice(0, 1000),
      ts: Date.now(),
    });
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
