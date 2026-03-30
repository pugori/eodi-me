# 코드 품질 도구 사용 가이드

EODI.ME 프로젝트의 코드 일관성을 위해 **Ruff + pre-commit**이 설정되어 있습니다.

## 설치된 도구

- **Ruff**: 초고속 Python 린터 + 포맷터 (Black, isort, Flake8 통합)
- **pre-commit**: Git commit 전 자동 검사
- **mypy**: 타입 힌팅 검증 (선택)
- **pytest**: 테스트 프레임워크

## 빠른 시작

### 1. 개발 의존성 설치

```bash
pip install -r requirements-dev.txt
```

### 2. pre-commit 활성화

```bash
python -m pre_commit install
```

이제 `git commit` 시 자동으로 코드가 검사되고 포맷됩니다.

## 사용법

### 전체 코드 포맷 + 린팅

```bash
# 자동 수정
python scripts/format.py

# 검사만 (수정 안 함)
python scripts/format.py --check
```

### Ruff 직접 사용

```bash
# 포맷팅
python -m ruff format src/

# 린팅 (자동 수정)
python -m ruff check src/ --fix

# 검사만
python -m ruff check src/
```

### pre-commit 수동 실행

```bash
# 변경된 파일만
python -m pre_commit run

# 전체 파일
python -m pre_commit run --all-files
```

## 설정

### pyproject.toml

Ruff 설정은 [pyproject.toml](../pyproject.toml)에 정의되어 있습니다:

- **Line length**: 100자
- **Target**: Python 3.10+
- **활성화된 규칙**: pycodestyle, pyflakes, isort, pyupgrade, flake8-bugbear 등
- **무시된 규칙**: 
  - E501 (line too long) - 포맷터가 처리
  - PLR0913 (too many arguments)
  - ARG001 (unused argument) - FastAPI dependency injection

### .pre-commit-config.yaml

Git hook 설정은 [.pre-commit-config.yaml](../.pre-commit-config.yaml)에 정의:

- Ruff 포맷터 + 린터
- 파일 검사 (JSON, YAML, TOML 등)
- Git 충돌 검사
- Trailing whitespace 제거

## 일반적인 워크플로

### 개발 중

```bash
# 1. 코드 작성
# 2. 포맷 자동 적용
python scripts/format.py

# 3. 커밋 (자동 검사 실행됨)
git add .
git commit -m "Feature: ..."
```

### 커밋 전 검증

```bash
# 검사만 실행
python scripts/format.py --check

# 전체 검증 (validate + 포맷 검사)
python scripts/validate.py
python scripts/format.py --check
```

### CI/CD 파이프라인

```yaml
# GitHub Actions 예시
- name: Install dependencies
  run: pip install -r requirements-dev.txt

- name: Lint with Ruff
  run: python -m ruff check src/

- name: Check formatting
  run: python -m ruff format --check src/
```

## 린팅 규칙 설명

### 자주 나오는 경고

**F841: Unused variable**
```python
# ❌ Bad
result = some_function()  # 사용 안 함

# ✅ Good
_ = some_function()  # 의도적으로 무시
# 또는
some_function()
```

**PLC0415: Import not at top-level**
```python
# ⚠️ 경고 (하지만 때로 필요함)
def function():
    import optional_module  # 선택적 의존성

# ✅ 일반적으로 권장
import optional_module

def function():
    optional_module.use()
```

**PTH123: Use pathlib**
```python
# ❌ Old style
with open("file.txt") as f:
    content = f.read()

# ✅ Modern
from pathlib import Path
content = Path("file.txt").read_text()
```

## 특정 규칙 무시하기

### 파일 단위

```python
# ruff: noqa: F401
from module import *  # Import * 허용
```

### 라인 단위

```python
result = api.call()  # noqa: F841
```

### 설정 파일에서

`pyproject.toml`에서 전역 무시:
```toml
[tool.ruff.lint]
ignore = [
    "E501",  # Line too long
]
```

## 도구 비교

| 도구 | 속도 | 기능 | 통합 |
|-----|------|-----|------|
| **Ruff** | ⚡ 매우 빠름 | 린트 + 포맷 | 올인원 |
| Black | 빠름 | 포맷만 | Ruff 통합 |
| isort | 빠름 | Import 정렬 | Ruff 통합 |
| Flake8 | 느림 | 린트만 | Ruff 통합 |
| Pylint | 매우 느림 | 상세한 린트 | 별도 |

**결론**: Ruff 하나로 모두 해결! 🚀

## 문제 해결

### pre-commit이 PATH에 없음

```bash
# pre-commit 대신
python -m pre_commit install
```

### Ruff가 PATH에 없음

```bash
# ruff 대신
python -m ruff check src/
```

### 특정 파일 제외

`.pre-commit-config.yaml`의 `exclude` 패턴 수정:
```yaml
exclude: |
  (?x)^(
      data/|
      my_generated_file\.py
  )
```

## 참고 자료

- [Ruff 문서](https://docs.astral.sh/ruff/)
- [pre-commit 문서](https://pre-commit.com/)
- [pyproject.toml 설정](https://docs.astral.sh/ruff/configuration/)

---

**관련 파일**:
- [pyproject.toml](../pyproject.toml) - Ruff 설정
- [.pre-commit-config.yaml](../.pre-commit-config.yaml) - Git hooks
- [scripts/format.py](../scripts/format.py) - 포맷팅 스크립트
- [requirements-dev.txt](../requirements-dev.txt) - 개발 도구

**문서 업데이트**: 2026-02-17
