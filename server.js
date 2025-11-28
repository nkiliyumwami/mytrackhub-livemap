// =============================================================================
// MyTrackHub - Multi-User Real-Time GPS Tracking Server
// Version: 3.0 - Multi-User Authentication
// =============================================================================

const express = require('express');
const { EventHubConsumerClient } = require('@azure/event-hubs');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = {
    PORT: 3000,

    // Azure IoT Hub
    IOT_CONNECTION: "Endpoint=sb://ihsuprodblres069dednamespace.servicebus.windows.net/;SharedAccessKeyName=iothubowner;SharedAccessKey=itc+vGUiyCjcuEQpW0RnBZEZA7dkLZ+GzAIoTD9xJsQ=;EntityPath=iothub-ehub-mytrackhub-69020481-3cfd6703c6",
    IOT_CONSUMER_GROUP: "$Default",

    // Mapbox (for road snapping)
    MAPBOX_TOKEN: "pk.eyJ1IjoiZW1tYW51ZWxuayIsImEiOiJjbTQ1MG9hMWkwNWdyMmpxdWpraTFnNXo0In0.dSNeXpanOi9MG4BxB5MKcA",

    // Telegram (Admin alerts only)
    TELEGRAM_BOT_TOKEN: "8350895730:AAGfUCIS2iXV_rvRIdOkpEpvyVIk_7XFmNo",
    TELEGRAM_CHAT_ID: "7931850982",

    // JWT Secret (for session tokens)
    JWT_SECRET: crypto.randomBytes(64).toString('hex'),

    // Admin credentials
    ADMIN_EMAIL: "emmanuel@smartviewafrica.com",
    ADMIN_PASSWORD: "MyTrack2025!"
};

// =============================================================================
// DATA STORAGE (JSON Files)
// =============================================================================

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const dataFiles = {
    users: path.join(DATA_DIR, 'users.json'),
    invites: path.join(DATA_DIR, 'invites.json'),
    devices: path.join(DATA_DIR, 'devices.json'),
    geofences: path.join(DATA_DIR, 'geofences.json'),
    history: path.join(DATA_DIR, 'snapped_history.json')
};

// Initialize data files if they don't exist
function initDataFiles() {
    // Admin user
    const defaultUsers = {
        users: [{
            id: 'admin-001',
            email: CONFIG.ADMIN_EMAIL,
            passwordHash: hashPassword(CONFIG.ADMIN_PASSWORD),
            role: 'admin',
            name: 'Emmanuel',
            createdAt: new Date().toISOString()
        }]
    };

    if (!fs.existsSync(dataFiles.users)) {
        fs.writeFileSync(dataFiles.users, JSON.stringify(defaultUsers, null, 2));
    }
    if (!fs.existsSync(dataFiles.invites)) {
        fs.writeFileSync(dataFiles.invites, JSON.stringify({ invites: [] }, null, 2));
    }
    if (!fs.existsSync(dataFiles.devices)) {
        fs.writeFileSync(dataFiles.devices, JSON.stringify({ devices: [] }, null, 2));
    }
    if (!fs.existsSync(dataFiles.geofences)) {
        fs.writeFileSync(dataFiles.geofences, JSON.stringify({ geofences: [] }, null, 2));
    }
    if (!fs.existsSync(dataFiles.history)) {
        fs.writeFileSync(dataFiles.history, JSON.stringify({ history: [] }, null, 2));
    }
}

function loadData(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        return null;
    }
}

function saveData(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// =============================================================================
// PASSWORD & TOKEN UTILITIES
// =============================================================================

function hashPassword(password) {
    return crypto.createHash('sha256').update(password + 'mytrackhub-salt').digest('hex');
}

function generateToken(user) {
    const payload = {
        userId: user.id,
        email: user.email,
        role: user.role,
        exp: Date.now() + (24 * 60 * 60 * 1000) // 24 hours
    };
    const data = JSON.stringify(payload);
    const signature = crypto.createHmac('sha256', CONFIG.JWT_SECRET).update(data).digest('hex');
    return Buffer.from(data).toString('base64') + '.' + signature;
}

function verifyToken(token) {
    try {
        const [dataB64, signature] = token.split('.');
        const data = Buffer.from(dataB64, 'base64').toString();
        const expectedSig = crypto.createHmac('sha256', CONFIG.JWT_SECRET).update(data).digest('hex');
        if (signature !== expectedSig) return null;

        const payload = JSON.parse(data);
        if (payload.exp < Date.now()) return null;
        return payload;
    } catch (e) {
        return null;
    }
}

function generateInviteCode() {
    return crypto.randomBytes(16).toString('hex');
}

// =============================================================================
// AUTHENTICATION MIDDLEWARE
// =============================================================================

function authMiddleware(requiredRole = null) {
    return (req, res, next) => {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token provided' });
        }

        const token = authHeader.substring(7);
        const payload = verifyToken(token);

        if (!payload) {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }

        if (requiredRole && payload.role !== requiredRole && payload.role !== 'admin') {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }

        req.user = payload;
        next();
    };
}

// =============================================================================
// AUTH API ROUTES
// =============================================================================

// Login
app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    const data = loadData(dataFiles.users);

    const user = data.users.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (!user || user.passwordHash !== hashPassword(password)) {
        return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = generateToken(user);
    res.json({
        token,
        user: {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role
        }
    });
});

// Get current user
app.get('/api/auth/me', authMiddleware(), (req, res) => {
    const data = loadData(dataFiles.users);
    const user = data.users.find(u => u.id === req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
    });
});

// Validate invite code
app.get('/api/auth/invite/:code', (req, res) => {
    const data = loadData(dataFiles.invites);
    const invite = data.invites.find(i => i.code === req.params.code && !i.used);

    if (!invite) {
        return res.status(404).json({ error: 'Invalid or expired invite' });
    }

    res.json({
        name: invite.name,
        email: invite.email,
        maxDevices: invite.maxDevices
    });
});

// Signup (from invite link)
app.post('/api/auth/signup', (req, res) => {
    const { code, password, phone } = req.body;

    const inviteData = loadData(dataFiles.invites);
    const invite = inviteData.invites.find(i => i.code === code && !i.used);

    if (!invite) {
        return res.status(400).json({ error: 'Invalid or expired invite' });
    }

    const userData = loadData(dataFiles.users);

    // Check if email already exists
    if (userData.users.find(u => u.email.toLowerCase() === invite.email.toLowerCase())) {
        return res.status(400).json({ error: 'Account already exists for this email' });
    }

    // Create new user
    const newUser = {
        id: 'parent-' + Date.now(),
        email: invite.email,
        passwordHash: hashPassword(password),
        role: 'parent',
        name: invite.name,
        phone: phone || null,
        maxDevices: invite.maxDevices,
        createdAt: new Date().toISOString()
    };

    userData.users.push(newUser);
    saveData(dataFiles.users, userData);

    // Mark invite as used
    invite.used = true;
    invite.usedAt = new Date().toISOString();
    saveData(dataFiles.invites, inviteData);

    const token = generateToken(newUser);
    res.json({
        token,
        user: {
            id: newUser.id,
            email: newUser.email,
            name: newUser.name,
            role: newUser.role
        }
    });
});

// =============================================================================
// ADMIN API ROUTES
// =============================================================================

// Get all users (admin only)
app.get('/api/admin/users', authMiddleware('admin'), (req, res) => {
    const data = loadData(dataFiles.users);
    const users = data.users.map(u => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        maxDevices: u.maxDevices,
        createdAt: u.createdAt
    }));
    res.json(users);
});

// Delete user (admin only)
app.delete('/api/admin/users/:id', authMiddleware('admin'), (req, res) => {
    const data = loadData(dataFiles.users);
    const idx = data.users.findIndex(u => u.id === req.params.id);

    if (idx === -1) return res.status(404).json({ error: 'User not found' });
    if (data.users[idx].role === 'admin') {
        return res.status(400).json({ error: 'Cannot delete admin user' });
    }

    data.users.splice(idx, 1);
    saveData(dataFiles.users, data);

    // Also remove their devices
    const deviceData = loadData(dataFiles.devices);
    deviceData.devices = deviceData.devices.filter(d => d.ownerId !== req.params.id);
    saveData(dataFiles.devices, deviceData);

    res.json({ success: true });
});

// Create invite (admin only)
app.post('/api/admin/invites', authMiddleware('admin'), (req, res) => {
    const { name, email, maxDevices } = req.body;

    if (!name || !email) {
        return res.status(400).json({ error: 'Name and email required' });
    }

    const data = loadData(dataFiles.invites);

    // Check if invite already exists for this email
    const existing = data.invites.find(i => i.email.toLowerCase() === email.toLowerCase() && !i.used);
    if (existing) {
        return res.status(400).json({ error: 'Active invite already exists for this email' });
    }

    const invite = {
        id: 'invite-' + Date.now(),
        code: generateInviteCode(),
        name,
        email,
        maxDevices: maxDevices || 3,
        createdAt: new Date().toISOString(),
        used: false
    };

    data.invites.push(invite);
    saveData(dataFiles.invites, data);

    res.json({
        ...invite,
        link: `https://track.smartviewafrica.com/signup.html?code=${invite.code}`
    });
});

// Get all invites (admin only)
app.get('/api/admin/invites', authMiddleware('admin'), (req, res) => {
    const data = loadData(dataFiles.invites);
    const invites = data.invites.map(i => ({
        ...i,
        link: i.used ? null : `https://track.smartviewafrica.com/signup.html?code=${i.code}`
    }));
    res.json(invites);
});

// Delete invite (admin only)
app.delete('/api/admin/invites/:id', authMiddleware('admin'), (req, res) => {
    const data = loadData(dataFiles.invites);
    const idx = data.invites.findIndex(i => i.id === req.params.id);

    if (idx === -1) return res.status(404).json({ error: 'Invite not found' });

    data.invites.splice(idx, 1);
    saveData(dataFiles.invites, data);
    res.json({ success: true });
});

// =============================================================================
// DEVICE API ROUTES
// =============================================================================

// Get devices (filtered by user role)
app.get('/api/devices', authMiddleware(), (req, res) => {
    const data = loadData(dataFiles.devices);

    let devices;
    if (req.user.role === 'admin') {
        devices = data.devices;
    } else {
        devices = data.devices.filter(d => d.ownerId === req.user.userId);
    }

    res.json(devices);
});

// Add device
app.post('/api/devices', authMiddleware(), (req, res) => {
    const { name, deviceId, color } = req.body;

    if (!name || !deviceId) {
        return res.status(400).json({ error: 'Name and deviceId required' });
    }

    const data = loadData(dataFiles.devices);

    // Check device limit for parents
    if (req.user.role === 'parent') {
        const userData = loadData(dataFiles.users);
        const user = userData.users.find(u => u.id === req.user.userId);
        const userDevices = data.devices.filter(d => d.ownerId === req.user.userId);

        if (userDevices.length >= (user.maxDevices || 3)) {
            return res.status(400).json({ error: `Device limit reached (max ${user.maxDevices || 3})` });
        }
    }

    // Check if deviceId already exists
    if (data.devices.find(d => d.deviceId === deviceId)) {
        return res.status(400).json({ error: 'Device ID already in use' });
    }

    const device = {
        id: 'device-' + Date.now(),
        deviceId,
        name,
        color: color || '#0078d4',
        ownerId: req.user.userId,
        ownerName: req.user.role === 'admin' ? 'Admin' : req.user.email,
        createdAt: new Date().toISOString(),
        lastSeen: null,
        lastLocation: null
    };

    data.devices.push(device);
    saveData(dataFiles.devices, data);

    res.json(device);
});

// Delete device
app.delete('/api/devices/:id', authMiddleware(), (req, res) => {
    const data = loadData(dataFiles.devices);
    const device = data.devices.find(d => d.id === req.params.id);

    if (!device) return res.status(404).json({ error: 'Device not found' });

    // Only owner or admin can delete
    if (req.user.role !== 'admin' && device.ownerId !== req.user.userId) {
        return res.status(403).json({ error: 'Not authorized' });
    }

    data.devices = data.devices.filter(d => d.id !== req.params.id);
    saveData(dataFiles.devices, data);
    res.json({ success: true });
});

// =============================================================================
// GEOFENCE API ROUTES
// =============================================================================

// Get geofences (filtered by user)
app.get('/api/geofences', authMiddleware(), (req, res) => {
    const data = loadData(dataFiles.geofences);

    let geofences;
    if (req.user.role === 'admin') {
        geofences = data.geofences;
    } else {
        geofences = data.geofences.filter(g => g.ownerId === req.user.userId);
    }

    res.json(geofences);
});

// Create geofence
app.post('/api/geofences', authMiddleware(), (req, res) => {
    const { name, lat, lng, radius, deviceIds } = req.body;

    if (!name || !lat || !lng || !radius) {
        return res.status(400).json({ error: 'Name, lat, lng, and radius required' });
    }

    const data = loadData(dataFiles.geofences);

    const geofence = {
        id: Date.now(),
        name,
        lat,
        lng,
        radius,
        deviceIds: deviceIds || [],
        ownerId: req.user.userId,
        createdAt: new Date().toISOString()
    };

    data.geofences.push(geofence);
    saveData(dataFiles.geofences, data);

    res.json(geofence);
});

// Delete geofence
app.delete('/api/geofences/:id', authMiddleware(), (req, res) => {
    const data = loadData(dataFiles.geofences);
    const geofence = data.geofences.find(g => g.id === parseInt(req.params.id));

    if (!geofence) return res.status(404).json({ error: 'Geofence not found' });

    if (req.user.role !== 'admin' && geofence.ownerId !== req.user.userId) {
        return res.status(403).json({ error: 'Not authorized' });
    }

    data.geofences = data.geofences.filter(g => g.id !== parseInt(req.params.id));
    saveData(dataFiles.geofences, data);
    res.json({ success: true });
});

// =============================================================================
// REAL-TIME LOCATION STREAMING (SSE)
// =============================================================================

let sseClients = [];
let latestLocations = {};

app.get('/api/stream', authMiddleware(), (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });

    const client = {
        id: Date.now(),
        res,
        userId: req.user.userId,
        role: req.user.role
    };

    sseClients.push(client);

    // Send current locations
    const deviceData = loadData(dataFiles.devices);
    let devices = req.user.role === 'admin'
        ? deviceData.devices
        : deviceData.devices.filter(d => d.ownerId === req.user.userId);

    const deviceIds = devices.map(d => d.deviceId);

    for (const [deviceId, location] of Object.entries(latestLocations)) {
        if (deviceIds.includes(deviceId)) {
            res.write(`data: ${JSON.stringify(location)}\n\n`);
        }
    }

    req.on('close', () => {
        sseClients = sseClients.filter(c => c.id !== client.id);
    });
});

function broadcastLocation(location) {
    const deviceData = loadData(dataFiles.devices);

    sseClients.forEach(client => {
        let authorized = false;

        if (client.role === 'admin') {
            authorized = true;
        } else {
            const device = deviceData.devices.find(d => d.deviceId === location.deviceId);
            if (device && device.ownerId === client.userId) {
                authorized = true;
            }
        }

        if (authorized) {
            client.res.write(`data: ${JSON.stringify(location)}\n\n`);
        }
    });
}

// =============================================================================
// HISTORY API
// =============================================================================

app.get('/api/history', authMiddleware(), (req, res) => {
    const { deviceId, date } = req.query;
    const data = loadData(dataFiles.history);

    let history = data.history || [];

    // Filter by device
    if (deviceId) {
        history = history.filter(h => h.deviceId === deviceId);
    }

    // Filter by date
    if (date) {
        history = history.filter(h => h.timestamp.startsWith(date));
    }

    // Filter by ownership
    if (req.user.role !== 'admin') {
        const deviceData = loadData(dataFiles.devices);
        const userDeviceIds = deviceData.devices
            .filter(d => d.ownerId === req.user.userId)
            .map(d => d.deviceId);
        history = history.filter(h => userDeviceIds.includes(h.deviceId));
    }

    res.json(history);
});

// =============================================================================
// AZURE IOT HUB CONNECTION
// =============================================================================

async function connectToIoTHub() {
    console.log('Connecting to Azure IoT Hub...');

    try {
        const client = new EventHubConsumerClient(
            CONFIG.IOT_CONSUMER_GROUP,
            CONFIG.IOT_CONNECTION
        );

        await client.subscribe({
            processEvents: async (events) => {
                for (const event of events) {
                    try {
                        const data = event.body;
                        // Get device ID from IoT Hub system properties
                        const deviceId = event.systemProperties["iothub-connection-device-id"] || data.tid || 'Unknown';
                        if (data._type === 'location') {
                            await processLocation(data, deviceId);
                        }
                    } catch (e) {
                        console.error('Event processing error:', e);
                    }
                }
            },
            processError: async (err) => {
                console.error('Event Hub error:', err);
            }
        });

        console.log('Connected to IoT Hub Event Stream');
    } catch (err) {
        console.error('Failed to connect to IoT Hub:', err);
        setTimeout(connectToIoTHub, 5000);
    }
}

async function processLocation(data, deviceId) {
    const location = {
        deviceId: deviceId || data.tid || 'Unknown',
        lat: data.lat,
        lng: data.lon,
        accuracy: data.acc,
        altitude: data.alt,
        battery: data.batt,
        speed: data.vel || 0,
        timestamp: new Date(data.tst * 1000).toISOString()
    };

    // Detect transport mode
    const speed = location.speed * 3.6; // m/s to km/h
    if (speed < 2) location.mode = 'stationary';
    else if (speed < 7) location.mode = 'walking';
    else if (speed < 25) location.mode = 'biking';
    else location.mode = 'driving';

    // Update device last seen
    const deviceData = loadData(dataFiles.devices);
    const device = deviceData.devices.find(d => d.deviceId === location.deviceId);
    if (device) {
        device.lastSeen = location.timestamp;
        device.lastLocation = { lat: location.lat, lng: location.lng };
        device.battery = location.battery;
        saveData(dataFiles.devices, deviceData);
    }

    // Store in history
    const historyData = loadData(dataFiles.history);
    historyData.history = historyData.history || [];
    historyData.history.push(location);

    // Keep only last 10000 points
    if (historyData.history.length > 10000) {
        historyData.history = historyData.history.slice(-10000);
    }
    saveData(dataFiles.history, historyData);

    // Check geofences
    await checkGeofences(location);

    // Store and broadcast
    latestLocations[location.deviceId] = location;
    broadcastLocation(location);

    console.log(`Location: ${location.deviceId} @ ${location.lat}, ${location.lng}`);
}

// =============================================================================
// GEOFENCE CHECKING
// =============================================================================

let deviceGeofenceState = {};

async function checkGeofences(location) {
    const geofenceData = loadData(dataFiles.geofences);
    const deviceData = loadData(dataFiles.devices);

    const device = deviceData.devices.find(d => d.deviceId === location.deviceId);
    if (!device) return;

    const geofences = geofenceData.geofences.filter(g =>
        g.ownerId === device.ownerId ||
        g.deviceIds?.includes(location.deviceId)
    );

    for (const geofence of geofences) {
        const distance = calculateDistance(
            location.lat, location.lng,
            geofence.lat, geofence.lng
        );

        const isInside = distance <= geofence.radius;
        const key = `${location.deviceId}-${geofence.id}`;
        const wasInside = deviceGeofenceState[key];

        if (wasInside === undefined) {
            deviceGeofenceState[key] = isInside;
            continue;
        }

        if (!wasInside && isInside) {
            // Entered geofence
            await sendAlert(device, geofence, 'entered');
        } else if (wasInside && !isInside) {
            // Left geofence
            await sendAlert(device, geofence, 'left');
        }

        deviceGeofenceState[key] = isInside;
    }
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

async function sendAlert(device, geofence, action) {
    const emoji = action === 'entered' ? '📍' : '🚪';
    const message = `${emoji} *${device.name}* ${action} *${geofence.name}*`;

    // Send Telegram to admin
    try {
        await fetch(`https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: CONFIG.TELEGRAM_CHAT_ID,
                text: message,
                parse_mode: 'Markdown'
            })
        });
        console.log(`Alert sent: ${message}`);
    } catch (e) {
        console.error('Telegram error:', e);
    }

    // TODO: Send email to parent (Stage 3)
}

// =============================================================================
// HTML PAGE ROUTES
// =============================================================================

app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/signup', (req, res) => res.sendFile(path.join(__dirname, 'signup.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// =============================================================================
// START SERVER
// =============================================================================

initDataFiles();

app.listen(CONFIG.PORT, () => {
    console.log(`MyTrackHub running on port ${CONFIG.PORT}`);
    connectToIoTHub();
});