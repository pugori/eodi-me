# ---

**⚙️ City Vibe Engine: 핵심 엔진 및 보안 구현 명세서**

본 문서는 eodi.me의 핵심 엔진인 **Python Core**와 이를 구동하는 **Electron Shell**, 그리고 **보안/결제 로직**의 백엔드 코드를 집중적으로 다룹니다.

## **1\. 엔진 생명주기 관리 (Electron Shell)**

메인 프로세스에서 파이썬 엔진을 실행하고 제어하는 핵심 로직입니다.

### **1.1. 파이썬 엔진 자식 프로세스 실행**

JavaScript

// main.js (Electron)  
const { spawn } \= require('child\_process');  
const path \= require('path');

let pythonProcess \= null;

function startPythonEngine() {  
  // 개발 시에는 main.py를, 배포 시에는 컴파일된 exe를 실행하도록 경로 설정  
  const scriptPath \= path.join(\_\_dirname, '../engine/main.py');   
    
  // Nuitka로 컴파일된 경우 'eodi\_core.exe'로 실행  
  pythonProcess \= spawn('python', \[scriptPath\]); 

  pythonProcess.stdout.on('data', (data) \=\> {  
    console.log(\`\[Core Engine\]: ${data}\`);  
  });

  pythonProcess.stderr.on('data', (data) \=\> {  
    console.error(\`\[Engine Error\]: ${data}\`);  
  });  
}

// 앱 준비 시 엔진 실행  
app.on('ready', () \=\> {  
  startPythonEngine();  
  createWindow();  
});

## **2\. 크레딧 및 보안 엔진 (Python Core)**

파이썬 백엔드에서 Supabase와 통신하여 크레딧을 검증하고 차감하는 엔진 내부 로직입니다.

### **2.1. 서버 측 크레딧 차감 로직 (Python)**

Python

\# engine/credit.py  
from supabase import create\_client

\# Supabase 설정 (환경 변수 또는 설정 파일에서 로드)  
url \= "YOUR\_SUPABASE\_URL"  
key \= "YOUR\_SUPABASE\_ANON\_KEY"  
supabase \= create\_client(url, key)

def use\_credit():  
    """  
    분석 실행 전 서버에 크레딧 차감을 요청합니다.  
    성공(True) 시에만 분석 엔진이 구동됩니다.  
    """  
    try:  
        \# RPC 함수 호출 (서버 측에서 안전하게 차감 수행)  
        response \= supabase.rpc('decrement\_credit', {'amount': 1}).execute()  
          
        \# 성공 시 응답 처리 (Supabase RPC 응답 구조에 따름)  
        return True  
    except Exception as e:  
        print(f"Credit Deduction Failed: {e}")  
        return False

## **3\. 데이터베이스 보안 로직 (Supabase SQL)**

클라이언트의 조작을 방지하기 위해 데이터베이스 서버 내부에서 실행되는 보안 함수입니다.

### **3.1. 크레딧 차감 RPC 함수 (PL/pgSQL)**

SQL

\-- 1 크레딧을 안전하게 차감하고, 잔액이 부족하면 에러를 발생시킴  
create or replace function decrement\_credit(amount int)  
returns void as $$  
begin  
  update user\_credits  
  set balance \= balance \- amount  
  where user\_id \= auth.uid()   
    and balance \>= amount; \-- 잔액 확인 조건

  if not found then  
    raise exception 'Insufficient credits';  
  end if;  
end;  
$$ language plpgsql security definer;

## **4\. 엔진 보호 및 컴파일 (Nuitka)**

소스 코드 유출 방지를 위한 파이썬 엔진 컴파일 설정입니다.

### **4.1. Nuitka 빌드 명령어**

Bash

\# 단일 실행 파일로 컴파일하며 콘솔창을 숨기고 보안성을 높임  
nuitka \--standalone \\  
       \--onefile \\  
       \--windows-disable-console \\  
       \--output-filename=eodi\_core.exe \\  
       main.py

## **5\. 결제 자동화 웹훅 (Supabase Edge Function)**

레몬 스퀴지 결제 완료 시 유저의 장부를 자동으로 업데이트하는 로직입니다.

### **5.1. Lemon Squeezy Webhook 수신기 (TypeScript)**

TypeScript

// supabase/functions/lemon-webhook/index.ts  
serve(async (req) \=\> {  
  const payload \= await req.json();  
  const userEmail \= payload.data.attributes.user\_email;  
  const variantName \= payload.data.attributes.variant\_name;  
      
  // 결제 상품명에 따른 크레딧 가산치 설정  
  let creditsToAdd \= 0;  
  if (variantName \=== 'Starter Pack') creditsToAdd \= 10;  
  if (variantName \=== 'Nomad Pack') creditsToAdd \= 60;

  // 유저 계정 정보 확인 후 DB 업데이트  
  const { error } \= await supabase  
    .from('user\_credits')  
    .update({ balance: current\_balance \+ creditsToAdd })  
    .eq('email', userEmail);  
      
  return new Response('Credit Sync Complete', { status: 200 });  
});

---

