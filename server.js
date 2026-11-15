const express = require("express");
const http = require("http");
const crypto = require("crypto");
const path = require("path");
const { WebSocketServer, WebSocket } = require("ws");
const { Pool } = require("pg");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 600 * 1024 });
const PORT = process.env.PORT || 3000;
const publicDir = path.join(__dirname, "public");

// DATABASE_URL が設定されていれば Neon にルームとメッセージを永続保存する。
const db = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL, max: 5, ssl: { rejectUnauthorized: false } }) : null;
const rooms = new Map();
const COMMUNITY_ROOM_ID = "080002";

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

app.post("/api/room", async (req, res) => {
  const requestedId = req.body?.id;
  let id;
  if (requestedId !== undefined && requestedId !== null && requestedId !== "") {
    if (!validRoomId(requestedId)) {
      return res.status(400).json({ error: "ルームナンバーは6桁の数字で入力してください。" });
    }
    if (rooms.has(requestedId)) {
      return res.status(409).json({ error: "その番号はすでに使われています。別の番号を選んでください。" });
    }
    id = requestedId;
  } else {
    id = makeRoomId();
  }
  try {
    const createdAt = new Date();
    if (db) await db.query("INSERT INTO chat_rooms (room_id, is_permanent, created_at) VALUES ($1, FALSE, $2)", [id, createdAt]);
    rooms.set(id, { messages: [], clients: new Map(), createdAt: createdAt.getTime() });
    res.status(201).json({ id });
  } catch (error) {
    console.error("Room creation failed:", error);
    res.status(500).json({ error: "ルームを作成できませんでした。時間をおいて再度お試しください。" });
  }
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
  room.clients.set(ws, { name: "参加者", clientId: null, avatar: "😄", identified: false });
  ws.send(JSON.stringify({ type: "history", messages: room.messages.slice(-100) }));
  broadcastParticipants(room);

  ws.on("message", async (raw) => {
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
      const allowedAvatars = ["😄","😊","😂","😎","🥺","😍","😏","😴","😭","😡","🤔","😇"];
      participant.avatar = allowedAvatars.includes(payload.avatar) ? payload.avatar : "😄";
      const firstJoin = !participant.identified;
      participant.identified = true;
      broadcastParticipants(room);
      if (firstJoin) broadcast(room, { type: "system", text: `${participant.name} さんが参加しました` }, ws);
      return;
    }

    if (payload.type === "read") {
      const reader = room.clients.get(ws);
      if (!reader?.identified || typeof payload.messageId !== "string") return;
      const target = room.messages.find(item => item.id === payload.messageId);
      if (!target || !reader.clientId || target.senderId === reader.clientId) return;
      if (!Array.isArray(target.readBy)) target.readBy = [];
      if (!target.readBy.includes(reader.clientId)) {
        target.readBy.push(reader.clientId);
        if (db) {
          try {
            await db.query(
              "UPDATE chat_messages SET read_by = read_by || $1::jsonb WHERE id = $2 AND NOT (read_by @> $1::jsonb)",
              [JSON.stringify([reader.clientId]), target.id]
            );
          } catch (error) {
            console.error("Read receipt save failed:", error);
            target.readBy.pop();
            return;
          }
        }
        target.readCount = target.readBy.length;
        broadcast(room, { type: "read_update", messageId: target.id, readCount: target.readCount });
      }
      return;
    }

    if (payload.type !== "message") return;
    const participant = room.clients.get(ws);
    if (!participant || !participant.identified) return;
    const text = typeof payload.text === "string" ? payload.text.trim().slice(0, 1000) : "";
    const image = typeof payload.image === "string" && /^data:image\/(jpeg|png|webp);base64,/.test(payload.image) && payload.image.length <= 400000 ? payload.image : null;
    if (!text && !image) return;
    const message = {
      id: crypto.randomUUID(),
      room: roomId,
      senderId: participant.clientId,
      name: participant.name,
      avatar: participant.avatar,
      text,
      ...(image ? { image } : {}),
      time: new Date().toISOString(),
      readBy: [],
      readCount: 0
    };
    if (db) {
      try {
        await db.query(
          "INSERT INTO chat_messages (id, room_id, sender_id, sender_name, avatar, message_text, image_data, sent_at, read_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '[]'::jsonb)",
          [message.id, roomId, message.senderId || "", message.name, message.avatar, message.text, message.image || null, message.time]
        );
      } catch (error) {
        console.error("Message save failed:", error);
        ws.send(JSON.stringify({ type: "error", text: "メッセージを保存できませんでした。もう一度送信してください。" }));
        return;
      }
    }
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
    avatar: participant.avatar,
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

async function initializeDatabase() {
  if (!db) {
    console.warn("DATABASE_URL is not set; using temporary in-memory chat storage.");
    rooms.set(COMMUNITY_ROOM_ID, { messages: [], clients: new Map(), createdAt: Date.now(), permanent: true });
    return;
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS chat_rooms (
      room_id CHAR(6) PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      is_permanent BOOLEAN NOT NULL DEFAULT FALSE
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id UUID PRIMARY KEY,
      room_id CHAR(6) NOT NULL REFERENCES chat_rooms(room_id) ON DELETE CASCADE,
      sender_id TEXT NOT NULL,
      sender_name VARCHAR(30) NOT NULL,
      avatar TEXT NOT NULL DEFAULT '😄',
      message_text TEXT NOT NULL DEFAULT '',
      image_data TEXT,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      read_by JSONB NOT NULL DEFAULT '[]'::jsonb
    )
  `);
  await db.query(
    "INSERT INTO chat_rooms (room_id, is_permanent) VALUES ($1, TRUE) ON CONFLICT (room_id) DO UPDATE SET is_permanent = TRUE",
    [COMMUNITY_ROOM_ID]
  );

  const roomRows = await db.query("SELECT room_id, is_permanent, created_at FROM chat_rooms");
  for (const row of roomRows.rows) {
    rooms.set(row.room_id, {
      messages: [],
      clients: new Map(),
      createdAt: new Date(row.created_at).getTime(),
      permanent: row.is_permanent
    });
  }

  const messageRows = await db.query(`
    SELECT id, room_id, sender_id, sender_name, avatar, message_text, image_data, sent_at, read_by
    FROM (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY room_id ORDER BY sent_at DESC) AS row_num
      FROM chat_messages
    ) recent
    WHERE row_num <= 100
    ORDER BY sent_at ASC
  `);
  for (const row of messageRows.rows) {
    const room = rooms.get(row.room_id);
    if (!room) continue;
    const readBy = Array.isArray(row.read_by) ? row.read_by : [];
    room.messages.push({
      id: row.id,
      room: row.room_id,
      senderId: row.sender_id,
      name: row.sender_name,
      avatar: row.avatar,
      text: row.message_text,
      ...(row.image_data ? { image: row.image_data } : {}),
      time: new Date(row.sent_at).toISOString(),
      readBy,
      readCount: readBy.length
    });
  }
  console.log(`Loaded ${rooms.size} rooms and ${messageRows.rowCount} messages from Neon.`);
}

initializeDatabase()
  .then(() => {
    server.listen(PORT, "0.0.0.0", () => {
      console.log(`URL Chat listening on port ${PORT}`);
    });
  })
  .catch(error => {
    console.error("Database initialization failed:", error);
    process.exit(1);
  });
