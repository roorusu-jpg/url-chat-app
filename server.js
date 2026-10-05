const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const rooms = new Map();

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/room", (req, res) => {
  let id;
  do {
    id = crypto.randomBytes(6).toString("base64url");
  } while (rooms.has(id));
  rooms.set(id, { clients: new Set(), messages: [] });
  res.json({ id });
});

app.get("/room/:id", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

function roomFor(id) {
  if (!rooms.has(id)) {
    rooms.set(id, { clients: new Set(), messages: [] });
  }
  return rooms.get(id);
}

wss.on("connection", (socket, req) => {
  const url = new URL(req.url, "http://localhost");
  const roomId = url.searchParams.get("room");
  if (!roomId) return socket.close();

  const room = roomFor(roomId);
  room.clients.add(socket);

  socket.send(JSON.stringify({
    type: "history",
    messages: room.messages.slice(-100)
  }));

  socket.on("message", raw => {
    try {
      const data = JSON.parse(raw.toString());
      if (data.type !== "message") return;

      const text = String(data.text || "").trim().slice(0, 2000);
      const name = String(data.name || "匿名").trim().slice(0, 30) || "匿名";
      if (!text) return;

      const message = {
        id: crypto.randomUUID(),
        name,
        text,
        time: Date.now()
      };

      room.messages.push(message);
      if (room.messages.length > 100) room.messages.shift();

      const payload = JSON.stringify({ type: "message", message });
      for (const client of room.clients) {
        if (client.readyState === WebSocket.OPEN) client.send(payload);
      }
    } catch {}
  });

  socket.on("close", () => room.clients.delete(socket));
});

setInterval(() => {
  for (const [id, room] of rooms) {
    if (room.clients.size === 0 && room.messages.length === 0) rooms.delete(id);
  }
}, 60_000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`URL Chat running on port ${PORT}`);
});