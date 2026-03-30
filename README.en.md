# 🌍 EODI.ME — Neighborhood Vibe Intelligence

[![License: Proprietary](https://img.shields.io/badge/license-Proprietary-red.svg)](LICENSE)
[![Rust](https://img.shields.io/badge/rust-1.75+-orange.svg)](https://www.rust-lang.org/)
[![Go](https://img.shields.io/badge/go-1.24+-blue.svg)](https://go.dev/)
[![Tauri](https://img.shields.io/badge/tauri-1.5-purple.svg)](https://tauri.app/)

> Offline neighborhood vibe intelligence desktop app — 13-dimensional urban analysis, privacy-first, self-hosted

[한국어 README](README.md) | [OpenAPI Docs](docs/openapi.yaml) | [Landing Page](landing/index.html)

---

## ✨ Features

- 🎯 **13D Vibe Analysis** — 6 vibe axes (active, classic, quiet, trendy, nature, urban) + 7 internal meta dimensions
- 🗺️ **H3 Hexagon Map** — Resolution-8 (~460m) hexagonal grid exploration
- 🔍 **Vector Search** — Cosine similarity-based neighborhood matching
- 📦 **Fully Offline** — All analysis runs as a local binary — no cloud, no telemetry
- 🔐 **License Tiers** — Free / Personal / Solo Biz / Business / Enterprise
- 🌐 **Local API** — Bearer token REST API for integration with external tools
- 🐳 **Docker Self-Hosting** — Enterprise server deployment support

---

## 🏗️ Architecture

```
tauri-shell/          # Desktop app (TypeScript + Rust)
├── src/              #   React frontend (MapLibre GL, Vite)
└── src-tauri/        #   Tauri shell (engine management, license validation)

engine-server/        # Search & recommendation engine (Rust, Axum)
                      #   AES-256-GCM encrypted VDB, HMAC plan enforcement

go-api/               # REST API server (Go, Gin)
                      #   JWT auth, rate limiting, engine proxy

rust-collector/       # Data collection pipeline (Rust)
                      #   OSM POI, Open-Meteo, 13D vector generation, encrypted DB
```

---

## 🚀 Quick Start

### Desktop App (Development)

```bash
# Install dependencies
cd tauri-shell && npm install

# Build engine first
cd engine-server && cargo build --release --bin eodi-engine

# Run app
cd tauri-shell && npm run tauri dev
```

### Docker Self-Hosting (Solo Biz+)

```bash
cp .env.example .env
# Set ENGINE_API_KEY in .env: openssl rand -hex 32

docker compose -f docker-compose.engine.yml up -d

# Enable HTTPS (set your domain in config/Caddyfile first)
docker compose -f docker-compose.engine.yml --profile https up -d
```

### Data Collection Pipeline

```powershell
$env:VECTOR_DB_PASSWORD = "your-password"
.\eodi-collector.exe build-full -f data/cities15000.txt -l 1000 -o data/hexagons.edbh
```

---

## 📂 Project Structure

```
eodi.me/
├── tauri-shell/          # Desktop app (Tauri + React)
├── engine-server/        # Vector search engine (Rust)
├── go-api/               # REST API server (Go)
├── rust-collector/       # Data collection pipeline (Rust)
├── supabase/             # Subscription management (Edge Functions, Schema)
├── config/               # Caddy, Prometheus, Grafana configs
├── monitoring/           # Alertmanager config
├── docs/                 # OpenAPI spec, deployment guides
├── landing/              # Static landing page
└── scripts/              # PowerShell automation scripts
```

---

## 🛠️ Tech Stack

| Area | Tech |
|------|------|
| Desktop App | Tauri 1.5, React 18, TypeScript, MapLibre GL |
| Search Engine | Rust (Axum), AES-256-GCM, HMAC-SHA256 |
| API Server | Go 1.24 (Gin), JWT v5, Zap logging |
| Data Collection | Rust, OSM Overpass, Open-Meteo |
| Subscriptions | Supabase (Edge Functions), LemonSqueezy |
| Monitoring | Prometheus, Grafana, Alertmanager |
| Deployment | Docker, Caddy (HTTPS) |

---

## 📦 Build Commands

```bash
# Engine
cd engine-server && cargo build --release

# Go API
cd go-api && go build ./cmd/server

# Frontend
cd tauri-shell && npm run build

# Desktop app (production build)
cd tauri-shell && npm run tauri build
```

---

## 🔐 Security

- **Engine**: HMAC-SHA256 plan token anti-spoofing, localhost-only binding, constant-time comparison
- **VDB**: Argon2id key derivation + AES-256-GCM encryption (runtime decrypt, immediate memory zeroization)
- **API**: JWT enforcement, weak secret rejection at startup, H3 index input validation
- **CSP**: Tauri Content Security Policy — only allowlisted origins
- **License**: HMAC signature + activation stamp, XOR-split key obfuscation

---

## 📚
---

## 📚 Documentation

- [OpenAPI Spec](docs/openapi.yaml)
- [BYOD Data Guide](docs/byod-schema.md)
- [Deployment Guide](docs/DEPLOYMENT_GUIDE.md)
- [Collector Guide](docs/COLLECTOR_GUIDE.md)

---

## 📝 License

Proprietary — All rights reserved © 2026 EODI.ME

---

## 📞 Support

- Email: support@eodi.me
- Issues: GitHub Issues