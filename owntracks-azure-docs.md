# OwnTracks + Azure IoT Hub Configuration Guide

## Overview

This document describes a working configuration for connecting the OwnTracks mobile app to Azure IoT Hub via MQTT protocol for real-time location tracking.

**Architecture:**
```
OwnTracks (Android/iOS) → MQTT (Port 8883/TLS) → Azure IoT Hub → [Storage/Analytics/Automation]
```

---

## Prerequisites

- Azure subscription with IoT Hub created
- OwnTracks app installed on mobile device
- Azure CLI installed (for SAS token generation)

---

## Azure IoT Hub Setup

### 1. Create IoT Hub
```bash
az group create --name MyTrackHub-RG --location eastus
az iot hub create --name MyTrackHub-Emmanuel --resource-group MyTrackHub-RG --sku F1
```

### 2. Register Device
```bash
az iot hub device-identity create --hub-name MyTrackHub-Emmanuel --device-id SamsungS24
```

### 3. Generate SAS Token (1-year validity)
```bash
az iot hub generate-sas-token --device-id SamsungS24 --hub-name MyTrackHub-Emmanuel --duration 31536000
```

**Output example:**
```json
{
  "sas": "SharedAccessSignature sr=MyTrackHub-Emmanuel.azure-devices.net%2Fdevices%2FSamsungS24&sig=kkFB2RAzuTuEMuswQXJFGhQ6sxRyOnCjPxrGeJUvKY8%3D&se=1795636539"
}
```

---

## OwnTracks Configuration

### Critical Settings for Azure IoT Hub

| Setting | Value | Notes |
|---------|-------|-------|
| `host` | `{hub-name}.azure-devices.net` | Your IoT Hub hostname |
| `port` | `8883` | MQTT over TLS |
| `tls` | `true` | Required by Azure |
| `username` | `{hub-name}.azure-devices.net/{device-id}/?api-version=2021-04-12` | Azure MQTT username format |
| `password` | `SharedAccessSignature sr=...` | SAS token from Azure CLI |
| `clientId` | `{device-id}` | Must match device ID in IoT Hub |
| `pubTopicBase` | `devices/{device-id}/messages/events/` | **Must end with `/events/`** |
| `subTopic` | `devices/{device-id}/messages/devicebound/#` | For cloud-to-device messages |
| `pubQos` | `1` | Azure max QoS is 1 |
| `subQos` | `1` | Azure max QoS is 1 |
| `pubRetain` | `false` | Azure doesn't support retained messages |
| `cleanSession` | `true` | Recommended for Azure |
| `keepalive` | `1177` | Max supported by Azure (1767/1.5) |

### Common Mistakes to Avoid

1. **Wrong publish topic** — Must be `devices/{device-id}/messages/events/` (with trailing slash)
2. **QoS set to 2** — Azure IoT Hub only supports QoS 0 and 1
3. **Retained messages enabled** — Azure doesn't support MQTT retained messages
4. **Expired SAS token** — Regenerate before expiry

---

## Complete Working Configuration File

Save as `config.otrc` and import into OwnTracks:

```json
{
  "_type": "configuration",
  "_id": "216c69e0",
  "waypoints": [],
  "_build": 420504022,
  "autostartOnBoot": true,
  "cleanSession": true,
  "clientId": "SamsungS24",
  "cmd": true,
  "connectionTimeoutSeconds": 30,
  "debugLog": false,
  "deviceId": "events",
  "discardNetworkLocationThresholdSeconds": 0,
  "enableMapRotation": true,
  "encryptionKey": "",
  "experimentalFeatures": [],
  "extendedData": true,
  "fusedRegionDetection": true,
  "host": "MyTrackHub-Emmanuel.azure-devices.net",
  "ignoreInaccurateLocations": 0,
  "ignoreStaleLocations": 0.0,
  "info": true,
  "keepalive": 1177,
  "locatorDisplacement": 500,
  "locatorInterval": 60,
  "mapLayerStyle": "GoogleMapHybrid",
  "mode": 0,
  "monitoring": 2,
  "moveModeLocatorInterval": 10,
  "mqttProtocolLevel": 4,
  "notificationEvents": true,
  "notificationGeocoderErrors": true,
  "notificationHigherPriority": false,
  "notificationLocation": true,
  "opencageApiKey": "",
  "osmTileScaleFactor": 1.0,
  "password": "SharedAccessSignature sr=MyTrackHub-Emmanuel.azure-devices.net%2Fdevices%2FSamsungS24&sig=kkFB2RAzuTuEMuswQXJFGhQ6sxRyOnCjPxrGeJUvKY8%3D&se=1795636539",
  "pegLocatorFastestIntervalToInterval": false,
  "ping": 15,
  "port": 8883,
  "pubQos": 1,
  "pubRetain": false,
  "pubTopicBase": "devices/SamsungS24/messages/events/",
  "publishLocationOnConnect": false,
  "remoteConfiguration": false,
  "reverseGeocodeProvider": "Device",
  "showRegionsOnMap": false,
  "sub": true,
  "subQos": 1,
  "subTopic": "devices/SamsungS24/messages/devicebound/#",
  "theme": "Auto",
  "tid": "1q",
  "tls": true,
  "tlsClientCrt": "",
  "username": "MyTrackHub-Emmanuel.azure-devices.net/SamsungS24/?api-version=2021-04-12",
  "ws": false
}
```

---

## Testing & Monitoring

### Monitor Incoming Events
```bash
az iot hub monitor-events --hub-name MyTrackHub-Emmanuel
```

### Sample Payload from OwnTracks
```json
{
  "_type": "location",
  "BSSID": "58:96:71:52:f4:d7",
  "SSID": "Kigali",
  "acc": 7,
  "alt": 135,
  "batt": 58,
  "bs": 1,
  "conn": "w",
  "lat": 42.1946104,
  "lon": -71.8270798,
  "tst": 1764100923,
  "vel": 0
}
```

### Payload Field Reference

| Field | Type | Description |
|-------|------|-------------|
| `_type` | string | Message type (`location`, `waypoint`, etc.) |
| `lat` | float | Latitude |
| `lon` | float | Longitude |
| `acc` | int | Accuracy in meters |
| `alt` | int | Altitude in meters |
| `batt` | int | Battery percentage |
| `bs` | int | Battery status (0=unknown, 1=unplugged, 2=charging, 3=full) |
| `conn` | string | Connection type (`w`=WiFi, `m`=mobile, `o`=offline) |
| `vel` | int | Velocity in km/h |
| `tst` | int | Unix timestamp |
| `SSID` | string | WiFi network name |
| `tid` | string | Tracker ID (2-char identifier) |

---

## Troubleshooting

### Status: Disconnected

1. **Check publish topic** — Must end with `/events/`
2. **Verify SAS token** — Not expired, matches device ID
3. **Check QoS settings** — Must be 0 or 1, not 2
4. **Disable retained messages** — Set `pubRetain` to `false`
5. **Enable debug logs** — Set `debugLog` to `true` and check View Logs

### Messages Queued But Not Sending

- Check network connectivity
- Verify port 8883 is not blocked by firewall
- Confirm device exists and is enabled in Azure IoT Hub

### Authentication Errors (401003)

- Regenerate SAS token
- Verify username format: `{hub}.azure-devices.net/{device}/?api-version=2021-04-12`
- Ensure device ID in token matches `clientId`

---

## Next Steps

- **Storage**: Route messages to Azure Blob Storage or Cosmos DB
- **Visualization**: Connect to Power BI for location dashboards
- **Automation**: Trigger Power Automate flows based on geofence events
- **Live Map**: Build a web app with Azure Maps for real-time tracking

---

## References

- [Azure IoT Hub MQTT Support](https://learn.microsoft.com/en-us/azure/iot/iot-mqtt-connect-to-iot-hub)
- [OwnTracks Booklet - MQTT](https://owntracks.org/booklet/tech/mqtt/)
- [Azure IoT Hub Error Codes](https://learn.microsoft.com/en-us/azure/iot-hub/troubleshoot-error-codes)

---

---

## Live Map Features

The live map interface includes the following features:

### Map Display
| Feature | Description |
|---------|-------------|
| 🛰️ Google Satellite | High-resolution satellite imagery (zoom level 22) |
| 🗺️ Multiple Layers | Satellite, Hybrid, Streets, Dark Mode |
| 📍 Real-time Tracking | Live location updates via Server-Sent Events |
| 🛤️ Trail Tracking | Shows movement path with configurable history |

### Smart Icons with Auto-Detection
| Speed | Mode | Icon |
|-------|------|------|
| < 1 km/h | Stationary | 📍 |
| 1-6 km/h | Walking | 🚶 |
| 6-25 km/h | Biking | 🚴 |
| > 25 km/h | Driving | 🚗 |

- **Auto Mode (🔄)**: Automatically switches icons based on speed
- **Manual Override**: Select 🚶🚴🚗🚐 to lock a specific icon
- **Directional Rotation**: Icons rotate to face the direction of movement

### Geofencing System
| Feature | Description |
|---------|-------------|
| 🎯 Create Zones | Tap map to set center, define radius |
| 🟢 Entry Alerts | Visual + audio alert when entering zone |
| 🔴 Exit Alerts | Visual + audio alert when leaving zone |
| 💾 Persistence | Geofences saved to localStorage |
| 📱 Mobile Panel | Bottom sheet UI on mobile devices |

### Mobile Responsive Design
- Profile image header with device info
- Touch-friendly controls and buttons
- Bottom sheet geofence panel
- Compact status bar on small screens
- Works on any screen size

---

## Local Live Map Server Setup

For real-time visualization without additional Azure services, use this local Node.js server.

### Prerequisites

- Node.js v18+ installed ([download](https://nodejs.org))
- IoT Hub service connection string
- Event Hub-compatible endpoint name

### Installation

```bash
# Create project folder
mkdir mytrackhub-livemap && cd mytrackhub-livemap

# Initialize and install dependencies
npm init -y
npm install @azure/event-hubs express ws
```

### Get Connection Details

```bash
# Get service connection string
az iot hub connection-string show --hub-name MyTrackHub-Emmanuel --policy-name service --output tsv

# Get Event Hub endpoint details
az iot hub show --name MyTrackHub-Emmanuel --query properties.eventHubEndpoints.events
```

### Server Code (server.js)

```javascript
const { EventHubConsumerClient } = require("@azure/event-hubs");
const express = require("express");
const WebSocket = require("ws");
const path = require("path");

// ============================================
// CONFIGURATION
// ============================================
const IOT_HUB_CONNECTION_STRING = "HostName=MyTrackHub-Emmanuel.azure-devices.net;SharedAccessKeyName=service;SharedAccessKey=YOUR_KEY";
const EVENT_HUB_NAME = "iothub-ehub-mytrackhub-69020481-3cfd6703c6";
const CONSUMER_GROUP = "$Default";
const PORT = 3000;

// ============================================
// EXPRESS SERVER FOR STATIC FILES
// ============================================
const app = express();
app.use(express.static(__dirname));

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

const server = app.listen(PORT, () => {
    console.log(`\n🗺️  Live Map running at: http://localhost:${PORT}`);
    console.log(`📡 Connecting to IoT Hub...`);
});

// ============================================
// WEBSOCKET SERVER FOR REAL-TIME UPDATES
// ============================================
const wss = new WebSocket.Server({ server });
let latestLocation = null;

wss.on("connection", (ws) => {
    console.log("🌐 Browser connected to WebSocket");
    if (latestLocation) {
        ws.send(JSON.stringify(latestLocation));
    }
    ws.on("close", () => {
        console.log("🌐 Browser disconnected");
    });
});

function broadcastLocation(location) {
    const message = JSON.stringify(location);
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// ============================================
// IOT HUB EVENT LISTENER
// ============================================
async function connectToIoTHub() {
    const eventHubConnectionString = `Endpoint=sb://ihsuprodblres069dednamespace.servicebus.windows.net/;SharedAccessKeyName=service;SharedAccessKey=YOUR_KEY;EntityPath=${EVENT_HUB_NAME}`;
    
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
        await subscription.close();
        await consumerClient.close();
        process.exit(0);
    });
}

connectToIoTHub().catch(console.error);
```

### Web Interface (index.html)

Create an `index.html` file with Leaflet.js map that connects via WebSocket. Key features:

- Real-time marker updates
- Accuracy circle visualization
- Movement trail tracking
- Battery and status display
- Auto-reconnecting WebSocket

### Running the Server

```bash
node server.js
```

Expected output:
```
🗺️  Live Map running at: http://localhost:3000
📡 Connecting to IoT Hub...
✅ Connected to IoT Hub Event Stream
⏳ Waiting for location updates from OwnTracks...
```

Open browser to `http://localhost:3000`

### Remote Access with ngrok

To access the live map from your phone while away from home:

1. **Install ngrok:**
   ```powershell
   # Download ngrok
   Invoke-WebRequest -Uri "https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-windows-amd64.zip" -OutFile ngrok.zip
   Expand-Archive ngrok.zip -DestinationPath .
   ```

2. **Sign up and authenticate:**
   - Create free account at https://dashboard.ngrok.com/signup
   - Get authtoken from https://dashboard.ngrok.com/get-started/your-authtoken
   ```powershell
   .\ngrok.exe config add-authtoken YOUR_AUTH_TOKEN
   ```

3. **Start tunnel (in separate terminal):**
   ```powershell
   .\ngrok.exe http 3000
   ```

4. **Access from phone:**
   - Use the https URL provided by ngrok (e.g., `https://xxxx-xxxx.ngrok-free.app`)
   - Works from anywhere with internet connection

**Note:** Free ngrok URLs change each restart. Keep ngrok running for continuous access.

### Customization

**Add Profile Image:**
- Save your headshot as `profile.jpg` in the project folder
- Fallback displays initials if image not found

**Geofence Setup:**
1. Tap "🎯 Geofences" button
2. Tap "+ Add Geofence"
3. Tap on map to set center point
4. Enter name and radius (meters)
5. Geofence appears as dashed circle

**Map Layers:**
- Use layer control (top-right) to switch between:
  - 🛰️ Satellite + Labels (default)
  - 🛰️ Satellite Only
  - 🗺️ Google Streets
  - 🗺️ OpenStreetMap
  - 🌙 Dark Mode

### Architecture

```
┌─────────────┐     MQTT      ┌──────────────┐    Event Hub    ┌─────────────┐
│  OwnTracks  │──────────────▶│ Azure IoT Hub│────────────────▶│ Node.js     │
│  (Phone)    │   Port 8883   │              │                 │ Server      │
└─────────────┘               └──────────────┘                 └──────┬──────┘
                                                                      │
                                                                WebSocket
                                                                      │
                                                                      ▼
                                                               ┌─────────────┐
                                                               │  Browser    │
                                                               │  Live Map   │
                                                               └─────────────┘
```

### Folder Structure

```
mytrackhub-livemap/
├── node_modules/
├── package.json
├── server.js          # Node.js server with SSE
├── index.html         # Live map interface
├── profile.jpg        # Optional profile image
└── ngrok.exe          # Optional for remote access
```

### Complete Architecture

```
┌─────────────────┐      MQTT       ┌──────────────────┐
│   OwnTracks     │────────────────▶│  Azure IoT Hub   │
│   (Phone)       │   Port 8883     │                  │
└─────────────────┘                 └────────┬─────────┘
                                             │
                                       Event Hub
                                             │
                                             ▼
┌─────────────────┐      SSE        ┌──────────────────┐
│   Browser       │◀────────────────│  Node.js Server  │
│   Live Map      │   Port 3000     │                  │
└─────────────────┘                 └──────────────────┘
        ▲
        │ ngrok tunnel (optional)
        │
┌─────────────────┐
│  Mobile Browser │
│  (Remote)       │
└─────────────────┘
```

---

## Feature Summary

| Category | Feature | Status |
|----------|---------|--------|
| **Tracking** | Real-time location | ✅ |
| **Tracking** | Movement trail | ✅ |
| **Tracking** | Accuracy circle | ✅ |
| **Icons** | Auto-detect mode | ✅ |
| **Icons** | Directional rotation | ✅ |
| **Icons** | Manual override | ✅ |
| **Map** | Google Satellite HD | ✅ |
| **Map** | Multiple layers | ✅ |
| **Map** | Zoom level 22 | ✅ |
| **Geofencing** | Create zones | ✅ |
| **Geofencing** | Entry/exit alerts | ✅ |
| **Geofencing** | Audio notifications | ✅ |
| **Geofencing** | Persistent storage | ✅ |
| **Mobile** | Responsive design | ✅ |
| **Mobile** | Bottom sheet panel | ✅ |
| **Mobile** | Touch-friendly | ✅ |
| **Remote** | ngrok tunnel | ✅ |

---

*Last Updated: November 2025*
*Configuration verified working with OwnTracks Android build 420504022*
