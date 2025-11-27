const { EventHubConsumerClient } = require("@azure/event-hubs");
const express = require("express");
const path = require("path");
const https = require("https");
const fs = require("fs");

const EVENT_HUB_NAME = "iothub-ehub-mytrackhub-69020481-3cfd6703c6";
const CONSUMER_GROUP = "$Default";
const PORT = process.env.PORT || 3000;

const TELEGRAM_BOT_TOKEN = "8350895730:AAGfUCIS2iXV_rvRIdOkpEpvyVIk_7XFmNo";
const TELEGRAM_CHAT_ID = "7931850982";

const AUTH_ENABLED = true;
const AUTH_USERNAME = "emmanuel";
const AUTH_PASSWORD = "MyTrack2025!";

const MAPBOX_ACCESS_TOKEN = "pk.eyJ1IjoibmtpbGl5dW13YW1pIiwiYSI6ImNtaWgweTJ6aDAxeDkzZHB6dGN4eHNoeHAifQ.MSok94Ifl-UemvqAOAfTzg";

const MAX_ACCURACY_METERS = 50;
const MIN_DISTANCE_METERS = 3;
const SNAP_BATCH_SIZE = 15;
const SNAP_RADIUS_METERS = 50;
const BATCH_OVERLAP = 3;

let deviceData = {};
let snappedHistory = [];
const SNAPPED_HISTORY_FILE = path.join(__dirname, "snapped_history.json");
const DEVICES_FILE = path.join(__dirname, "devices.json");

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
            console.log("Telegram alert sent!");
        } else {
            console.log("Telegram alert failed:", res.statusCode);
        }
    });

    req.on("error", (e) => {
        console.error("Telegram error:", e.message);
    });

    req.write(data);
    req.end();
}

function loadSnappedHistory() {
    try {
        if (fs.existsSync(SNAPPED_HISTORY_FILE)) {
            snappedHistory = JSON.parse(fs.readFileSync(SNAPPED_HISTORY_FILE, "utf8"));
            console.log("Loaded " + snappedHistory.length + " snapped locations");
        }
    } catch (err) {
        console.log("No snapped history found");
        snappedHistory = [];
    }
}

function saveSnappedHistory() {
    const MAX_POINTS = 20000;
    if (snappedHistory.length > MAX_POINTS) {
        snappedHistory = snappedHistory.slice(-MAX_POINTS);
    }
    fs.writeFileSync(SNAPPED_HISTORY_FILE, JSON.stringify(snappedHistory));
}

function loadDevices() {
    try {
        if (fs.existsSync(DEVICES_FILE)) {
            const saved = JSON.parse(fs.readFileSync(DEVICES_FILE, "utf8"));
            Object.keys(saved).forEach(id => {
                deviceData[id] = {
                    ...saved[id],
                    pendingPoints: [],
                    lastBatchPoints: []
                };
            });
            console.log("Loaded " + Object.keys(deviceData).length + " devices");
        }
    } catch (err) {
        console.log("No saved devices found");
    }
}

function saveDevices() {
    const toSave = {};
    Object.keys(deviceData).forEach(id => {
        toSave[id] = {
            deviceId: deviceData[id].deviceId,
            name: deviceData[id].name,
            color: deviceData[id].color,
            latestLocation: deviceData[id].latestLocation
        };
    });
    fs.writeFileSync(DEVICES_FILE, JSON.stringify(toSave, null, 2));
}

loadSnappedHistory();
loadDevices();

const DEVICE_COLORS = ["#e74c3c", "#3498db", "#2ecc71", "#9b59b6", "#f39c12", "#1abc9c", "#e91e63", "#00bcd4"];
let colorIndex = 0;

function getDeviceColor() {
    const color = DEVICE_COLORS[colorIndex % DEVICE_COLORS.length];
    colorIndex++;
    return color;
}

function initializeDevice(deviceId) {
    if (!deviceData[deviceId]) {
        deviceData[deviceId] = {
            deviceId: deviceId,
            name: deviceId,
            color: getDeviceColor(),
            latestLocation: null,
            lastValidLocation: null,
            pendingPoints: [],
            lastBatchPoints: []
        };
        saveDevices();
        console.log("New device registered: " + deviceId);
    }
    return deviceData[deviceId];
}

async function snapToRoads(points) {
    if (points.length < 2) {
        return null;
    }

    const coordinates = points.map(p => p.longitude + "," + p.latitude).join(";");
    const timestamps = points.map(p => p.timestamp).join(";");
    const radiuses = points.map(() => SNAP_RADIUS_METERS).join(";");

    const url = `https://api.mapbox.com/matching/v5/mapbox/walking/${coordinates}?access_token=${MAPBOX_ACCESS_TOKEN}&geometries=geojson&radiuses=${radiuses}&timestamps=${timestamps}&tidy=true&overview=full&steps=true`;

    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = "";
            res.on("data", chunk => data += chunk);
            res.on("end", () => {
                try {
                    const result = JSON.parse(data);
                    if (result.code === "Ok" && result.matchings && result.matchings.length > 0) {
                        const snappedCoords = result.matchings[0].geometry.coordinates;
                        const confidence = result.matchings[0].confidence;
                        console.log("Snapped " + points.length + " points to " + snappedCoords.length + " road points (confidence: " + (confidence * 100).toFixed(1) + "%)");
                        resolve(snappedCoords);
                    } else {
                        console.log("Map matching failed:", result.code || result.message || "Unknown error");
                        resolve(null);
                    }
                } catch (err) {
                    console.log("Map matching parse error:", err.message);
                    resolve(null);
                }
            });
        }).on("error", (err) => {
            console.log("Map matching request error:", err.message);
            resolve(null);
        });
    });
}

async function processAndSnapPoints(deviceId) {
    const device = deviceData[deviceId];
    if (!device || device.pendingPoints.length < SNAP_BATCH_SIZE) {
        return;
    }

    let pointsToSnap = [];

    if (device.lastBatchPoints.length > 0) {
        pointsToSnap = [...device.lastBatchPoints.slice(-BATCH_OVERLAP), ...device.pendingPoints.slice(0, SNAP_BATCH_SIZE)];
    } else {
        pointsToSnap = device.pendingPoints.slice(0, SNAP_BATCH_SIZE);
    }

    device.lastBatchPoints = device.pendingPoints.splice(0, SNAP_BATCH_SIZE);

    const snappedCoords = await snapToRoads(pointsToSnap);

    if (snappedCoords && snappedCoords.length > 0) {
        const now = new Date().toISOString();
        const startIndex = device.lastBatchPoints.length > 0 ? BATCH_OVERLAP : 0;

        for (let i = startIndex; i < snappedCoords.length; i++) {
            const coord = snappedCoords[i];
            snappedHistory.push({
                deviceId: deviceId,
                latitude: coord[1],
                longitude: coord[0],
                snapped: true,
                savedAt: now
            });
        }

        saveSnappedHistory();
        console.log("Added " + (snappedCoords.length - startIndex) + " snapped points for " + deviceId);
    } else {
        device.lastBatchPoints.forEach(p => {
            snappedHistory.push({
                ...p,
                snapped: false,
                savedAt: new Date().toISOString()
            });
        });
        saveSnappedHistory();
    }
}

let geofences = [];
let geofenceStates = {};
const GEOFENCE_FILE = path.join(__dirname, "geofences.json");

function loadGeofences() {
    try {
        if (fs.existsSync(GEOFENCE_FILE)) {
            geofences = JSON.parse(fs.readFileSync(GEOFENCE_FILE, "utf8"));
            console.log("Loaded " + geofences.length + " geofences");
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
    const p1 = lat1 * Math.PI / 180;
    const p2 = lat2 * Math.PI / 180;
    const dp = (lat2 - lat1) * Math.PI / 180;
    const dl = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(dp / 2) * Math.sin(dp / 2) +
        Math.cos(p1) * Math.cos(p2) *
        Math.sin(dl / 2) * Math.sin(dl / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

function checkGeofences(deviceId, lat, lon) {
    geofences.forEach(gf => {
        const distance = calculateDistance(lat, lon, gf.lat, gf.lng);
        const isInside = distance <= gf.radius;
        const stateKey = deviceId + "-" + gf.id;
        const wasInside = geofenceStates[stateKey] || false;

        if (!wasInside && isInside) {
            const deviceName = deviceData[deviceId]?.name || deviceId;
            const message = "<b>ENTERED: " + gf.name + "</b>\n\n" +
                "Device: " + deviceName + "\n" +
                "Location: " + lat.toFixed(6) + ", " + lon.toFixed(6) + "\n" +
                "Time: " + new Date().toLocaleString();

            console.log(deviceId + " entered " + gf.name);
            sendTelegramAlert(message);
        } else if (wasInside && !isInside) {
            const deviceName = deviceData[deviceId]?.name || deviceId;
            const message = "<b>EXITED: " + gf.name + "</b>\n\n" +
                "Device: " + deviceName + "\n" +
                "Location: " + lat.toFixed(6) + ", " + lon.toFixed(6) + "\n" +
                "Time: " + new Date().toLocaleString();

            console.log(deviceId + " exited " + gf.name);
            sendTelegramAlert(message);
        }

        geofenceStates[stateKey] = isInside;
    });
}

loadGeofences();

const app = express();

app.set('trust proxy', 1);

function basicAuth(req, res, next) {
    if (!AUTH_ENABLED) {
        return next();
    }

    const authHeader = req.headers.authorization;

    if (!authHeader) {
        res.setHeader('WWW-Authenticate', 'Basic realm="MyTrackHub"');
        return res.status(401).send('Authentication required');
    }

    const base64Credentials = authHeader.split(' ')[1];
    const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
    const [username, password] = credentials.split(':');

    if (username === AUTH_USERNAME && password === AUTH_PASSWORD) {
        return next();
    }

    res.setHeader('WWW-Authenticate', 'Basic realm="MyTrackHub"');
    return res.status(401).send('Invalid credentials');
}

app.use(basicAuth);

app.use(express.static(__dirname));
app.use(express.json());

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/api/devices", (req, res) => {
    const devices = Object.values(deviceData).map(d => ({
        deviceId: d.deviceId,
        name: d.name,
        color: d.color,
        latestLocation: d.latestLocation
    }));
    res.json(devices);
});

app.put("/api/devices/:deviceId", (req, res) => {
    const { deviceId } = req.params;
    const { name, color } = req.body;

    if (deviceData[deviceId]) {
        if (name) deviceData[deviceId].name = name;
        if (color) deviceData[deviceId].color = color;
        saveDevices();
        res.json({ success: true, device: deviceData[deviceId] });
    } else {
        res.status(404).json({ error: "Device not found" });
    }
});

app.post("/api/geofences", (req, res) => {
    geofences = req.body;
    saveGeofences();
    console.log("Saved " + geofences.length + " geofences");
    res.json({ success: true });
});

app.get("/api/geofences", (req, res) => {
    res.json(geofences);
});

app.get("/api/test-telegram", (req, res) => {
    sendTelegramAlert("<b>Test Alert</b>\n\nYour MyTrackHub Telegram notifications are working!");
    res.json({ success: true, message: "Test alert sent!" });
});

app.get("/api/history", (req, res) => {
    const { start, end, deviceId } = req.query;

    let filtered = snappedHistory;

    if (deviceId) {
        filtered = filtered.filter(loc => loc.deviceId === deviceId);
    }

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
    const dateCounts = {};
    snappedHistory.forEach(loc => {
        const date = new Date(loc.savedAt).toISOString().split('T')[0];
        dateCounts[date] = (dateCounts[date] || 0) + 1;
    });
    res.json(dateCounts);
});

app.delete("/api/history", (req, res) => {
    const { deviceId } = req.query;

    if (deviceId) {
        snappedHistory = snappedHistory.filter(loc => loc.deviceId !== deviceId);
        if (deviceData[deviceId]) {
            deviceData[deviceId].pendingPoints = [];
            deviceData[deviceId].lastBatchPoints = [];
        }
    } else {
        snappedHistory = [];
        Object.keys(deviceData).forEach(id => {
            deviceData[id].pendingPoints = [];
            deviceData[id].lastBatchPoints = [];
        });
    }

    saveSnappedHistory();
    res.json({ success: true, message: "History cleared" });
});

let sseClients = [];

app.get("/events", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.flushHeaders();

    console.log("Browser connected via SSE");

    // FIXED: Send devices in the format the frontend expects
    const allDevices = Object.values(deviceData)
        .filter(d => d.latestLocation)
        .map(d => ({
            deviceId: d.deviceId,
            name: d.name,
            color: d.color,
            location: d.latestLocation
        }));

    if (allDevices.length > 0) {
        res.write("data: " + JSON.stringify({ type: "all", devices: allDevices }) + "\n\n");
    }

    sseClients.push(res);

    req.on("close", () => {
        console.log("Browser disconnected");
        sseClients = sseClients.filter(client => client !== res);
    });
});

app.get("/api/locations", (req, res) => {
    const allDevices = Object.values(deviceData)
        .filter(d => d.latestLocation)
        .map(d => ({
            deviceId: d.deviceId,
            name: d.name,
            color: d.color,
            location: d.latestLocation
        }));
    res.json(allDevices);
});

const server = app.listen(PORT, '127.0.0.1', () => {
    console.log("\nMyTrackHub running on port " + PORT);
    console.log("Public URL: https://track.smartviewafrica.com");
    console.log("Authentication: " + (AUTH_ENABLED ? "ENABLED" : "DISABLED"));
    console.log("Multi-Device: ENABLED");
    console.log("Mapbox Road Snapping: ENABLED");
    console.log("Telegram alerts: ENABLED\n");
});

function broadcastLocation(deviceId, location) {
    const device = deviceData[deviceId];
    const message = JSON.stringify({
        type: "update",
        deviceId: deviceId,
        name: device?.name || deviceId,
        color: device?.color || "#e74c3c",
        location: location
    });

    sseClients.forEach(client => {
        client.write("data: " + message + "\n\n");
    });
}

async function connectToIoTHub() {
    const eventHubConnectionString = "Endpoint=sb://ihsuprodblres069dednamespace.servicebus.windows.net/;SharedAccessKeyName=iothubowner;SharedAccessKey=itc+vGUiyCjcuEQpW0RnBZEZA7dkLZ+GzAIoTD9xJsQ=;EntityPath=iothub-ehub-mytrackhub-69020481-3cfd6703c6";

    const consumerClient = new EventHubConsumerClient(
        CONSUMER_GROUP,
        eventHubConnectionString
    );

    console.log("Connected to IoT Hub Event Stream");
    console.log("Waiting for location updates from OwnTracks...\n");

    const subscription = consumerClient.subscribe({
        processEvents: async (events, context) => {
            for (const event of events) {
                try {
                    const payload = event.body;

                    if (payload._type === "location") {
                        const deviceId = event.systemProperties["iothub-connection-device-id"];
                        const accuracy = payload.acc || 10;
                        const timestamp = payload.tst;

                        if (accuracy > MAX_ACCURACY_METERS) {
                            console.log("Filtered [" + deviceId + "]: Poor accuracy (" + accuracy + "m)");
                            continue;
                        }

                        const device = initializeDevice(deviceId);

                        if (device.lastValidLocation) {
                            const distance = calculateDistance(
                                device.lastValidLocation.latitude,
                                device.lastValidLocation.longitude,
                                payload.lat,
                                payload.lon
                            );
                            if (distance < MIN_DISTANCE_METERS) {
                                continue;
                            }
                        }

                        const location = {
                            deviceId: deviceId,
                            latitude: payload.lat,
                            longitude: payload.lon,
                            accuracy: accuracy,
                            altitude: payload.alt,
                            battery: payload.batt,
                            velocity: payload.vel,
                            connection: payload.conn,
                            ssid: payload.SSID,
                            timestamp: timestamp,
                            receivedAt: new Date().toISOString()
                        };

                        device.latestLocation = location;
                        device.lastValidLocation = location;
                        saveDevices();

                        device.pendingPoints.push({
                            deviceId: deviceId,
                            latitude: payload.lat,
                            longitude: payload.lon,
                            accuracy: accuracy,
                            timestamp: timestamp,
                            battery: payload.batt
                        });

                        console.log("Location from " + deviceId + ": " + payload.lat.toFixed(6) + ", " + payload.lon.toFixed(6) + " | Acc: " + accuracy + "m | Pending: " + device.pendingPoints.length);

                        if (device.pendingPoints.length >= SNAP_BATCH_SIZE) {
                            processAndSnapPoints(deviceId);
                        }

                        checkGeofences(deviceId, payload.lat, payload.lon);
                        broadcastLocation(deviceId, location);
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

    setInterval(async () => {
        for (const deviceId of Object.keys(deviceData)) {
            const device = deviceData[deviceId];
            if (device.pendingPoints.length >= 2) {
                console.log("Auto-snapping " + device.pendingPoints.length + " points for " + deviceId);

                let pointsToSnap = [];
                if (device.lastBatchPoints.length > 0) {
                    pointsToSnap = [...device.lastBatchPoints.slice(-BATCH_OVERLAP), ...device.pendingPoints];
                } else {
                    pointsToSnap = [...device.pendingPoints];
                }

                const snappedCoords = await snapToRoads(pointsToSnap);

                if (snappedCoords && snappedCoords.length > 0) {
                    const now = new Date().toISOString();
                    const startIndex = device.lastBatchPoints.length > 0 ? BATCH_OVERLAP : 0;

                    for (let i = startIndex; i < snappedCoords.length; i++) {
                        snappedHistory.push({
                            deviceId: deviceId,
                            latitude: snappedCoords[i][1],
                            longitude: snappedCoords[i][0],
                            snapped: true,
                            savedAt: now
                        });
                    }

                    device.lastBatchPoints = [...device.pendingPoints];
                    device.pendingPoints = [];
                    saveSnappedHistory();
                }
            }
        }
    }, 30000);

    process.on("SIGINT", async () => {
        console.log("\nShutting down...");

        for (const deviceId of Object.keys(deviceData)) {
            const device = deviceData[deviceId];
            if (device.pendingPoints.length >= 2) {
                console.log("Snapping remaining points for " + deviceId);
                let pointsToSnap = device.lastBatchPoints.length > 0
                    ? [...device.lastBatchPoints.slice(-BATCH_OVERLAP), ...device.pendingPoints]
                    : [...device.pendingPoints];

                const snappedCoords = await snapToRoads(pointsToSnap);
                if (snappedCoords) {
                    const now = new Date().toISOString();
                    const startIndex = device.lastBatchPoints.length > 0 ? BATCH_OVERLAP : 0;

                    for (let i = startIndex; i < snappedCoords.length; i++) {
                        snappedHistory.push({
                            deviceId: deviceId,
                            latitude: snappedCoords[i][1],
                            longitude: snappedCoords[i][0],
                            snapped: true,
                            savedAt: now
                        });
                    }
                }
            }
        }

        saveSnappedHistory();
        saveDevices();
        await subscription.close();
        await consumerClient.close();
        process.exit(0);
    });
}

connectToIoTHub().catch(console.error);