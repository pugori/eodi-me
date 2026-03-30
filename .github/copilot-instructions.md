# Copilot repository instructions

## Purpose
이 프로젝트(eodi.me)를 GitHub Copilot CLI에서 **전체적으로** 조회·수정·개선할 수 있도록 안내합니다.
초기 프로젝트 인식 속도를 높이기 위해 **스캔하지 말아야 할 경로**를 명시합니다.

## Project structure (scan these)
모든 소스 디렉터리는 자유롭게 조회·수정 가능합니다.

| Directory | Language / Role |
|---|---|
| `rust-collector/src/` | Rust — 데이터 수집 파이프라인 (cities, POI, hexagons, VDB) |
| `rust-engine/src/` | Rust — 검색/추천 엔진 서버 |
| `engine-server/src/` | Rust — 엔진 서버 (alternative) |
| `go-api/cmd/`, `go-api/internal/` | Go — REST API, 엔진 매니저, 미들웨어 |
| `go-api/window/` | Go — 윈도우 호스트 |
| `tauri-shell/src/`, `tauri-shell/src-tauri/` | TypeScript + Rust — 데스크톱 앱 (Tauri) |
| `window-host/` | 윈도우 호스트 앱 |
| `src/` | Python — 유틸리티, 테스트 |
| `scripts/` | PowerShell / Python — 보조 스크립트 |
| `tests/` | 통합 테스트 |
| `config/`, `.github/`, `monitoring/` | CI, config, alerting |
| `docs/` | 문서 |
| `supabase/` | Supabase 설정 |

## Paths to IGNORE (do NOT scan or modify)
아래 경로는 생성물·의존성·대형 바이너리이므로 **절대 스캔하지 마세요**.
이 목록이 초기 인식 속도를 결정합니다.

```
**/node_modules/
**/target/
**/dist/
**/.vite/
**/output/
**/.ruff_cache/
**/.venv/
**/__pycache__/
tauri-shell/public/
go-api/frontend/
*.ckpt
*.edb
*.edbh
*.db
*.npz
*.faiss
*.enc
*.exe
*.hex_poi_ckpt
*.poi_ckpt
*.log
```

## Scope — full project
- 프로젝트 전체(수집기, 엔진, API, 프런트엔드, 배포) 모두 조회·수정 가능.
- 빌드 아티팩트·생성 파일은 직접 수정하지 말 것.

## Runtime / CLI guidance
- 빌드나 테스트 요청 시 해당 서브프로젝트만 타겟으로 실행:
  - Rust: `pushd rust-collector; cargo build --bin eodi-collector; popd`
  - Go: `pushd go-api; go build ./cmd/server; popd`
  - Tauri: `pushd tauri-shell; npm run build; popd`
- 네트워크 부하가 큰 수집 작업은 기본적으로 `--limit` 및 `--skip_*` 플래그를 사용.

## Change policy
- 편집은 최소한으로, 관련 파일만 수정.
- 포맷팅만 변경하는 대량 수정 금지.
- 대형 생성 파일을 커밋하지 말 것 — 필요하면 먼저 확인.
