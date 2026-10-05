const startView = document.getElementById("startView");
const chatView = document.getElementById("chatView");
const nameInput = document.getElementById("name");
const createBtn = document.getElementById("createBtn");
const roomUrl = document.getElementById("roomUrl");
const copyBtn = document.getElementById("copyBtn");
const statusEl = document.getElementById("status");
const messagesEl = document.getElementById("messages");
const sendForm = document.getElementById("sendForm");
const textInput = document.getElementById("text");
const saveBtn = document.getElementById("saveBtn");
const clearBtn = document.getElementById("clearBtn");

let ws;
let roomId = null;
let currentName = localStorage.getItem("chatName") || "";
let currentMessages = [];
let savedBackup = [];

nameInput.value = currentName;

function storageKey(id) {
  return `urlChatHistory:${id}`;
}

function loadSavedMessages(id) {
  try {
    return JSON.parse(localStorage.getItem(storageKey(id)) || "[]");
  } catch {
    return [];
  }
}

function saveMessages(id, messages) {
  try {
    localStorage.setItem(storageKey(id), JSON.stringify(messages.slice(-100)));
    return true;
  } catch {
    return false;
  }
}

function renderMessages() {
  messagesEl.innerHTML = "";
  currentMessages.forEach(addMessage);
}

function addMessage(message) {
  const wrap = document.createElement("div");
  wrap.className = "message";
  wrap.dataset.messageId = message.id || "";

  const meta = document.createElement("div");
  meta.className = "meta";
  const time = new Date(message.time);
  meta.textContent = `${message.name} · ${time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;

  const body = document.createElement("div");
  body.className = "body";
  body.textContent = message.text;

  wrap.append(meta, body);
  messagesEl.appendChild(wrap);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addSystem(text) {
  const el = document.createElement("div");
  el.className = "system";
  el.textContent = text;
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function setMessages(messages) {
  const seen = new Set();
  currentMessages = messages.filter((message) => {
    if (!message || !message.text) return false;
    const id = message.id || `${message.time}-${message.name}-${message.text}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  }).slice(-100);
  renderMessages();
}

function appendMessage(message) {
  const id = message.id || `${message.time}-${message.name}-${message.text}`;
  if (currentMessages.some((item) => (item.id || `${item.time}-${item.name}-${item.text}`) === id)) return;
  currentMessages.push(message);
  currentMessages = currentMessages.slice(-100);
  addMessage(message);
  saveMessages(roomId, currentMessages);
}

async function createRoom() {
  currentName = nameInput.value.trim() || "匿名";
  localStorage.setItem("chatName", currentName);

  const res = await fetch("/api/room");
  const data = await res.json();
  location.href = `/room/${data.id}`;
}

createBtn.addEventListener("click", createRoom);

copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(roomUrl.value);
    copyBtn.textContent = "コピーしました";
    setTimeout(() => copyBtn.textContent = "URLをコピー", 1200);
  } catch {
    roomUrl.select();
    document.execCommand("copy");
  }
});

saveBtn.addEventListener("click", () => {
  if (!roomId) return;
  const ok = saveMessages(roomId, currentMessages);
  saveBtn.textContent = ok ? "保存しました" : "保存できませんでした";
  setTimeout(() => saveBtn.textContent = "トークを保存", 1400);
});

clearBtn.addEventListener("click", () => {
  if (!roomId) return;
  localStorage.removeItem(storageKey(roomId));
  savedBackup = [];
  clearBtn.textContent = "保存を削除しました";
  setTimeout(() => clearBtn.textContent = "保存を削除", 1400);
});

sendForm.addEventListener("submit", (e) => {
  e.preventDefault();

  const text = textInput.value.trim();
  if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;

  ws.send(JSON.stringify({
    name: currentName || "匿名",
    text
  }));

  textInput.value = "";
  textInput.focus();
});

const match = location.pathname.match(/^\/room\/([^/]+)$/);

if (match) {
  roomId = decodeURIComponent(match[1]);
  currentName = localStorage.getItem("chatName") || "匿名";
  savedBackup = loadSavedMessages(roomId);

  startView.hidden = true;
  chatView.hidden = false;
  roomUrl.value = location.href;

  if (savedBackup.length) {
    setMessages(savedBackup);
    statusEl.textContent = "保存したトークを読み込みました · 接続中...";
  }

  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${protocol}//${location.host}?room=${encodeURIComponent(roomId)}`);

  ws.addEventListener("open", () => {
    statusEl.textContent = "接続しました";
  });

  ws.addEventListener("close", () => {
    statusEl.textContent = "接続が切れました · 保存済みのトークはこの端末に残っています";
  });

  ws.addEventListener("error", () => {
    statusEl.textContent = "接続エラー · 保存済みのトークはこの端末から確認できます";
  });

  ws.addEventListener("message", (event) => {
    const data = JSON.parse(event.data);

    if (data.type === "history") {
      if (data.messages.length > 0) {
        setMessages(data.messages);
        saveMessages(roomId, currentMessages);
      } else if (savedBackup.length > 0) {
        setMessages(savedBackup);
      } else {
        setMessages([]);
      }
    } else if (data.type === "message") {
      appendMessage(data.message);
    } else if (data.type === "system") {
      addSystem(data.text);
    }
  });
}
