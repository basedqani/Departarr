# Self-Hosting Departarr

Departarr is a single Docker container with a SQLite database. All secrets are auto-generated on first boot — there is nothing to configure before you start.

---

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) (includes Docker Compose on macOS/Windows; install the Compose plugin separately on Linux)

That's it. No database server, no Redis, no external dependencies.

---

## Quick Start

### Option A — one command (no git clone required)

```bash
docker run -d \
  --name departarr \
  --restart unless-stopped \
  -p 8080:8080 \
  -v "$(pwd)/data:/data" \
  ghcr.io/basedqani/departarr:latest
```

Open **http://localhost:8080**, create your account, and start adding flights.

### Option B — docker-compose (recommended for long-term use)

```bash
curl -O https://raw.githubusercontent.com/basedqani/departarr/main/docker-compose.yml
docker compose up -d
```

Or clone the repo and use the setup script:

```bash
git clone https://github.com/basedqani/departarr
cd departarr
bash scripts/setup.sh
```

The setup script checks Docker is installed, starts the container, waits for it to be healthy, and prints the URL.

---

## What happens on first boot

1. The container creates `./data/departarr.db` (SQLite) and `./data/config.json`.
2. A JWT signing secret and VAPID key pair are generated and written to `config.json`.
3. Prisma runs any pending migrations.
4. The API starts on port 8080, serving both the API and the built React PWA.

Nothing is lost if you restart the container — `./data/` persists everything.

---

## Environment Variables

All optional. Settings marked **"also in UI"** can be entered or changed in **Settings → Data Sources** inside the app without restarting the container.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8080` | Port the API listens on |
| `DATABASE_URL` | `file:/data/departarr.db` | Prisma SQLite connection string |
| `JWT_SECRET` | auto-generated | Secret for signing JWTs. Persisted in `config.json` |
| `VAPID_PUBLIC_KEY` | auto-generated | Web Push public key. Persisted in `config.json` |
| `VAPID_PRIVATE_KEY` | auto-generated | Web Push private key. Persisted in `config.json` |
| `VAPID_SUBJECT` | — | `mailto:` or `https:` URI identifying the push sender. Also in UI |
| `APP_URL` | detected from request | Public base URL (e.g. `https://flights.example.com`). Used in share links and Google OAuth redirects |
| `ADMIN_EMAIL` | — | If set, an admin account is created with this email on first boot |
| `GOOGLE_REDIRECT_URI` | auto-detected | Override the Google OAuth redirect URI (normally not needed) |

### Setting API keys without a restart

AeroDataBox key, Google OAuth credentials, and the VAPID subject can all be entered in the app's **Settings → Data Sources** page. They are stored in the SQLite database and take effect immediately.

---

## Getting a Free AeroDataBox API Key

Without an API key the app shows stub data so you can explore the UI. For real flight tracking:

1. Sign up at [aerodatabox.com](https://aerodatabox.com) (free tier: 150 requests/day)
2. Copy your API key from the dashboard
3. In Departarr → **Settings → Data Sources** → paste the key → **Save**

---

## Google Calendar Integration (Optional)

Departarr can scan your Google Calendar for flight confirmation events and import them automatically.

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → **APIs & Services → Credentials**
2. Enable the **Google Calendar API**
3. Create an **OAuth 2.0 Client ID** (Web application)
4. Add your redirect URI: `https://YOUR_DOMAIN/api/auth/google/callback`
5. In Departarr → **Settings → Data Sources** → enter **Client ID** and **Client Secret** → **Save**
6. In Departarr → **Settings → Calendar** → **Connect Google Calendar**

> Google OAuth requires an HTTPS redirect URI. See the section below for how to get a public HTTPS URL.

---

## Exposing Departarr Publicly (HTTPS)

Push notifications and Google Calendar OAuth both require HTTPS. A few easy options:

### Cloudflare Tunnel (free, no port-forwarding required)

```bash
# Install cloudflared, then:
cloudflared tunnel --url http://localhost:8080
```

Cloudflare gives you a random `*.trycloudflare.com` URL for free. For a permanent domain, [create a named tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/).

### Tailscale Funnel

If you use [Tailscale](https://tailscale.com):

```bash
tailscale funnel 8080
```

This exposes `https://YOUR_MACHINE.YOUR_TAILNET.ts.net` on the public internet.

### Nginx / Caddy reverse proxy

Example **Caddyfile** (Caddy handles HTTPS automatically):

```
flights.example.com {
    reverse_proxy localhost:8080
}
```

Example **nginx** snippet:

```nginx
server {
    listen 443 ssl;
    server_name flights.example.com;
    # ... ssl cert config ...

    location / {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Set `APP_URL=https://flights.example.com` in your `docker-compose.yml` environment after you have a domain.

---

## Updating

### Manual

```bash
docker compose pull
docker compose up -d
```

### Automatic with Watchtower

Add Watchtower to your `docker-compose.yml` to auto-pull new images:

```yaml
services:
  departarr:
    image: ghcr.io/basedqani/departarr:latest
    ports: ["8080:8080"]
    volumes: ["./data:/data"]
    restart: unless-stopped

  watchtower:
    image: containrrr/watchtower
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    command: --interval 86400   # check daily
    restart: unless-stopped
```

---

## Backups

The entire state of Departarr lives in `./data/`:

| File | Contents |
|---|---|
| `departarr.db` | All flights, users, settings |
| `config.json` | Auto-generated JWT secret and VAPID keys |

Back up the whole `./data/` directory. To restore, stop the container, replace `./data/`, and start again.

---

## Building from Source

```bash
git clone https://github.com/basedqani/departarr
cd departarr
docker build -t departarr .
# Then edit docker-compose.yml: replace `image:` with `build: .`
docker compose up -d
```

Or for local development without Docker:

```bash
npm install
npm run dev   # API on :8080, Vite dev server on :5173
```

---

## Troubleshooting

**Container exits immediately**
Check logs: `docker compose logs departarr`. Usually a volume permissions issue — ensure the `./data` directory is writable by the container user.

**Push notifications not working**
HTTPS is required. Make sure you're accessing the app over `https://` and have installed it as a PWA (iOS: Safari → Share → Add to Home Screen).

**"stub data" shown instead of real flights**
No AeroDataBox API key is set. Add it in Settings → Data Sources.

**Google OAuth redirect mismatch**
The redirect URI in Google Cloud Console must exactly match `APP_URL + /api/auth/google/callback`. Set `APP_URL=https://your-domain` in your environment.
