let socket = null;
let reconnectTimer = null;
let currentState = {
  plastic: 0, paper: 0, metal: 0,
  wasteType: "Unknown", confidence: 0, servo: 90,
  huskylens: false, esp32: false, lastDetection: "None"
};

const $ = (id) => document.getElementById(id);

document.querySelectorAll(".nav-item").forEach(btn => {
  btn.addEventListener("click", () => showPage(btn.dataset.page));
});

document.querySelectorAll("[data-page-target]").forEach(btn => {
  btn.addEventListener("click", () => showPage(btn.dataset.pageTarget));
});

function showPage(page) {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
  $(`page-${page}`)?.classList.add("active");
  document.querySelector(`.nav-item[data-page="${page}"]`)?.classList.add("active");
}

function connectSocket() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${protocol}//${location.host}`);

  socket.addEventListener("open", () => {
    clearTimeout(reconnectTimer);
    $("sidebarConnection").textContent = "Live Monitoring";
    $("systemDot").classList.add("active");
  });

  socket.addEventListener("message", event => {
    try {
      const message = JSON.parse(event.data);
      if (message.type === "state") updateDashboard(message.data);
    } catch {}
  });

  socket.addEventListener("close", () => {
    $("systemDot").classList.remove("active");
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectSocket, 2000);
  });

  socket.addEventListener("error", () => {
    try { socket.close(); } catch {}
  });
}

function updateDashboard(data) {
  currentState = {...currentState, ...data};

  updateBin("plastic", currentState.plastic);
  updateBin("paper", currentState.paper);
  updateBin("metal", currentState.metal);

  const confidence = clamp(currentState.confidence);
  const servo = Math.max(0, Math.min(180, Number(currentState.servo) || 0));

  $("wasteType").textContent = currentState.wasteType || "Unknown";
  $("sortingWasteType").textContent = currentState.wasteType || "Unknown";
  $("confidenceText").textContent = `${Math.round(confidence)}%`;
  $("sortingConfidence").textContent = `${Math.round(confidence)}%`;
  $("confidenceProgress").style.width = `${confidence}%`;
  $("sortingConfidenceBar").style.width = `${confidence}%`;
  $("analyticsConfidence").textContent = `${Math.round(confidence)}%`;

  $("servoAngle").textContent = `${Math.round(servo)}°`;
  $("angleIndicator").style.left = `${(servo / 180) * 100}%`;

  $("lastDetection").textContent = currentState.lastDetection || "None";
  $("lastDetectionOverview").textContent = currentState.lastDetection || "None";

  const husky = Boolean(currentState.huskylens);
  const esp = Boolean(currentState.esp32);

  $("huskylensLive").textContent = husky ? "LIVE" : "WAITING";
  $("sortingLiveStatus").textContent = husky ? "LIVE" : "WAITING";
  $("esp32Health").textContent = esp ? "Online" : "Waiting";
  $("huskylensHealth").textContent = husky ? "Online" : "Waiting";
  $("sortingHuskyStatus").textContent = husky ? "Online" : "Waiting";
  $("sortingESPStatus").textContent = esp ? "Online" : "Waiting";

  if (currentState.updatedAt) {
    const time = new Date(currentState.updatedAt);
    $("updatedText").textContent = `Updated ${time.toLocaleTimeString()}`;
  }
}

function updateBin(type, value) {
  const n = clamp(value);
  const label = type.charAt(0).toUpperCase() + type.slice(1);

  $(`${type}Fill`).textContent = Math.round(n);
  $(`${type}Progress`).style.width = `${n}%`;
  $(`${type}FillLarge`).textContent = Math.round(n);
  $(`${type}ProgressLarge`).style.width = `${n}%`;
  $(`${type}Status`).textContent = statusText(n);
  $(`${type}StatusLarge`).textContent = statusText(n);

  $("analytics" + label).textContent = `${Math.round(n)}%`;
  $("bar" + label).style.height = `${n}%`;
  $("legend" + label).textContent = `${Math.round(n)}%`;

  updateStatusClass($(`${type}Status`), n);
  updateStatusClass($(`${type}StatusLarge`), n);
  updateDonut();
}

function statusText(n) {
  if (n >= 100) return "Full";
  if (n >= 80) return "Warning";
  return "Normal";
}

function updateStatusClass(el, n) {
  if (!el) return;
  el.classList.remove("normal", "warning", "full");
  el.classList.add(n >= 100 ? "full" : n >= 80 ? "warning" : "normal");
}

function updateDonut() {
  const p = clamp(currentState.plastic);
  const pa = clamp(currentState.paper);
  const m = clamp(currentState.metal);
  const total = p + pa + m;

  $("compositionTotal").textContent = `${Math.round(total)}%`;

  if (total <= 0) {
    $("compositionDonut").style.background = "conic-gradient(#e9ece7 0deg 360deg)";
    return;
  }

  const pDeg = p / total * 360;
  const paDeg = pa / total * 360;

  $("compositionDonut").style.background =
    `conic-gradient(#234936 0deg ${pDeg}deg, #b7a46a ${pDeg}deg ${pDeg + paDeg}deg, #65756b ${pDeg + paDeg}deg 360deg)`;
}

function clamp(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
}

async function enableNotifications() {
  if (!("Notification" in window) || !("serviceWorker" in navigator)) {
    alert("Notifications are not supported by this browser.");
    return;
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return;

  const registration = await navigator.serviceWorker.register("/sw.js");
  const keyResponse = await fetch("/api/vapid-public-key");
  const {publicKey} = await keyResponse.json();

  if (!publicKey) {
    alert("VAPID public key is not configured on Render.");
    return;
  }

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey)
  });

  await fetch("/api/subscribe", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(subscription)
  });

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({type: "subscribe", subscription}));
  }

  $("notificationButton").textContent = "🔔";
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(char => char.charCodeAt(0)));
}

$("notificationButton").addEventListener("click", enableNotifications);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

connectSocket();