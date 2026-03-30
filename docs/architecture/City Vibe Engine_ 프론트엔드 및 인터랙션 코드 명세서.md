# ---

**💻 City Vibe Engine: 프론트엔드 및 인터랙션 코드 명세서**

본 문서는 eodi.me 웹 앱의 시각적 구현과 기능적 로직을 위한 핵심 코드 세그먼트를 정리한 문서입니다.

## **1\. 애플 스타일 디자인 구현 (CSS)**

### **1.1. Glassmorphism 카드 시스템**

배경 흐림 효과와 미세한 외곽선을 통해 애플 특유의 유리 질감을 구현합니다.

CSS

/\* 핵심 카드 컴포넌트 \*/  
.vibe-card {  
  position: relative;  
  background: rgba(28, 28, 30, 0.65); /\* 애플 다크모드 베이스 \*/  
  backdrop-filter: blur(25px) saturate(180%);  
  \-webkit-backdrop-filter: blur(25px) saturate(180%);  
  border-radius: 22px; /\* iOS 표준 곡률 \*/  
  border: 1px solid rgba(255, 255, 255, 0.08);  
  padding: 20px;  
  transition: all 0.4s cubic-bezier(0.25, 1, 0.5, 1);  
}

/\* 호버 인터랙션 \*/  
.vibe-card:hover {  
  transform: translateY(-4px);  
  border: 1px solid rgba(255, 255, 255, 0.2);  
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);  
}

## **2\. 지도 및 데이터 시각화 (Mapbox JS)**

### **2.1. 부드러운 'Fly-To' 이동**

유저의 시선 이동을 자연스럽게 만드는 애플식 곡선 비행 로직입니다.

JavaScript

function teleportToCity(coords) {  
    map.flyTo({  
        center: coords,  
        zoom: 15,  
        speed: 1.2,  
        curve: 1.4, // 비행 곡률 설정  
        essential: true   
    });  
}

### **2.2. 헥사곤 데이터 렌더링**

GeoJSON을 활용하여 바이브 점수에 따른 색상을 지도 위에 주입합니다.

JavaScript

function renderHexagonsOnMap(data) {  
    const geojson \= {  
        type: 'FeatureCollection',  
        features: data.map(hex \=\> ({  
            type: 'Feature',  
            geometry: { type: 'Polygon', coordinates: calculateHexCorners(hex) },  
            properties: {  
                vibeColor: hex.mainColor, // 6축 파스텔 톤 색상  
                vibeScore: hex.score,  
                opacity: 0.4   
            }  
        }))  
    };  
    map.getSource('hex-source').setData(geojson);  
}

## **3\. 비즈니스 및 결제 로직 (Supabase 연동)**

### **3.1. 분석 실행 및 크레딧 차감**

사용자가 '분석하기' 버튼을 눌렀을 때의 트랜잭션 흐름입니다.

JavaScript

async function startAnalysis(cityId) {  
  try {  
    // 1\. 크레딧 차감 (Supabase RPC 호출로 보안 강화)  
    const { data, error } \= await supabase.rpc('decrement\_credit', { amount: 1 });  
      
    if (error) throw new Error("크레딧 부족");

    // 2\. Python 엔진 호출 및 결과 수신  
    const result \= await window.api.invokeEngineAnalyze(cityId);  
      
    // 3\. 결과 리포트 출력 (슬라이드 인 애니메이션)  
    renderReport(result);  
  } catch (err) {  
    alert("분석을 시작할 수 없습니다: " \+ err.message);  
  }  
}

### **3.2. 실시간 크레딧 업데이트**

결제 완료 후 UI에 즉각적으로 잔액을 반영하기 위해 Supabase Realtime을 사용합니다.

JavaScript

// 크레딧 실시간 구독  
supabase  
  .channel('credit-changes')  
  .on('postgres\_changes', { event: 'UPDATE', schema: 'public', table: 'user\_credits' },   
    payload \=\> {  
      document.getElementById('current-credit').innerText \= payload.new.balance;  
    }  
  )  
  .subscribe();

## **4\. 성능 최적화 전략 (LOD)**

* **Viewport Filtering:** map.on('moveend', ...) 이벤트를 통해 현재 카메라 화면 내에 들어오는 데이터만 계산하여 과부하 방지.  
* **Zoom-based Opacity:** 줌 레벨이 15 이상일 경우 헥사곤의 투명도를 0.1로 낮추고 개별 상점(POI) 아이콘을 노출하는 디테일 제어.

---

