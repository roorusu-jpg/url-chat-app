CREATE TABLE IF NOT EXISTS chat_rooms (
  room_id CHAR(6) PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_permanent BOOLEAN NOT NULL DEFAULT FALSE
);

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
);

CREATE INDEX IF NOT EXISTS chat_messages_room_sent_idx
  ON chat_messages(room_id, sent_at DESC);

INSERT INTO chat_rooms (room_id, is_permanent)
VALUES ('080002', TRUE)
ON CONFLICT (room_id) DO UPDATE SET is_permanent = TRUE;
