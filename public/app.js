const home = document.getElementById("home");
const chat = document.getElementById("chat");
const createRoom = document.getElementById("createRoom");
const copyUrl = document.getElementById("copyUrl");
const messages = document.getElementById("messages");
const form = document.getElementById("form");
const nameInput = document.getElementById("name");
const textInput = document.getElementById("text");
const status = document.getElementById("status");

function roomId() {
  return location.pathname.startsWith("/room/")
    ? location.pathname.split("/")[2]
    : null;
}

function showChat() {
  home.classList.add("hidden");
  chat.classList.remove("hidden");
}

function addMessage(message) {
  const item = document.createElement("div");
  item.className = "message";

  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = `${message.name} · ${new Date(message.time).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"})}`;

  const body = document.createElement("div");
  body.className = "body";
  body.textContent = message.text;

  item.append(meta, body);
  messages.appendChild(item);
  messages.scrollTop = messages.scrollHeight;
}

async function makeRoom() {
  const res = await fetch("/api/room");
  const data = await res.json();
  location.href = `/room/${data.id}`;
}

function connect() {
  showChat();
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${location.host}?room=${encodeURIComponent(roomId())}`);

  socket.addEventListener("open", () => {
    status.textContent = "オンライン";
  });

  socket.addEventListener("close", () => {
    status.textContent = "切断されました";
  });

  socket.addEventListener("message", event => {
    const data = JSON.parse(event.data);
    if (data.type === "history") {
      messages.innerHTML = "";
      data.messages.forEach(addMessage);
    } else if (data.type === "message") {
      addMessage(data.message);
    }
  });

  form.addEventListener("submit", event => {
    event.preventDefault();
    const text = textInput.value.trim();
    if (!text || socket.readyState !== WebSocket.OPEN) return;

    socket.send(JSON.stringify({
      type: "message",
      name: nameInput.value.trim() || "匿名",
      text
    }));
    textInput.value = "";
    textInput.focus();
  });
}

createRoom.addEventListener("click", makeRoom);

copyUrl.addEventListener("click", async () => {
  await navigator.clipboard.writeText(location.href);
  const old = copyUrl.textContent;
  copyUrl.textContent = "コピーしました";
  setTimeout(() => copyUrl.textContent = old, 1200);
});

if (roomId()) connect();