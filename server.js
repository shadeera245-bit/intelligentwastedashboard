const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = 3000;

app.use(express.static("public"));

let sensorData = {
    wasteType: "Waiting...",
    capacity: 0,
    location: "Level 1 Area A",
    status: "Online"
};

wss.on("connection", (ws) => {
    console.log("Dashboard connected");

    ws.send(JSON.stringify(sensorData));

    ws.on("message", (message) => {
        try {
            const data = JSON.parse(message);

            sensorData = {
                ...sensorData,
                ...data
            };

            wss.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify(sensorData));
                }
            });

        } catch (error) {
            console.log("Invalid data received");
        }
    });

    ws.on("close", () => {
        console.log("Dashboard disconnected");
    });
});

server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});