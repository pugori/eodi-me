# Contributing to eodi.me

Thank you for your interest in contributing. This document covers the development workflow.

> **Note:** eodi.me is a proprietary product. Contributions are accepted from maintainers only unless otherwise agreed. External contributors should open an issue first to discuss the change.

---

## Repository structure

| Directory | Language | Role |
|---|---|---|
| `rust-collector/` | Rust | Data collection pipeline (cities, POI, hexagons, VDB) |
| `engine-server/` | Rust (Axum) | Hexagon search/match engine (port 7557) |
| `go-api/` | Go (Gin) | REST API proxy, auth, rate limiting |
| `tauri-shell/` | TypeScript + Rust | Desktop app (Tauri v2) |
| `landing/` | HTML/CSS/JS | Marketing landing page |
| `supabase/` | SQL / TypeScript | License backend, webhooks |
| `monitoring/` | YAML | Prometheus + Grafana config |

## Development setup

### Prerequisites
- Rust stable (≥ 1.78) — `rustup update stable`
- Go ≥ 1.22 — `go version`
- Node.js ≥ 20 — for Tauri shell frontend
- Tauri CLI — `cargo install tauri-cli`

### Running the Go API (local)

```bash
cd go-api
cp .env.example .env          # edit JWT_SECRET and other vars
go run ./cmd/server
```

Build with version:
```bash
go build -ldflags "-X main.Version=1.2.3" -o bin/api-server ./cmd/server
```

### Running the engine server

```bash
cd engine-server
cargo run -- --bind=127.0.0.1 --port=7557 --db=../output/hexagons.edbh
```

### Running the desktop app (dev mode)

```bash
cd tauri-shell
npm install
npm run tauri dev
```

### Running tests

```bash
# Go API tests
cd go-api && go test ./... -v

# Rust engine tests
cd engine-server && cargo test

# Rust collector tests
cd rust-collector && cargo test
```

## Code style

- **Go**: `gofmt` + `golangci-lint` (run `golangci-lint run ./...`)
- **Rust**: `rustfmt` + `clippy` (run `cargo clippy -- -D warnings`)
- **TypeScript**: ESLint + Prettier (run `npm run lint`)

## Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):
```
feat(go-api): add /api/v1 route prefix with backward compat
fix(engine): guard division-by-zero in gaussian RBF similarity
docs: add SECURITY.md and CONTRIBUTING.md
```

## Security

Do **not** commit secrets, API keys, `.env` files, or `.edbh` database files.
See [SECURITY.md](SECURITY.md) for the vulnerability disclosure process.
