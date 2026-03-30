# Development Tools

개발 및 유지보수를 위한 스크립트 모음

## 스크립트

### 빌드 스크립트

**build_engine.py**
- 엔진 컴파일
- 실행 파일 생성

```bash
python scripts/build_engine.py
```

**build_all.py**
- 전체 프로젝트 빌드
- 릴리스 패키지 생성

```bash
python scripts/build_all.py
```

### 유지보수 스크립트

**cleanup.py**
- 캐시 정리
- 로그 파일 정리
- 임시 파일 제거

```bash
python scripts/cleanup.py
```

**validate.py**
- 프로젝트 상태 검증
- 의존성 확인

```bash
python scripts/validate.py
```
- FAISS vs NumPy 성능 비교
- 쿼리 속도 측정

```bash
python scripts/bench_faiss.py
```

## 사용 예시

### 개발 시작 전

```bash
# 프로젝트 상태 확인
python scripts/validate.py

# 필요시 정리
python scripts/cleanup.py
```

### 빌드 전

```bash
# 전체 빌드
python scripts/build_all.py

# 또는 엔진만
python scripts/build_engine.py
```

### 정기 유지보수

```bash
# 주기적으로 실행하여 불필요한 파일 정리
python scripts/cleanup.py

# 프로젝트 건강도 체크
python scripts/validate.py
```

## CI/CD 통합

GitHub Actions에서 사용할 수 있습니다:

```yaml
- name: Validate project
  run: python scripts/validate.py

- name: Build release
  run: python scripts/build_all.py
```

## 출력 예시

### validate.py

```
=============================================================
EODI.ME Project Health Check
=============================================================

--- Python Version ---
✅ Python 3.10.11

--- Dependencies ---
✅ numpy
✅ fastapi
✅ uvicorn
...

--- Module Imports ---
✅ engine.config
✅ engine.vector_utils
...

=============================================================
Summary
=============================================================
✅ Python Version
✅ Dependencies
✅ Configuration Files
✅ Data Files
✅ Module Imports
✅ Code Quality

Passed: 6/6

✨ All checks passed! Project is healthy.
```

### cleanup.py

```
=============================================================
EODI.ME Project Cleanup
=============================================================

Removed: src\engine\__pycache__
Removed: src\collector\__pycache__
✅ Cleaned 8 __pycache__ directories
✅ Removed 23 .pyc files
✅ Cleaned 2 temporary directories

Found 5 log files:
  - data\raw\collector.log (2.3 KB)
  - shell\logs\engine.log (15.7 KB)
  ...

Remove log files? (y/N): n

=============================================================
✨ Cleanup complete!
=============================================================
```

## 팁

1. **정기 검증**: 개발 중 `validate.py`를 주기적으로 실행하여 문제 조기 발견
2. **빌드 전 정리**: 빌드 전에 `cleanup.py`를 실행하여 깨끗한 상태 유지
3. **CI 통합**: 자동화된 검증을 위해 CI 파이프라인에 포함
4. **성능 모니터링**: `bench_faiss.py`로 최적화 효과 측정

---

**문서 업데이트**: 2026-02-17  
**관련 문서**: [BUILD_GUIDE.md](../docs/BUILD_GUIDE.md)
