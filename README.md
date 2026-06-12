# Departarr

Self-hosted flight tracking PWA. One container, zero config, works on your phone as a native-feeling app.

## Quick Start

```yaml
# docker-compose.yml
services:
  departarr:
    image: ghcr.io/basedqani/departarr:latest
    ports: ["8080:8080"]
    volumes: ["./data:/data"]
    restart: unless-stopped
```

```bash
docker compose up -d
```

Open **http://localhost:8080**, create your account, and start adding flights. Secrets (JWT, VAPID keys) are auto-generated on first boot and stored in `./data/config.json` — no `.env` file needed.

## FlightAware API Key

Without a key, the app uses stub data so you can explore the UI. To get real flight data:

1. Sign up at [flightaware.com/commercial/aeroapi](https://www.flightaware.com/commercial/aeroapi)
2. Log in to Departarr → **Settings → Data Sources** → paste your key → Save

## Optional: Google Calendar

Departarr can scan your Google Calendar for flight confirmation events and import them automatically.

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → APIs & Services → Credentials
2. Create an OAuth 2.0 Client ID (Web application)
3. Add `https://YOUR_DOMAIN/api/auth/google/callback` as an authorised redirect URI
4. Log in to Departarr → **Settings → Data Sources** → enter Client ID and Client Secret → Save
5. **Settings → Calendar → Connect**

## iOS Install

Open in Safari → Share → **Add to Home Screen**.

Push notifications (gate changes, delays, baggage claim) work on iOS 16.4+ when installed as a PWA. HTTPS is required — if you're self-hosting, [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) is the easiest way to get a public HTTPS URL for free.

## Local Development

```bash
git clone https://github.com/basedqani/departarr
cd departarr
npm install
npm run dev          # starts API on :8080 and Vite dev server on :5173
```

The Vite dev server proxies `/api` and `/ws` to the API. A `./data/` directory is created on first run with the SQLite database and auto-generated secrets.

## Architecture

```
Single container (node:22-alpine)
├── Fastify API           packages/api/src/
│   ├── Auth              JWT, bcrypt
│   ├── Flights           FlightAware AeroAPI (stub if no key)
│   ├── Poller            60s background loop for active flights
│   ├── Push              Web Push (VAPID, auto-generated keys)
│   ├── Calendar          Google Calendar OAuth + sync
│   └── Settings          DB-backed key/value store, editable in UI
├── React PWA             apps/web/src/
│   ├── MapLibre globe    live aircraft position
│   └── Service Worker    offline support, push receive
└── SQLite                /data/departarr.db (mounted volume)
```

All runtime settings (API keys, VAPID subject) are stored in the `Setting` table and editable from the Settings page — no container restart required.

## Building from Source

Uncomment `build: .` in docker-compose.yml, or:

```bash
docker build -t departarr .
```

The multi-stage Dockerfile builds the web app (Vite) and API (tsc + prisma generate) in the first stage, then assembles a lean runtime image.
