# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x     | ✅ Active  |

## Reporting a Vulnerability

Please **do not** file public GitHub issues for security vulnerabilities.

### Contact
Email: **security@eodi.me**  
Response time: within 72 hours for initial acknowledgement.

### What to include
- Description of the vulnerability and potential impact
- Steps to reproduce (proof-of-concept if available)
- Affected component (engine-server, go-api, tauri-shell, rust-collector)
- Any suggested mitigations

## Security Architecture

### Data at rest
- Vector database (`.edbh`) is **AES-256-GCM encrypted** at rest
- All user overlay data is stored locally on the user's device; no cloud uploads

### Authentication
- Plan tokens use **HMAC-SHA256** with a compile-time secret (XOR-split key)
- Session tokens are ephemeral and rotate on every engine restart
- API keys (Business+) are persistent hex strings stored in the app config

### Network
- Desktop mode: engine binds to **127.0.0.1 only** (loopback)
- Docker mode: engine binds to `0.0.0.0` with mandatory `--api-key` flag
- Go API enforces rate limiting, CORS origin allowlist, and HSTS in production

### Supply chain
- All dependencies are pinned in `Cargo.lock` / `go.sum`
- Docker images are built from official distroless/scratch bases

## Disclosure Policy

We follow **responsible disclosure**. Reporters who follow this policy will:
- Receive acknowledgement within 72 hours
- Be kept informed as the issue is investigated and fixed
- Be credited in the changelog (if desired) once the fix is released

We aim to release security fixes within **14 days** of confirmed vulnerabilities.
