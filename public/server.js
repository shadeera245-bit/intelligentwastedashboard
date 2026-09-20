const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static("public"));

let sensorData = {
  capacity: 0,
  wasteType: "Unknown",
  status: "Available"
};

wss.on("connection", (ws) => {
  console.log("Device connected");

  ws.send(JSON.stringify(sensorData));

  ws.on("message", (message) => {
    sensorData = JSON.parse(message);

    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(sensorData));
      }
    });
  });
});

server.listen(3000, () => {
  console.log("Server running at http://localhost:3000");
});