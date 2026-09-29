require("dotenv").config();

const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const webpush = require("web-push");

const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));

// ==========================================
// DASHBOARD STATE
// ==========================================

const state = {
  plastic: 0,
  paper: 0,
  metal: 0,

  wasteType: "Unknown",
  confidence: 0,
  servo: 90,

  huskylens: false,
  esp32: false,

  lastDetection: "None",
  updatedAt: null
};

// ==========================================
// CLIENT LISTS
// ==========================================

const browserClients = new Set();
const espClients = new Set();
const subscriptions = new Map();

// ==========================================
// WEB PUSH
// ==========================================

if (
  process.env.VAPID_PUBLIC_KEY &&
  process.env.VAPID_PRIVATE_KEY
) {
  webpush.setVapidDetails(
    process.env.VAPID_EMAIL || "mailto:admin@example.com",
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

// ==========================================
// NUMBER CLEANER
// ==========================================

function cleanNumber(value, fallback = 0) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return fallback;
  }

  return Math.max(0, Math.min(100, n));
}

// ==========================================
// NORMALIZE ESP32 DATA
// ==========================================

function normalizePayload(data) {
  return {
    plastic: cleanNumber(data.plastic),

    paper: cleanNumber(data.paper),

    metal: cleanNumber(data.metal),

    wasteType:
      typeof data.wasteType === "string"
        ? data.wasteType
        : "Unknown",

    confidence:
      cleanNumber(data.confidence),

    servo:
      Math.max(
        0,
        Math.min(
          180,
          Number(data.servo) || 0
        )
      ),

    // Support BOTH:
    // huskylens
    // huskylensConnected

    huskylens:
      data.huskylens !== undefined
        ? Boolean(data.huskylens)
        : Boolean(data.huskylensConnected),

    esp32: true,

    lastDetection:
      typeof data.lastDetection === "string"
        ? data.lastDetection
        : (
            typeof data.wasteType === "string"
              ? data.wasteType
              : "None"
          ),

    updatedAt: new Date().toISOString()
  };
}

// ==========================================
// BROADCAST TO DASHBOARD
// ==========================================

function broadcast(message) {
  const text = JSON.stringify(message);

  for (const ws of browserClients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(text);
    }
  }
}

// ==========================================
// PUSH NOTIFICATION
// ==========================================

async function sendPushNotification(
  title,
  body,
  tag
) {
  if (
    !process.env.VAPID_PUBLIC_KEY ||
    !process.env.VAPID_PRIVATE_KEY
  ) {
    return;
  }

  const payload = JSON.stringify({
    title,
    body,
    tag,
    icon: "/assets/logo.png"
  });

  for (const [id, sub] of subscriptions.entries()) {
    try {
      await webpush.sendNotification(
        sub,
        payload
      );
    } catch (err) {
      if (
        err.statusCode === 404 ||
        err.statusCode === 410
      ) {
        subscriptions.delete(id);
      }
    }
  }
}

// ==========================================
// BIN ALERTS
// ==========================================

const previousLevels = {
  plastic: 0,
  paper: 0,
  metal: 0
};

async function checkAlerts(next) {
  for (
    const type of [
      "plastic",
      "paper",
      "metal"
    ]
  ) {
    const oldValue =
      previousLevels[type];

    const newValue =
      next[type];

    // 80% WARNING
    if (
      oldValue < 80 &&
      newValue >= 80 &&
      newValue < 100
    ) {
      await sendPushNotification(
        `${capitalize(type)} Bin Warning`,

        `${capitalize(type)} bin has reached ${Math.round(
          newValue
        )}%.`,

        `${type}-warning`
      );
    }

    // 100% FULL
    if (
      oldValue < 100 &&
      newValue >= 100
    ) {
      await sendPushNotification(
        `${capitalize(type)} Bin Full`,

        `${capitalize(type)} bin is full. Please empty the bin.`,

        `${type}-full`
      );
    }

    previousLevels[type] =
      newValue;
  }
}

// ==========================================
// CAPITALIZE
// ==========================================

function capitalize(value) {
  return (
    value.charAt(0).toUpperCase() +
    value.slice(1)
  );
}

// ==========================================
// WEBSOCKET CONNECTION
// ==========================================

wss.on("connection", (ws) => {

  ws.isAlive = true;

  // ----------------------------------------
  // PONG
  // ----------------------------------------

  ws.on("pong", () => {
    ws.isAlive = true;
  });

  // ----------------------------------------
  // SEND CURRENT STATE
  // ----------------------------------------

  ws.send(
    JSON.stringify({
      type: "state",
      data: state
    })
  );

  // ----------------------------------------
  // RECEIVE MESSAGE
  // ----------------------------------------

  ws.on("message", async (raw) => {

    try {

      const message =
        JSON.parse(
          raw.toString()
        );

      // ======================================
      // ESP32 DATA
      //
      // Accept BOTH:
      //
      // type: "esp32"
      //
      // AND
      //
      // type: "sensorData"
      // ======================================

      if (
        message.type === "esp32" ||
        message.type === "sensorData"
      ) {

        const rawData =
          message.data || message;

        const next =
          normalizePayload(
            rawData
          );

        // Update dashboard state
        Object.assign(
          state,
          next
        );

        // Mark this WebSocket
        // as ESP32
        espClients.add(ws);

        // Debug log
        console.log(
          "ESP32 DATA RECEIVED:"
        );

        console.log(
          JSON.stringify(
            next,
            null,
            2
          )
        );

        // Send updated state
        // to browser/dashboard
        broadcast({
          type: "state",
          data: state
        });

        // Check bin alerts
        await checkAlerts(
          next
        );

        return;
      }

      // ======================================
      // PUSH SUBSCRIPTION
      // ======================================

      if (
        message.type === "subscribe"
      ) {

        if (
          message.subscription &&
          message.subscription.endpoint
        ) {

          const id =
            message.subscription.endpoint;

          subscriptions.set(
            id,
            message.subscription
          );

          ws.send(
            JSON.stringify({
              type:
                "notificationSubscribed",

              ok: true
            })
          );
        }

        return;
      }

      // ======================================
      // PING
      // ======================================

      if (
        message.type === "ping"
      ) {

        ws.send(
          JSON.stringify({
            type: "pong"
          })
        );

        return;
      }

    } catch (err) {

      console.error(
        "WebSocket message error:",
        err.message
      );

    }

  });

  // ----------------------------------------
  // CONNECTION CLOSED
  // ----------------------------------------

  ws.on("close", () => {

    browserClients.delete(ws);

    espClients.delete(ws);

  });

  // ----------------------------------------
  // Initially treat connection as browser.
  // If it sends ESP32 data, it is also added
  // to espClients.
  // ----------------------------------------

  browserClients.add(ws);

});

// ==========================================
// WEBSOCKET HEARTBEAT
// ==========================================

setInterval(() => {

  for (
    const ws of wss.clients
  ) {

    if (
      ws.isAlive === false
    ) {

      ws.terminate();

      continue;
    }

    ws.isAlive = false;

    ws.ping();
  }

}, 30000);

// ==========================================
// API: CURRENT STATE
// ==========================================

app.get(
  "/api/state",
  (req, res) => {

    res.json(state);

  }
);

// ==========================================
// API: VAPID PUBLIC KEY
// ==========================================

app.get(
  "/api/vapid-public-key",
  (req, res) => {

    res.json({
      publicKey:
        process.env.VAPID_PUBLIC_KEY ||
        ""
    });

  }
);

// ==========================================
// API: SUBSCRIBE
// ==========================================

app.post(
  "/api/subscribe",
  (req, res) => {

    const subscription =
      req.body;

    if (
      !subscription ||
      !subscription.endpoint
    ) {

      return res
        .status(400)
        .json({
          error:
            "Invalid subscription"
        });
    }

    subscriptions.set(
      subscription.endpoint,
      subscription
    );

    res.json({
      ok: true
    });

  }
);

// ==========================================
// HEALTH CHECK
// ==========================================

app.get(
  "/health",
  (req, res) => {

    res.json({

      ok: true,

      service:
        "Intelligent Waste Dashboard",

      time:
        new Date().toISOString()

    });

  }
);

// ==========================================
// SERVE DASHBOARD
// ==========================================

app.get(
  "*",
  (req, res) => {

    res.sendFile(
      require("path").join(
        __dirname,
        "public",
        "index.html"
      )
    );

  }
);

// ==========================================
// START SERVER
// ==========================================

server.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `Intelligent Waste Dashboard running on port ${PORT}`
    );

  }
);