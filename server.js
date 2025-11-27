const { EventHubConsumerClient } = require("@azure/event-hubs");
const express = require("express");
const path = require("path");
const https = require("https");
const fs = require("fs");

// ============================================
// CONFIGURATION
// ============================================
const EVENT_HUB_NAME = "iothub-ehub-mytrackhub-69020481-3cfd6703c6";
const CONSUMER_GROUP = "$Default";
const PORT = 3000;

// Telegram Configuration
const TELEGRAM_BOT_TOKEN = "8350895730:AAGfUCIS2iXV_rvRIdOkpEpvyVIk_7XFmNo";
const TELEGRAM_CHAT_ID = "7931850982";

// ============================================
// TELEGRAM NOTIFICATION FUNCTION
// ============================================
function sendTelegramAlert(message) {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const data = JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: "HTML"
    });

    const options = {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Content-Length": data.length
        }
    };

    const req = https.request(url, options, (res) => {
        if (res.statusCode === 200) {
            console.log("📱 Telegram alert sent successfully!");
        } else {
            console.log(`⚠️ Telegram alert failed: ${res.statusCode}`);
        }
    });

    req.on("error", (e) => {
        console.error("❌ Telegram error:", e.message);
    });

    req.write(data);
    req.end();
}

// ============================================
// GEOFENCE STORAGE & CHECKING
// ============================================
let geofences = [];
let geofenceStates = {};

const GEOFENCE_FILE = path.join(__dirname, "geofences.json");
const HISTORY_FILE = path.join(__dirname, "location_history.json");

// Location history storage
let locationHistory = [];
const MAX_HISTORY_POINTS = 10000; // Keep last 10,000 points

function loadLocationHistory() {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            locationHistory = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
            console.log(`📜 Loaded ${locationHistory.length} historical locations`);
        }
    } catch (err) {
        console.log("No location history found");
        locationHistory = [];
    }
}

function saveLocationHistory() {
    // Keep only last MAX_HISTORY_POINTS
    if (locationHistory.length > MAX_HISTORY_POINTS) {
        locationHistory = locationHistory.slice(-MAX_HISTORY_POINTS);
    }
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(locationHistory));
}

function addToHistory(location) {
    locationHistory.push({
        ...location,
        savedAt: new Date().toISOString()
    });

    // Save every 10 new points to reduce disk writes
    if (locationHistory.length % 10 === 0) {
        saveLocationHistory();
    }
}

loadLocationHistory();

function loadGeofences() {
    try {
        if (fs.existsSync(GEOFENCE_FILE)) {
            geofences = JSON.parse(fs.readFileSync(GEOFENCE_FILE, "utf8"));
            console.log(`📍 Loaded ${geofences.length} geofences`);
        }
    } catch (err) {
        console.log("No saved geofences found");
    }
}

function saveGeofences() {
    fs.writeFileSync(GEOFENCE_FILE, JSON.stringify(geofences, null, 2));
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

function checkGeofences(deviceId, lat, lon) {
    geofences.forEach(gf => {
        const distance = calculateDistance(lat, lon, gf.lat, gf.lng);
        const isInside = distance <= gf.radius;
        const stateKey = `${deviceId}-${gf.id}`;
        const wasInside = geofenceStates[stateKey] || false;

        if (!wasInside && isInside) {
            const message = `🟢 <b>ENTERED: ${gf.name}</b>\n\n` +
                `📱 Device: ${deviceId}\n` +
                `📍 Location: ${lat.toFixed(6)}, ${lon.toFixed(6)}\n` +
                `⏰ Time: ${new Date().toLocaleString()}`;

            console.log(`🟢 ${deviceId} entered ${gf.name}`);
            sendTelegramAlert(message);
        } else if (wasInside && !isInside) {
            const message = `🔴 <b>EXITED: ${gf.name}</b>\n\n` +
                `📱 Device: ${deviceId}\n` +
                `📍 Location: ${lat.toFixed(6)}, ${lon.toFixed(6)}\n` +
                `⏰ Time: ${new Date().toLocaleString()}`;

            console.log(`🔴 ${deviceId} exited ${gf.name}`);
            sendTelegramAlert(message);
        }

        geofenceStates[stateKey] = isInside;
    });
}

loadGeofences();

// ============================================
// EXPRESS SERVER
// ============================================
const app = express();
app.use(express.static(__dirname));
app.use(express.json());

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

// Geofence API endpoints
app.post("/api/geofences", (req, res) => {
    geofences = req.body;
    saveGeofences();
    console.log(`📍 Saved ${geofences.length} geofences`);
    res.json({ success: true });
});

app.get("/api/geofences", (req, res) => {
    res.json(geofences);
});

// Test Telegram endpoint
app.get("/api/test-telegram", (req, res) => {
    sendTelegramAlert("🧪 <b>Test Alert</b>\n\nYour MyTrackHub Telegram notifications are working!");
    res.json({ success: true, message: "Test alert sent!" });
});

// History API endpoints
app.get("/api/history", (req, res) => {
    const { start, end, deviceId } = req.query;

    let filtered = locationHistory;

    // Filter by device
    if (deviceId) {
        filtered = filtered.filter(loc => loc.deviceId === deviceId);
    }

    // Filter by date range
    if (start) {
        const startDate = new Date(start);
        filtered = filtered.filter(loc => new Date(loc.savedAt) >= startDate);
    }
    if (end) {
        const endDate = new Date(end);
        filtered = filtered.filter(loc => new Date(loc.savedAt) <= endDate);
    }

    res.json({
        total: filtered.length,
        locations: filtered
    });
});

app.get("/api/history/dates", (req, res) => {
    // Get unique dates with location counts
    const dateCounts = {};
    locationHistory.forEach(loc => {
        const date = new Date(loc.savedAt).toISOString().split('T')[0];
        dateCounts[date] = (dateCounts[date] || 0) + 1;
    });
    res.json(dateCounts);
});

app.delete("/api/history", (req, res) => {
    locationHistory = [];
    saveLocationHistory();
    res.json({ success: true, message: "History cleared" });
});

// ============================================
// SERVER-SENT EVENTS (SSE)
// ============================================
let latestLocation = null;
let sseClients = [];

app.get("/events", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.flushHeaders();

    console.log("🌐 Browser connected via SSE");

    if (latestLocation) {
        res.write(`data: ${JSON.stringify(latestLocation)}\n\n`);
    }

    sseClients.push(res);

    req.on("close", () => {
        console.log("🌐 Browser disconnected");
        sseClients = sseClients.filter(client => client !== res);
    });
});

app.get("/api/location", (req, res) => {
    res.json(latestLocation || { error: "No location data yet" });
});

const server = app.listen(PORT, () => {
    console.log(`\n🗺️  Live Map running at: http://localhost:${PORT}`);
    console.log(`📡 Connecting to IoT Hub...`);
    console.log(`📱 Telegram alerts enabled`);
    console.log(`🧪 Test Telegram: http://localhost:${PORT}/api/test-telegram\n`);
});

function broadcastLocation(location) {
    const message = `data: ${JSON.stringify(location)}\n\n`;
    sseClients.forEach(client => {
        client.write(message);
    });
}

// ============================================
// IOT HUB EVENT LISTENER
// ============================================
async function connectToIoTHub() {
    const eventHubConnectionString = `Endpoint=sb://ihsuprodblres069dednamespace.servicebus.windows.net/;SharedAccessKeyName=service;SharedAccessKey=sHs5aAJUmFMc8ac0dgzvxaulDXbO828cNAIoTIu0yu8=;EntityPath=${EVENT_HUB_NAME}`;

    const consumerClient = new EventHubConsumerClient(
        CONSUMER_GROUP,
        eventHubConnectionString
    );

    console.log("✅ Connected to IoT Hub Event Stream");
    console.log("⏳ Waiting for location updates from OwnTracks...\n");

    const subscription = consumerClient.subscribe({
        processEvents: async (events, context) => {
            for (const event of events) {
                try {
                    const payload = event.body;

                    if (payload._type === "location") {
                        const deviceId = event.systemProperties["iothub-connection-device-id"];

                        latestLocation = {
                            deviceId: deviceId,
                            latitude: payload.lat,
                            longitude: payload.lon,
                            accuracy: payload.acc,
                            altitude: payload.alt,
                            battery: payload.batt,
                            velocity: payload.vel,
                            connection: payload.conn,
                            ssid: payload.SSID,
                            timestamp: payload.tst,
                            receivedAt: new Date().toISOString()
                        };

                        console.log(`📍 Location update from ${deviceId}: ${payload.lat.toFixed(6)}, ${payload.lon.toFixed(6)} | Battery: ${payload.batt}%`);

                        // Save to history
                        addToHistory(latestLocation);

                        // Check geofences and send Telegram alerts
                        checkGeofences(deviceId, payload.lat, payload.lon);

                        broadcastLocation(latestLocation);
                    }
                } catch (err) {
                    console.error("Error processing event:", err.message);
                }
            }
        },
        processError: async (err, context) => {
            console.error("Error receiving events:", err.message);
        }
    }, { startPosition: { enqueuedOn: new Date() } });

    process.on("SIGINT", async () => {
        console.log("\n🛑 Shutting down...");
        saveLocationHistory(); // Save history before exit
        await subscription.close();
        await consumerClient.close();
        process.exit(0);
    });
}

connectToIoTHub().catch(console.error);