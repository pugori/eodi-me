# Makefile 사용 가이드

EODI.ME 프로젝트의 Makefile은 40+ 개의 명령어로 전체 개발 워크플로우를 자동화합니다.

## 📋 목차

- [설치 및 설정](#설치-및-설정)
- [개발](#개발)
- [테스트](#테스트)
- [코드 품질](#코드-품질)
- [데이터베이스](#데이터베이스)
- [데이터 수집](#데이터-수집)
- [빌드](#빌드)
- [Docker](#docker)
- [배포](#배포)
- [모니터링](#모니터링)
- [유틸리티](#유틸리티)
- [정리](#정리)

## 설치 및 설정

### `make install`
프로덕션 의존성 설치

```bash
make install
```

**수행 작업:**
- `requirements.txt` 패키지 설치
- Python 가상환경 활성화 권장

### `make install-dev`
개발 의존성 포함 전체 설치

```bash
make install-dev
```

**수행 작업:**
- 프로덕션 의존성 설치
- 개발 도구 설치 (pytest, ruff, mypy 등)
- pre-commit hooks 설정

### `make setup`
프로젝트 초기 설정

```bash
make setup
```

**수행 작업:**
- 의존성 설치 (`install-dev`)
- `.env` 파일 생성 (`.env.example`에서 복사)
- 데이터 디렉토리 생성
- 데이터베이스 초기화

**사용 시점:** 저장소를 처음 클론했을 때

## 개발

### `make dev`
개발 서버 시작 (핫 리로드)

```bash
make dev
```

**수행 작업:**
- Uvicorn 개발 서버 실행 (포트 8000)
- 자동 리로드 활성화
- 로그 레벨: INFO

**접속:**
- API: http://localhost:8000
- 문서: http://localhost:8000/docs

### `make dev-logs`
개발 서버 + 상세 로그

```bash
make dev-logs
```

**차이점:**
- 로그 레벨: DEBUG
- 모든 요청/응답 로깅

### `make shell`
Python 쉘 (프로젝트 컨텍스트)

```bash
make shell
```

**사용 예시:**
```python
>>> from config.settings import Settings
>>> settings = Settings()
>>> print(settings.APP_NAME)
EODI.ME
```

## 테스트

### `make test`
전체 테스트 실행

```bash
make test
```

**수행 작업:**
- 단위 테스트
- 통합 테스트
- E2E 테스트

### `make test-cov`
커버리지 포함 테스트

```bash
make test-cov
```

**출력:**
- 터미널에 커버리지 리포트
- `htmlcov/index.html` HTML 리포트 생성

**브라우저에서 확인:**
```bash
make test-cov
open htmlcov/index.html  # macOS
start htmlcov/index.html  # Windows
```

### `make test-fast`
빠른 테스트 (단위 테스트만)

```bash
make test-fast
```

**사용 시점:**
- TDD 작업 중
- 빠른 피드백 필요

### `make test-watch`
감시 모드 (파일 변경 시 자동 실행)

```bash
make test-watch
```

**수행 작업:**
- pytest-watch로 파일 변경 감지
- 자동으로 관련 테스트 재실행

**종료:** Ctrl+C

## 코드 품질

### `make lint`
린트 검사 (수정 안 함)

```bash
make lint
```

**검사 항목:**
- Ruff: 코드 스타일, 복잡도, 버그 패턴
- MyPy: 타입 힌팅 검증

### `make lint-fix`
린트 + 자동 수정

```bash
make lint-fix
```

**자동 수정:**
- Import 정렬
- 포맷팅 문제
- 간단한 스타일 이슈

### `make format`
코드 포맷팅

```bash
make format
```

**수행 작업:**
- Ruff format 실행
- Black 스타일 적용
- 파일 수정

### `make format-check`
포맷팅 검사 (수정 안 함)

```bash
make format-check
```

**사용 시점:**
- CI/CD 파이프라인
- 커밋 전 검증

### `make pre-commit`
커밋 전 전체 검사

```bash
make pre-commit
```

**수행 작업:**
1. 포맷팅 검사
2. 린트 검사
3. 타입 체크
4. 테스트 실행

**권장:** 커밋하기 전 항상 실행

## 데이터베이스

### `make db-init`
데이터베이스 초기화

```bash
make db-init
```

**수행 작업:**
- 테이블 생성 (schema.sql)
- 초기 데이터 로드

### `make db-migrate`
마이그레이션 실행

```bash
make db-migrate
```

**수행 작업:**
- `scripts/migration/` 스크립트 실행
- 스키마 변경 적용

### `make db-backup`
데이터베이스 백업

```bash
make db-backup
```

**출력:**
- `backups/db_backup_YYYYMMDD_HHMMSS.sql`

### `make db-restore`
백업 복원

```bash
make db-restore BACKUP_FILE=backups/db_backup_20240115_103000.sql
```

**주의:** 기존 데이터 삭제됨

### `make db-shell`
데이터베이스 쉘 접속

```bash
make db-shell
```

**PostgreSQL 예시:**
```sql
\dt  -- 테이블 목록
SELECT COUNT(*) FROM cities;
```

## 데이터 수집

### `make collect`
스마트 데이터 수집

```bash
make collect
```

**수행 작업:**
1. 수집 상태 자동 감지
2. 사용자에게 옵션 제안
3. 수집 실행

### `make collect-status`
수집 상태 확인

```bash
make collect-status
```

**출력 예시:**
```
수집 진행률: 65.3% (21,701 / 33,248)
성공: 21,450
실패: 251
미수집: 11,547
```

### `make collect-validate`
수집 데이터 검증

```bash
make collect-validate
```

**검사 항목:**
- 파일 무결성
- 데이터 포맷
- 필수 필드 존재

## 빌드

### `make build`
Python 패키지 빌드

```bash
make build
```

**출력:**
- `dist/eodime-1.0.0-py3-none-any.whl`
- `dist/eodime-1.0.0.tar.gz`

### `make build-exe`
Nuitka 실행 파일 빌드

```bash
make build-exe
```

**출력:**
- `engine-dist/eodi_core.exe` (Windows)
- `engine-dist/eodi_core` (Linux/macOS)

**소요 시간:** 10-20분

### `make build-electron`
Electron 앱 빌드

```bash
make build-electron
```

**출력:**
- `shell/dist-electron/City Vibe Engine Setup.exe` (Windows)
- `shell/dist-electron/City Vibe Engine.dmg` (macOS)
- `shell/dist-electron/City Vibe Engine.AppImage` (Linux)

## Docker

### `make docker-build`
Docker 이미지 빌드

```bash
# 프로덕션 이미지
make docker-build

# 개발 이미지
make docker-build TARGET=development

# 수집기 이미지
make docker-build TARGET=collector
```

### `make docker-run`
Docker 컨테이너 실행

```bash
make docker-run
```

**수행 작업:**
- 프로덕션 이미지 실행
- 포트 8000 노출
- 데이터 볼륨 마운트

### `make docker-compose-up`
전체 스택 시작

```bash
make docker-compose-up
```

**시작 서비스:**
- API (FastAPI)
- PostgreSQL
- Redis
- Prometheus
- Grafana
- Nginx (옵션)

### `make docker-compose-down`
전체 스택 종료

```bash
make docker-compose-down
```

### `make docker-compose-logs`
전체 서비스 로그

```bash
make docker-compose-logs
```

**실시간 출력:**
```bash
make docker-compose-logs | grep ERROR
```

### `make docker-compose-restart`
전체 스택 재시작

```bash
make docker-compose-restart
```

### `make docker-collector`
수집 컨테이너만 실행

```bash
make docker-collector
```

**사용 시점:**
- 대규모 데이터 수집
- CI/CD 자동 수집

## 배포

### `make deploy-staging`
스테이징 환경 배포

```bash
make deploy-staging
```

**수행 작업:**
1. 테스트 실행
2. 린트 검사
3. Docker 이미지 빌드
4. 스테이징 서버에 배포

### `make deploy-production`
프로덕션 환경 배포

```bash
make deploy-production
```

**수행 작업:**
1. 모든 테스트 실행
2. 보안 검사
3. 프로덕션 이미지 빌드
4. 프로덕션 서버에 배포

**주의:** 확인 메시지 표시

## 모니터링

### `make health`
헬스 체크

```bash
make health
```

**출력:**
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "components": {
    "database": "healthy",
    "faiss_index": "healthy",
    ...
  }
}
```

### `make logs`
애플리케이션 로그 확인

```bash
make logs
```

**실시간 출력:**
```bash
make logs | grep ERROR
make logs | jq '.level == "ERROR"'  # JSON 로그
```

### `make metrics`
Prometheus 메트릭 확인

```bash
make metrics
```

**출력:**
- `http_requests_total`
- `http_request_duration_seconds`
- `database_connections`
- ...

## 유틸리티

### `make check-env`
환경 변수 검증

```bash
make check-env
```

**검사 항목:**
- 필수 환경 변수 존재
- 값 유효성 검증
- 파일 경로 확인

### `make version`
버전 정보 출력

```bash
make version
```

**출력:**
```
EODI.ME v1.0.0
Python: 3.10.12
FastAPI: 0.109.0
```

### `make info`
프로젝트 정보 출력

```bash
make info
```

**출력:**
- 프로젝트 구조
- 설치된 패키지
- 시스템 정보

### `make docs`
문서 생성

```bash
make docs
```

**출력:**
- `docs/_build/html/index.html`

### `make docs-serve`
문서 서버 시작

```bash
make docs-serve
```

**접속:**
- http://localhost:8080

## 정리

### `make clean`
빌드 아티팩트 제거

```bash
make clean
```

**삭제 항목:**
- `__pycache__`
- `*.pyc`
- `.pytest_cache`
- `dist/`
- `build/`

### `make clean-data`
데이터 파일 제거

```bash
make clean-data
```

**주의:** 수집된 데이터 삭제됨

### `make clean-logs`
로그 파일 제거

```bash
make clean-logs
```

### `make clean-all`
모든 생성 파일 제거

```bash
make clean-all
```

**삭제 항목:**
- 빌드 아티팩트
- 데이터 파일
- 로그 파일
- Docker 이미지
- 가상환경

**주의:** 복구 불가능

## 💡 사용 팁

### 일일 개발 워크플로우

```bash
# 1. 프로젝트 시작
make dev

# 2. 테스트 주도 개발 (별도 터미널)
make test-watch

# 3. 코드 변경 후 커밋 전
make pre-commit

# 4. 커밋
git add .
git commit -m "feat: add feature"
```

### 데이터 수집 워크플로우

```bash
# 1. 상태 확인
make collect-status

# 2. 수집 시작
make collect

# 3. 검증
make collect-validate
```

### 배포 워크플로우

```bash
# 1. 스테이징 배포 및 테스트
make deploy-staging
make health

# 2. 문제 없으면 프로덕션 배포
make deploy-production
make health
```

### Docker 개발 워크플로우

```bash
# 1. 전체 스택 시작
make docker-compose-up

# 2. 로그 확인 (별도 터미널)
make docker-compose-logs

# 3. 코드 변경 후 재시작
make docker-compose-restart

# 4. 작업 종료
make docker-compose-down
```

## 🔍 자주 사용하는 명령어

| 작업 | 명령어 |
|------|--------|
| 개발 서버 시작 | `make dev` |
| 테스트 실행 | `make test` |
| 코드 정리 | `make lint-fix && make format` |
| 커밋 전 검사 | `make pre-commit` |
| Docker 스택 시작 | `make docker-compose-up` |
| 데이터 수집 | `make collect` |
| 빌드 | `make build` |
| 배포 | `make deploy-staging` |
| 정리 | `make clean` |

## 📚 추가 문서

- [README.md](../README.md) - 프로젝트 개요
- [BUILD_GUIDE.md](BUILD_GUIDE.md) - 빌드 상세 가이드
- [COLLECTOR_GUIDE.md](COLLECTOR_GUIDE.md) - 데이터 수집 가이드
- [.env.example](../.env.example) - 환경 변수 설정

---

**질문이나 문제가 있으면 이슈를 생성해주세요!**
