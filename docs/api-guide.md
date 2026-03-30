# eodi.me Local & Online API Guide

The eodi.me engine exposes a REST API accessible from **any program on the same machine** (local mode)
or from **any device on the network/internet** (server mode via Docker).

---

## Local API (same PC — no install required)

When the desktop app is running, the engine is accessible at `http://127.0.0.1:{port}`.

### Auto-discovery

The current port and tokens are written to:
```
%APPDATA%\eodi.me\api-session.json      # Windows
~/Library/Application Support/eodi.me/api-session.json   # macOS
```

```json
{
  "port": 53421,
  "session_token": "a3f2...",
  "api_key": "b7e1...",
  "base_url": "http://127.0.0.1:53421",
  "started_at_unix": 1741104000
}
```

| Token | Changes on restart | Best for |
|---|---|---|
| `session_token` | Yes | Temporary testing |
| `api_key` | No (persistent) | Stable integrations |

### Python example

```python
import json, pathlib, requests

# Auto-discover endpoint
session = json.loads(
    pathlib.Path.home() / "AppData/Roaming/eodi.me/api-session.json"
)  # adjust path for macOS: ~/Library/Application Support/eodi.me/api-session.json

base = session["base_url"]
headers = {"Authorization": f"Bearer {session['api_key']}"}

# Search neighborhoods
results = requests.get(f"{base}/search", params={"q": "seongsu"}, headers=headers).json()
for r in results[:5]:
    print(r["name"], r["city"], r["country"])

# Get details for a specific hex
detail = requests.get(f"{base}/hex/8e30e1d3267ffff", headers=headers).json()
print(detail["vibe_dimensions"])
```

### Excel / Power Query

```
= Web.Contents(
    "http://127.0.0.1:53421/search?q=gangnam",
    [Headers=[Authorization="Bearer b7e1..."]]
)
```

---

## Online / Server API (Docker — Solo Biz+)

For remote access, deploy the engine as a Docker container.

### Quick start

```bash
# 1. Copy your hex database
cp /path/to/hexagons.edbh ./data/hexagons.edbh

# 2. Set a strong API key
export ENGINE_API_KEY=$(openssl rand -hex 32)
echo "ENGINE_API_KEY=$ENGINE_API_KEY" > .env

# 3. Start
docker compose -f docker-compose.engine.yml up -d

# 4. Test
curl -H "Authorization: Bearer $ENGINE_API_KEY" http://your-server:7557/health
```

### With HTTPS (recommended for production)

```bash
# Edit config/Caddyfile — replace api.example.com with your domain
docker compose -f docker-compose.engine.yml --profile https up -d
```

### Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `ENGINE_API_KEY` | ✅ Yes | — | Bearer token for auth (32-byte hex recommended) |
| `ENGINE_PORT` | No | `7557` | Port to expose |
| `ENGINE_PLAN` | No | `pro` | Tier: `free` or `pro` |

---

## Endpoints

All endpoints require `Authorization: Bearer <token>` except `/health`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check (unauthenticated) |
| `GET` | `/search?q=<query>` | Search neighborhoods by name |
| `GET` | `/hex/{h3}` | Get vibe details for a hex cell |
| `GET` | `/hex/match?h3={h3}&limit={n}` | Find similar neighborhoods |
| `GET` | `/hex/discover?{weights}` | Discover by custom weights |
| `GET` | `/hex/nearest?lat={lat}&lng={lng}` | Nearest hex to a coordinate |
| `GET` | `/hex/viewport?{bbox}` | All hexes in a map viewport |
| `GET` | `/stats` | Database statistics |
| `GET` | `/countries` | List all countries |
| `GET` | `/cities?country={iso}` | List cities in a country |
| `GET` | `/user/hexagons` | List user POI overlays |
| `PUT` | `/user/hex/{h3}` | Set a POI overlay |
| `DELETE` | `/user/hex/{h3}` | Delete a POI overlay |
| `POST` | `/user/hexagons/bulk` | Bulk set POI overlays |

### Response example: `/hex/{h3}`

```json
{
  "h3": "8e30e1d3267ffff",
  "name": "Seongsu-dong",
  "city": "Seoul",
  "country": "KR",
  "vibe_dimensions": {
    "density": 0.72,
    "green": 0.41,
    "nightlife": 0.65,
    "transit": 0.88,
    "safety": 0.79,
    "amenity": 0.83
  },
  "composite_score": 0.78
}
```

---

## Security notes

- **Local mode**: Only the same machine can access `127.0.0.1`. No additional firewall needed.
- **Server mode**: Bind to `0.0.0.0` and use a strong API key (32+ hex chars). Put Caddy/Nginx in front for HTTPS.
- Never expose the engine without a valid `--api-key`. The server refuses to start without one in server mode.
- Rate limit: 300 requests/second (configurable via `MAX_REQ_PER_SECOND` constant in source).
