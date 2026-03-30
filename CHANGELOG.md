# Changelog

All notable changes to eodi.me are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project adheres to [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Added
- **Go API**: `/api/v1` route prefix with backward-compatible `/api` alias
- **Go API**: Real Prometheus metrics at `GET /metrics` (text exposition format) with JSON fallback
  - `eodi_api_http_requests_total` — request count by method/path/status
  - `eodi_api_http_request_duration_seconds` — latency histogram
  - `eodi_api_active_requests` — in-flight gauge
  - `eodi_engine_searches_total` — engine proxy count
- **Go API**: Build-time version injection via `-ldflags "-X main.Version=x.y.z"`
- **Go API**: Strengthened security headers — HSTS, CSP, X-XSS-Protection
- **Go API**: Config validation — port range (1–65535), RateLimitRPS > 0
- **Landing**: `robots.txt` and `sitemap.xml`
- **Landing**: `hreflang` tags and sitemap `<link>` reference in `<head>`
- **Docs**: `SECURITY.md`, `CHANGELOG.md`, `CONTRIBUTING.md`
- **Docs**: OpenAPI `contact`, `license`, `termsOfService` metadata
- **Tests**: 9 Go handler tests, 12 Rust engine search tests
- **Legal**: `privacy.html` (GDPR/CCPA), `terms.html` (seat limits, 14-day refund)
- **User data**: `export_user_data` / `import_user_data` Tauri commands

### Fixed
- **Go API**: `GaussianRBFSimilarity` — division-by-zero guard when `sigmaSquared ≤ 0`
- **Go API**: `L2DistanceSquared` — returns `(0, false)` instead of `(-1, true)` on length mismatch
- **Go API**: `HealthCheck` version field now reflects actual build version

### Changed
- `/metrics` endpoint now serves Prometheus text format by default (JSON on `Accept: application/json`)

---

## [1.0.1] — Patch release

### Fixed
- Auto-updater support: added `"updater"` bundle target to generate `.nsis.zip` + `.sig` artifacts
- Download page now resolves installer URL dynamically via GitHub Releases API (no hard-coded filename)
- Removed stale `api.lemonsqueezy.com` entry from Tauri CSP

---

## [1.0.0] — Initial release

### Added
- Offline-first hexagon neighborhood analysis engine (Rust, 13D vector)
- Desktop app (Tauri + React TypeScript)
- Go REST API with rate limiting, JWT auth, and SQLite city database
- Docker Compose deployment with Caddy reverse proxy
- Supabase integration for license management
- LemonSqueezy payment webhook handler
- AES-256-GCM encrypted vector database (`.edbh`)
- HMAC-SHA256 plan token system
