# 🌍 EODI.ME — Neighborhood Vibe Intelligence

[![License: Proprietary](https://img.shields.io/badge/license-Proprietary-red.svg)](LICENSE)
[![Rust](https://img.shields.io/badge/rust-1.75+-orange.svg)](https://www.rust-lang.org/)
[![Go](https://img.shields.io/badge/go-1.24+-blue.svg)](https://go.dev/)
[![Tauri](https://img.shields.io/badge/tauri-1.5-purple.svg)](https://tauri.app/)

> 13차원 동네 바이브 분석 데스크톱 앱 — 오프라인, 프라이버시 보호, 자체 호스팅

[English README](README.en.md) | [OpenAPI Docs](docs/openapi.yaml) | [Landing Page](landing/index.html)

---

## ✨ 주요 기능

- 🎯 **13D 바이브 분석** — 활동, 문화, 조용, 트렌디, 자연, 도시 6개 바이브 축 + 7개 내부 메타 벡터
- 🗺️ **H3 헥사곤 지도** — 해상도 8(~460m) 육각 격자 탐색
- 🔍 **벡터 검색** — 코사인 유사도 기반 유사 동네 추천
- 📦 **완전 오프라인** — 분석 로직 전체가 로컬 바이너리로 실행
- 🔐 **라이선스 티어** — Free / Personal / Solo Biz / Business / Enterprise
- 🌐 **로컬 API** — 외부 프로그램 연동용 Bearer 토큰 REST API
- 🐳 **Docker 자체 호스팅** — 기업용 셀프 서버 배포 지원

---

## 🏗️ 아키텍처

```
tauri-shell/          # 데스크톱 앱 (TypeScript + Rust)
├── src/              #   React 프론트엔드 (MapLibre GL, Vite)
└── src-tauri/        #   Tauri 쉘 (엔진 관리, 라이선스 검증)

engine-server/        # 검색/추천 엔진 (Rust, Axum)
                      #   AES-256-GCM 암호화 VDB, HMAC 플랜 검증

go-api/               # REST API 서버 (Go, Gin)
                      #   JWT 인증, Rate limiting, 엔진 프록시

rust-collector/       # 데이터 수집 파이프라인 (Rust)
                      #   OSM POI, Open-Meteo, 13D 벡터 생성, 암호화 DB
```

---

## 🚀 빠른 시작

### 데스크톱 앱 개발

```bash
# 의존성 설치
cd tauri-shell && npm install

# 엔진 빌드 (먼저 실행)
cd engine-server && cargo build --release --bin eodi-engine

# 앱 실행
cd tauri-shell && npm run tauri dev
```

### Docker 자체 호스팅 (Solo Biz+)

```bash
cp .env.example .env
# .env에서 ENGINE_API_KEY 설정: openssl rand -hex 32

docker compose -f docker-compose.engine.yml up -d

# HTTPS 활성화 (config/Caddyfile에 도메인 설정 후)
docker compose -f docker-compose.engine.yml --profile https up -d
```

### 데이터 수집 파이프라인

```powershell
$env:VECTOR_DB_PASSWORD = "your-password"
.\eodi-collector.exe build-full -f data/cities15000.txt -l 1000 -o data/hexagons.edbh
```

---

## 📂 프로젝트 구조

```
eodi.me/
├── tauri-shell/          # 데스크톱 앱 (Tauri + React)
├── engine-server/        # 벡터 검색 엔진 (Rust)
├── go-api/               # REST API 서버 (Go)
├── rust-collector/       # 데이터 수집 파이프라인 (Rust)
├── supabase/             # 구독 관리 (Edge Functions, Schema)
├── config/               # Caddy, Prometheus, Grafana 설정
├── monitoring/           # Alertmanager 설정
├── docs/                 # OpenAPI 스펙, 배포 가이드
├── landing/              # 정적 랜딩 페이지
└── scripts/              # PowerShell 자동화 스크립트
```

---

## 🛠️ 기술 스택

| 영역 | 기술 |
|------|------|
| 데스크톱 앱 | Tauri 1.5, React 18, TypeScript, MapLibre GL |
| 검색 엔진 | Rust (Axum), AES-256-GCM, HMAC-SHA256 |
| API 서버 | Go 1.24 (Gin), JWT v5, Zap logging |
| 데이터 수집 | Rust, OSM Overpass, Open-Meteo |
| 구독/결제 | Supabase (Edge Functions), LemonSqueezy |
| 모니터링 | Prometheus, Grafana, Alertmanager |
| 배포 | Docker, Caddy (HTTPS) |

---

## 📦 빌드 명령어

```bash
# 엔진 빌드
cd engine-server && cargo build --release

# Go API 빌드
cd go-api && go build ./cmd/server

# 프론트엔드 빌드
cd tauri-shell && npm run build

# 데스크톱 앱 배포용 빌드
cd tauri-shell && npm run tauri build
```

---

## 🔐 보안

- **엔진**: HMAC-SHA256 플랜 토큰 위조 방지, localhost only, 상수시간 비교
- **VDB**: Argon2id 키 유도 + AES-256-GCM 암호화 (런타임 복호화, 메모리 즉시 제거)
- **API**: JWT 강제 검증, 시작 시 약한 비밀키 거부, H3 인덱스 입력 검증
- **CSP**: Tauri Content Security Policy — 허용 도메인만 명시
- **라이선스**: HMAC 서명 + 활성화 스탬프, XOR 분할 키 난독화

---

## 📚 문서

- [OpenAPI 스펙](docs/openapi.yaml)
- [BYOD 데이터 가이드](docs/byod-schema.md)
- [배포 가이드](docs/DEPLOYMENT_GUIDE.md)
- [수집기 가이드](docs/COLLECTOR_GUIDE.md)

---

## 📝 라이선스

Proprietary — All rights reserved © 2026 EODI.ME

---

## 📞 지원

- 이메일: support@eodi.me
- 이슈: GitHub Issues