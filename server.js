const express = require("express");
const http = require("http");
const crypto = require("crypto");
const path = require("path");
const { WebSocketServer, WebSocket } = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
const PORT = process.env.PORT || 3000;
const publicDir = path.join(__dirname, "public");

// 学習用のメモリ保存です。Renderの再起動時にルームと履歴は消えます。
const rooms = new Map();

app.use(express.json());
app.use(express.static(publicDir));

function validRoomId(value) {
  return typeof value === "string" && /^\d{6}$/.test(value);
}

function makeRoomId() {
  let id;
  do {
    id = String(crypto.randomInt(100000, 1000000));
  } while (rooms.has(id));
  return id;
}

app.post("/api/room", (_req, res) => {
  const id = makeRoomId();
  rooms.set(id, { messages: [], clients: new Map(), createdAt: Date.now() });
  res.status(201).json({ id });
});

app.get("/api/room/:id", (req, res) => {
  const id = req.params.id;
  if (!validRoomId(id) || !rooms.has(id)) {
    return res.status(404).json({ error: "ルームが見つかりません" });
  }
  res.json({ id });
});

app.get("/room/:id", (req, res) => {
  const id = req.params.id;
  if (!validRoomId(id)) return res.redirect("/");
  res.sendFile(path.join(publicDir, "index.html"));
});

server.on("upgrade", (request, socket, head) => {
  let parsed;
  try {
    parsed = new URL(request.url, "http://localhost");
  } catch {
    socket.destroy();
    return;
  }
  if (parsed.pathname !== "/") {
    socket.destroy();
    return;
  }
  const roomId = parsed.searchParams.get("room");
  if (!validRoomId(roomId) || !rooms.has(roomId)) {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request, roomId);
  });
});

wss.on("connection", (ws, _request, roomId) => {
  const room = rooms.get(roomId);
  if (!room) {
    ws.close(1008, "Room not found");
    return;
  }
  // MapのキーはWebSocket接続。複数端末で同じ表示名でも人数は接続数で数える。
  room.clients.set(ws, { name: "参加者", clientId: null, identified: false });
  ws.send(JSON.stringify({ type: "history", messages: room.messages.slice(-100) }));
  broadcastParticipants(room);

  ws.on("message", (raw) => {
    let payload;
    try {
      payload = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (payload.type === "join") {
      const participant = room.clients.get(ws);
      if (!participant) return;
      participant.name = typeof payload.name === "string" ? payload.name.trim().slice(0, 30) || "匿名" : "匿名";
      participant.clientId = typeof payload.clientId === "string" ? payload.clientId.slice(0, 80) : null;
      const firstJoin = !participant.identified;
      participant.identified = true;
      broadcastParticipants(room);
      if (firstJoin) broadcast(room, { type: "system", text: `${participant.name} さんが参加しました` }, ws);
      return;
    }

    if (payload.type !== "message") return;
    const participant = room.clients.get(ws);
    if (!participant || !participant.identified) return;
    const text = typeof payload.text === "string" ? payload.text.trim().slice(0, 1000) : "";
    if (!text) return;
    const message = {
      id: crypto.randomUUID(),
      room: roomId,
      senderId: participant.clientId,
      name: participant.name,
      text,
      time: new Date().toISOString()
    };
    room.messages.push(message);
    room.messages = room.messages.slice(-100);
    broadcast(room, { type: "message", message });
  });

  ws.on("close", () => {
    const participant = room.clients.get(ws);
    room.clients.delete(ws);
    broadcastParticipants(room);
    if (participant?.identified) broadcast(room, { type: "system", text: `${participant.name} さんが退出しました` });
  });
  ws.on("error", () => {
    room.clients.delete(ws);
    broadcastParticipants(room);
  });
});

function broadcastParticipants(room) {
  const participants = [...room.clients.values()].map((participant) => ({
    name: participant.name,
    clientId: participant.clientId,
    identified: participant.identified
  }));
  broadcast(room, { type: "participants", count: room.clients.size, participants });
}

function broadcast(room, payload, except = null) {
  const encoded = JSON.stringify(payload);
  for (const client of room.clients.keys()) {
    if (client !== except && client.readyState === WebSocket.OPEN) {
      client.send(encoded);
    }
  }
}

app.get("*", (_req, res) => res.sendFile(path.join(publicDir, "index.html")));

server.listen(PORT, "0.0.0.0", () => {
  console.log(`URL Chat listening on port ${PORT}`);
});
