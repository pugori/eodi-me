# ---

**🎨 City Vibe Engine: 프론트엔드 디자인 및 기술 명세 요약**

본 문서는 eodi.me 웹 앱의 디자인 시스템, UI 컴포넌트 구현 방식, 그리고 지도 기반 인터랙션 로직을 정리한 통합 가이드입니다.

## **1\. 디자인 시스템 (Design System)**

**"Apple Aesthetics: 다크 모드 속 파스텔 유리 질감"**

* **디자인 철학:** macOS/iPadOS의 깊이감과 부드러운 인터랙션을 지향. 정보 전달의 명확성과 시각적 피로도 최소화에 집중.  
* **컬러 팔레트:**  
  * **Background:** Ink Black (\#1A1A1C) \- 눈이 편안한 깊은 회색.  
  * **Glass Panel:** rgba(255, 255, 255, 0.08) \+ Blur(25px) \+ 미세한 흰색 테두리.  
  * **6축 바이브(Pastel):** Soft Rose(Active), Soft Lavender(Quiet), Soft Mint(Trendy), Soft Gold(Classic), Soft Sage(Nature), Soft Azure(Urban).  
* **타이포그래피:** Pretendard (애플 가독성 표준 준수).

## **2\. 핵심 UI 컴포넌트 구현 (Glassmorphism)**

애플식 '유리 질감' 카드 시스템을 구현하기 위한 핵심 CSS 및 구조입니다.

* **Vibe Card:** backdrop-filter: blur(25px) saturate(180%)를 적용하여 배경을 뭉개고 깊이감을 부여.  
* **인터랙션:** 마우스 호버 시 translateY(-4px) 이동 및 테두리 광택 강조 효과.  
* **상태 표시바:** 상단에 잎새 아이콘과 함께 현재 잔여 크레딧을 표시하며, 충전 버튼(+)을 통해 결제 모달로 연결.

## **3\. 지도 및 헥사곤 시스템 (Mapbox Integration)**

지도는 단순한 배경이 아니라 분석 데이터를 시각화하는 핵심 캔버스입니다.

* **Apple-Style Fly-To:** 도시 간 이동 시 직선이 아닌 부드러운 곡선 비행 효과(map.flyTo) 적용.  
* **뷰포트 필터링:** 성능 최적화를 위해 현재 화면(Viewport) 내에 보이는 헥사곤 영역만 계산하여 렌더링.  
* **헥사곤 레이어:** GeoJSON을 활용하여 바이브 점수에 따른 색상과 투명도를 동적으로 적용.  
* **LOD (Level of Detail):**  
  * **줌아웃:** 도시 전체의 바이브 흐름 강조.  
  * **줌인:** 헥사곤 투명도를 낮추고 개별 POI(상점, 장소) 아이콘 노출.

## **4\. 프론트엔드 비즈니스 로직**

사용자의 액션에 따른 기술적 흐름입니다.

1. **로그인 및 조회:** Supabase Auth로 로그인 후 user\_credits 테이블에서 실시간 잔액 조회.  
2. **분석 실행 로직:**  
   * '분석하기' 클릭 시 Supabase RPC 함수를 호출하여 잔액 확인.  
   * 잔액 충족 시 Python Core 엔진과 통신하여 분석 결과 수신.  
   * 분석 완료와 동시에 크레딧 1 차감 및 결과 리포트 슬라이드 인(Slide-in).  
3. **충전 프로세스:** 충전 버튼 클릭 → Lemon Squeezy 결제창 팝업 → 웹훅 통신을 통한 크레딧 실시간 업데이트.

## **5\. 단계별 구현 로드맵**

* **Phase 1:** Supabase 환경 설정 및 DB 스키마/RLS 보안 규칙 수립.  
* **Phase 2:** 디자인 가이드 기반의 HTML/CSS 퍼블리싱 및 Glassmorphism 컴포넌트 제작.  
* **Phase 3:** Mapbox 연동 및 헥사곤 시각화 로직 완성.  
* **Phase 4:** 분석 API 연동 및 크레딧 차감/결제 웹훅 최종 테스트.

---

