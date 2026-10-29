const startView = document.getElementById("startView");
const chatView = document.getElementById("chatView");
const nameInput = document.getElementById("name");
const roomNumberInput = document.getElementById("roomNumber");
const joinForm = document.getElementById("joinForm");
const createBtn = document.getElementById("createBtn");
const joinBtn = document.getElementById("joinBtn");
const roomNumberDisplay = document.getElementById("roomNumberDisplay");
const copyBtn = document.getElementById("copyBtn");
const statusEl = document.getElementById("status");
const messagesEl = document.getElementById("messages");
const sendForm = document.getElementById("sendForm");
const textInput = document.getElementById("text");
const saveBtn = document.getElementById("saveBtn");
const clearBtn = document.getElementById("clearBtn");
const backBtn = document.getElementById("backBtn");
const homeError = document.getElementById("homeError");
const participantCount = document.getElementById("participantCount");
const participantList = document.getElementById("participantList");
const backgroundColorInput = document.getElementById("backgroundColor");
const resetBackgroundBtn = document.getElementById("resetBackgroundBtn");
const DEFAULT_BACKGROUND = "#f5f7fb";
const accentColorInput = document.getElementById("accentColor");
const resetAccentBtn = document.getElementById("resetAccentBtn");
const DEFAULT_ACCENT = "#6878e4";
const DEFAULT_AVATAR = "(＾▽＾)";
const AVATARS = ["(＾▽＾)","(・ω・)","(￣▽￣)","(≧▽≦)","(｀・ω・´)","(¬‿¬)","(T_T)","(・∀・)","(´・ω・｀)","(ง •̀_•́)ง"];
let currentAvatar = DEFAULT_AVATAR;

let ws = null;
let roomId = null;
let currentName = localStorage.getItem("chatName") || "";
let currentMessages = [];
let savedBackup = [];
let manualLeave = false;
const clientId = getClientId();

function getClientId() {
  let id = localStorage.getItem("chatClientId");
  if (!id) {
    id = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem("chatClientId", id);
  }
  return id;
}

nameInput.value = currentName;

function applyAccentColor(color) {
  if (!/^#[0-9a-f]{6}$/i.test(color)) color = DEFAULT_ACCENT;
  const hex = color.slice(1);
  const rgb = [0, 2, 4].map(index => parseInt(hex.slice(index, index + 2), 16));
  const darker = rgb.map(value => Math.round(value * 0.82).toString(16).padStart(2, "0")).join("");
  document.documentElement.style.setProperty("--accent", color);
  document.documentElement.style.setProperty("--accent-dark", "#" + darker);
  accentColorInput.value = color;
  try { localStorage.setItem("friendChatAccentColor", color); } catch {}
}
let savedAccentColor = DEFAULT_ACCENT;
try { savedAccentColor = localStorage.getItem("friendChatAccentColor") || DEFAULT_ACCENT; } catch {}
applyAccentColor(savedAccentColor);
accentColorInput.addEventListener("input", () => applyAccentColor(accentColorInput.value));
document.querySelectorAll(".accent-swatch").forEach(button => {
  button.addEventListener("click", () => applyAccentColor(button.dataset.accent));
});
resetAccentBtn.addEventListener("click", () => applyAccentColor(DEFAULT_ACCENT));

function loadAvatar() {
  try {
    const saved = localStorage.getItem("friendChatAvatar");
    return AVATARS.includes(saved) ? saved : DEFAULT_AVATAR;
  } catch { return DEFAULT_AVATAR; }
}
function selectAvatar(avatar) {
  currentAvatar = AVATARS.includes(avatar) ? avatar : DEFAULT_AVATAR;
  try { localStorage.setItem("friendChatAvatar", currentAvatar); } catch {}
  document.querySelectorAll(".avatar-option").forEach(button => {
    const selected = button.dataset.avatar === currentAvatar;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}
selectAvatar(loadAvatar());
document.querySelectorAll(".avatar-option").forEach(button => {
  button.addEventListener("click", () => selectAvatar(button.dataset.avatar));
});

function applyBackgroundColor(color) {
  if (!/^#[0-9a-f]{6}$/i.test(color)) color = DEFAULT_BACKGROUND;
  document.documentElement.style.setProperty("--page-bg", color);
  backgroundColorInput.value = color;
  try { localStorage.setItem("friendChatBackgroundColor", color); } catch {}
}
let savedBackgroundColor = DEFAULT_BACKGROUND;
try {
  savedBackgroundColor = localStorage.getItem("friendChatBackgroundColor") || DEFAULT_BACKGROUND;
} catch {}
applyBackgroundColor(savedBackgroundColor);
backgroundColorInput.addEventListener("input", () => applyBackgroundColor(backgroundColorInput.value));
document.querySelectorAll(".color-swatch").forEach(button => {
  button.addEventListener("click", () => applyBackgroundColor(button.dataset.color));
});
resetBackgroundBtn.addEventListener("click", () => applyBackgroundColor(DEFAULT_BACKGROUND));
const urlMatch = location.pathname.match(/^\/room\/(\d{6})$/);
if (urlMatch) roomNumberInput.value = urlMatch[1];

function storageKey(id) {
  return `urlChatHistory:${id}`;
}
function loadSavedMessages(id) {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey(id)) || "[]");
    return Array.isArray(value) ? value : [];
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
function showHomeError(message) {
  homeError.textContent = message;
  homeError.hidden = false;
}
function clearHomeError() {
  homeError.textContent = "";
  homeError.hidden = true;
}
function setStatus(message, kind = "") {
  statusEl.textContent = message;
  statusEl.className = `status ${kind}`;
}
function renderMessages() {
  messagesEl.replaceChildren();
  currentMessages.forEach(addMessage);
}
function addMessage(message) {
  const mine = message.senderId === clientId;
  const wrap = document.createElement("article");
  wrap.className = `message ${mine ? "mine" : "theirs"}`;
  wrap.dataset.messageId = message.id || "";
  const meta = document.createElement("div");
  meta.className = "meta";
  const time = new Date(message.time);
  const timeText = Number.isNaN(time.getTime()) ? "" : time.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  const avatar = document.createElement("span");
  avatar.className = "message-avatar";
  avatar.textContent = AVATARS.includes(message.avatar) ? message.avatar : DEFAULT_AVATAR;
  meta.append(avatar, document.createTextNode(` ${mine ? "あなた" : (message.name || "匿名")} · ${timeText}`));
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
function renderParticipants(data) {
  const participants = Array.isArray(data.participants) ? data.participants : [];
  participantCount.textContent = String(Number.isFinite(data.count) ? data.count : participants.length);
  participantList.replaceChildren();
  if (!participants.length) {
    const empty = document.createElement("span");
    empty.className = "participant-empty";
    empty.textContent = "参加者はいません";
    participantList.appendChild(empty);
    return;
  }
  participants.forEach(participant => {
    const chip = document.createElement("span");
    chip.className = "participant-chip";
    const dot = document.createElement("span");
    dot.className = "online-dot";
    dot.setAttribute("aria-hidden", "true");
    const name = document.createElement("span");
    const avatar = document.createElement("span");
    avatar.className = "participant-avatar";
    avatar.textContent = AVATARS.includes(participant.avatar) ? participant.avatar : DEFAULT_AVATAR;
    name.textContent = participant.clientId === clientId ? `${participant.name}（あなた）` : participant.name;
    chip.append(avatar, dot, name);
    participantList.appendChild(chip);
  });
}
function setMessages(messages) {
  const seen = new Set();
  currentMessages = messages.filter(message => {
    if (!message || typeof message.text !== "string" || !message.text) return false;
    const id = message.id || `${message.time}-${message.name}-${message.text}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  }).slice(-100);
  renderMessages();
}
function appendMessage(message) {
  const id = message.id || `${message.time}-${message.name}-${message.text}`;
  if (currentMessages.some(item => (item.id || `${item.time}-${item.name}-${item.text}`) === id)) return;
  currentMessages.push(message);
  currentMessages = currentMessages.slice(-100);
  addMessage(message);
  saveMessages(roomId, currentMessages);
}
async function createRoom() {
  clearHomeError();
  currentName = nameInput.value.trim().slice(0, 30);
  const requestedId = roomNumberInput.value.trim();
  if (!currentName) {
    nameInput.focus();
    showHomeError("先に名前を入力してください。");
    return;
  }
  if (requestedId && !/^\d{6}$/.test(requestedId)) {
    roomNumberInput.focus();
    showHomeError("ルームナンバーは6桁の数字で入力してください。");
    return;
  }
  createBtn.disabled = true;
  try {
    const response = await fetch("/api/room", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestedId ? { id: requestedId } : {})
    });
    const data = await response.json();
    if (!response.ok || !data.id) throw new Error(data.error || "ルームを作成できませんでした。");
    localStorage.setItem("chatName", currentName);
    roomNumberInput.value = data.id;
    history.pushState({}, "", `/room/${data.id}`);
    await enterRoom(data.id);
  } catch (error) {
    showHomeError(error.message || "ルームを作成できませんでした。");
  } finally {
    createBtn.disabled = false;
  }
}
async function joinRoom(event) {
  event?.preventDefault();
  clearHomeError();
  currentName = nameInput.value.trim().slice(0, 30);
  const id = roomNumberInput.value.trim();
  if (!currentName) {
    nameInput.focus();
    showHomeError("名前を入力してください。");
    return;
  }
  if (!/^\d{6}$/.test(id)) {
    roomNumberInput.focus();
    showHomeError("ルームナンバーは6桁の数字で入力してください。");
    return;
  }
  joinBtn.disabled = true;
  try {
    const response = await fetch(`/api/room/${id}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "そのルームは見つかりません。");
    localStorage.setItem("chatName", currentName);
    history.pushState({}, "", `/room/${id}`);
    await enterRoom(id);
  } catch (error) {
    showHomeError(error.message || "入室できませんでした。");
  } finally {
    joinBtn.disabled = false;
  }
}
async function enterRoom(id) {
  if (ws) {
    manualLeave = true;
    ws.close();
    ws = null;
  }
  roomId = id;
  currentName = localStorage.getItem("chatName") || currentName || "匿名";
  currentMessages = [];
  savedBackup = loadSavedMessages(id);
  startView.hidden = true;
  chatView.hidden = false;
  roomNumberDisplay.textContent = id;
  messagesEl.replaceChildren();
  participantCount.textContent = "—";
  participantList.replaceChildren();
  if (savedBackup.length) setMessages(savedBackup);
  setStatus("チャットに接続中…", "connecting");

  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${location.host}/?room=${encodeURIComponent(id)}`);
  ws = socket;
  manualLeave = false;
  socket.addEventListener("open", () => {
    if (ws !== socket) return;
    setStatus("リアルタイム接続中", "connected");
    socket.send(JSON.stringify({ type: "join", name: currentName, clientId, avatar: currentAvatar }));
  });
  socket.addEventListener("close", () => {
    if (ws === socket && !manualLeave) {
      setStatus("接続が切れました。ページを再読み込みして再接続してください。", "disconnected");
      participantCount.textContent = "—";
      participantList.replaceChildren();
    }
  });
  socket.addEventListener("error", () => {
    if (ws === socket) setStatus("接続エラー。しばらくしてから再読み込みしてください。", "disconnected");
  });
  socket.addEventListener("message", event => {
    let data;
    try { data = JSON.parse(event.data); } catch { return; }
    if (data.type === "history") {
      if (Array.isArray(data.messages) && data.messages.length > 0) {
        setMessages(data.messages);
        saveMessages(roomId, currentMessages);
      } else if (savedBackup.length) {
        setMessages(savedBackup);
      } else {
        setMessages([]);
      }
    } else if (data.type === "message" && data.message) {
      appendMessage(data.message);
    } else if (data.type === "system") {
      addSystem(data.text);
    } else if (data.type === "participants") {
      renderParticipants(data);
    }
  });
}
joinForm.addEventListener("submit", joinRoom);
createBtn.addEventListener("click", createRoom);
roomNumberInput.addEventListener("input", () => {
  roomNumberInput.value = roomNumberInput.value.replace(/\D/g, "").slice(0, 6);
});
copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(roomId || roomNumberDisplay.textContent);
    copyBtn.textContent = "コピーしました！";
  } catch {
    const range = document.createRange();
    range.selectNodeContents(roomNumberDisplay);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    copyBtn.textContent = "番号を選択しました";
  }
  setTimeout(() => copyBtn.textContent = "番号をコピー", 1500);
});
saveBtn.addEventListener("click", () => {
  if (!roomId) return;
  const ok = saveMessages(roomId, currentMessages);
  saveBtn.textContent = ok ? "保存しました ✓" : "保存できませんでした";
  setTimeout(() => saveBtn.textContent = "トークを保存", 1500);
});
clearBtn.addEventListener("click", () => {
  if (!roomId) return;
  if (!confirm("この端末に保存された、このルームのトーク履歴を削除しますか？")) return;
  localStorage.removeItem(storageKey(roomId));
  savedBackup = [];
  clearBtn.textContent = "削除しました";
  setTimeout(() => clearBtn.textContent = "保存を削除", 1500);
});
sendForm.addEventListener("submit", event => {
  event.preventDefault();
  const text = textInput.value.trim();
  if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: "message", text }));
  textInput.value = "";
  textInput.focus();
});
backBtn.addEventListener("click", () => {
  manualLeave = true;
  if (ws) ws.close();
  ws = null;
  roomId = null;
  chatView.hidden = true;
  startView.hidden = false;
  history.pushState({}, "", "/");
});
window.addEventListener("popstate", () => location.reload());
if (urlMatch) {
  fetch(`/api/room/${urlMatch[1]}`)
    .then(response => response.ok ? enterRoom(urlMatch[1]) : null)
    .catch(() => {});
}
