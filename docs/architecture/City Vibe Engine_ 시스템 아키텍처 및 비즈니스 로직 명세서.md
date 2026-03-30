# ---

**⚙️ City Vibe Engine: 시스템 아키텍처 및 비즈니스 로직 명세서**

본 문서는 eodi.me 엔진의 핵심 구조, 보안 전략, 수익화 모델 및 파일 시스템 설계를 통합하여 정리한 기술 가이드입니다.

## **1\. 하이브리드 엔진 아키텍처 (Hybrid Architecture)**

**"Stable Core, Infinite Shell"** 철학을 바탕으로 보안과 확장성을 동시에 확보합니다.

* **App Shell (Electron):** 웹 기술(React)로 구현된 화려한 UI를 데스크톱 앱으로 구동하며, 백그라운드에서 파이썬 서버의 생명주기(실행/종료)를 관리합니다.  
* **Backend Core (Python/FastAPI):** 6축 바이브 알고리즘 연산, 로컬 SQLite DB 조회 및 Supabase와의 통신을 담당합니다.  
* **Compile (Nuitka):** 파이썬 코드를 기계어로 컴파일하여 리버스 엔지니어링을 방지하고 성능을 최적화합니다.

## **2\. 모딩 대응 파일 시스템 (Moddable File System)**

사용자가 UI를 직접 수정할 수 있도록 설치 경로와 실행 경로를 물리적으로 분리합니다.

* **설치 경로 (C:\\Program Files\\eodi.me):** 수정 불가능한 순정 파일(eodi\_core.exe, eodi\_shell.exe, 순정 UI 백업)이 위치합니다.  
* **실행 경로 (C:\\Users{User}\\AppData\\Local\\eodi.me):** 실제 앱이 로딩되는 경로입니다. 사용자는 ui/ 폴더 내의 HTML/CSS/JS를 수정하여 자신만의 모드를 적용할 수 있습니다.  
* **안전 장치:** 앱 실행 시 Shift 키를 누르면 AppData의 커스텀 UI를 무시하고 설치 폴더의 순정 UI를 로드하여 복구 모드로 진입합니다.

## **3\. 수익화 및 크레딧 시스템 (Monetization & Credits)**

관리형 서비스(SaaS)를 활용하여 서버 관리 부담을 최소화한 자동화 수익 구조를 구축합니다.

### **3.1. 투 트랙 판매 전략 (Two-Track Sales)**

| 구분 | Track A: 온라인 (일반) | Track B: 오프라인 (Pro) |
| :---- | :---- | :---- |
| **모델** | 무료 설치 \+ 크레딧 충전(IAP) | 고가 Pro 라이선스 키 판매 |
| **인증** | Supabase 서버 실시간 인증 | HWID(하드웨어 ID) 기반 노드락 |
| **결제** | Lemon Squeezy (카드/페이) | Lemon Squeezy (라이선스 발급) |

### **3.2. 크레딧 차감 및 충전 로직**

* **차감:** 사용자가 '분석하기' 클릭 시 Supabase RPC 함수를 호출하여 서버 측에서 안전하게 1 크레딧을 차감합니다.  
* **충전:** 결제 완료 시 **Lemon Squeezy Webhook**이 **Supabase Edge Function**을 호출하여 유저의 장부를 자동으로 업데이트합니다.

## **4\. 보안 및 컴파일 전략 (Security Strategy)**

* **Nuitka 컴파일:** 파이썬 코드를 C로 변환 후 컴파일하여 소스 코드 노출을 원천 차단합니다.  
* **HWID 노드락:** Pro 버전의 경우 사용자의 CPU/메인보드 고유 ID를 인식하여 허가된 기기에서만 작동하도록 제한합니다.  
* **Row Level Security (RLS):** Supabase DB 보안 규칙을 통해 유저가 자신의 크레딧 정보 외에는 접근하거나 수정할 수 없도록 방어합니다.

## **5\. 업데이트 시스템 (Update Pipeline)**

* **엔진 업데이트:** 인스톨러 재설치 또는 전용 updater.exe를 통한 패치.  
* **데이터 업데이트:** 앱 실행 시 Supabase에서 최신 vibe\_data.db 버전을 체크하여 백그라운드에서 자동 다운로드 및 교체(Hot-Swap).  
* **UI 패치:** 공식 배포판 업데이트 또는 유저 커뮤니티(Discord 등)를 통한 .zip 파일 형태의 모드 공유.

---

