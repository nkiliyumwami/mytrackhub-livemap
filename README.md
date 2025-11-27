# MyTrackHub v3.0

Real-Time Multi-User GPS Location Tracking System

## Features

- Multi-user authentication (Admin & Parent roles)
- Invite-based parent signup
- Role-based device visibility
- Real-time location tracking via Azure IoT Hub
- Transport mode detection (walking/biking/driving)
- Geofencing with Telegram alerts
- Location history with playback

## Quick Start

### 1. Clone and Install

```bash
cd /var/www/mytrackhub
git pull origin main
npm install
```

### 2. Configure

Edit `server.js` and update the CONFIG section:

```javascript
const CONFIG = {
    ADMIN_EMAIL: "your-email@example.com",
    ADMIN_PASSWORD: "YourSecurePassword",
    IOT_CONNECTION: "your-azure-iot-connection-string",
    MAPBOX_TOKEN: "your-mapbox-token",
    TELEGRAM_BOT_TOKEN: "your-telegram-bot-token",
    TELEGRAM_CHAT_ID: "your-telegram-chat-id"
};
```

### 3. Create Data Directory

```bash
mkdir -p data
```

### 4. Restart Server

```bash
pm2 restart mytrackhub
```

## User Roles

| Role | Access |
|------|--------|
| Admin | See all devices, manage users, create invites |
| Parent | See only their devices, add devices up to limit |

## URLs

- Login: `/login.html`
- Admin Dashboard: `/admin.html`
- Map View: `/` or `/index.html`
- Parent Signup: `/signup.html?code=INVITE_CODE`

## License

MIT