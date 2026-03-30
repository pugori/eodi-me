import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

const OUT = 'C:/Temp/eodi_screens';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setViewportSize({ width: 1400, height: 900 });
// ?preview=1 → DEV 전용 프리뷰 모드: 엔진 연결 없이 샘플 데이터로 UI 확인
await page.goto('http://localhost:5173/?preview=1', { waitUntil: 'networkidle', timeout: 15000 });
await page.waitForTimeout(3000);

// ── 온보딩 닫기 ──────────────────────────────────────────
async function closeOnboarding() {
  try {
    const skip = page.locator('button').filter({ hasText: '건너뛰기' }).first();
    await skip.waitFor({ timeout: 4000 });
    await skip.click();
    await page.waitForTimeout(800);
    console.log('✓ 온보딩 건너뛰기');
  } catch (_) {}
  try {
    const start = page.locator('button').filter({ hasText: '시작하기' }).first();
    await start.waitFor({ timeout: 3000 });
    await start.click();
    await page.waitForTimeout(1800);
    console.log('✓ 시작하기 클릭');
  } catch (_) {
    try { await page.keyboard.press('Escape'); await page.waitForTimeout(800); } catch (_) {}
  }
}

await closeOnboarding();

// ① 메인 화면
await page.screenshot({ path: `${OUT}/01_main.png` });
console.log('✓ 01_main.png');

// ② DOM 덤프 — 사이드바 결과 카드 구조 확인
const cardHtml = await page.evaluate(() => {
  const aside = document.querySelector('aside');
  if (!aside) return 'NO ASIDE';
  const items = aside.querySelectorAll('li[role="option"], li.cursor-pointer, [role="option"]');
  if (items.length > 0) return `FOUND ${items.length} items | first: ${items[0].tagName}.${[...items[0].classList].join('.')}`;
  return aside.innerHTML.slice(0, 600);
});
console.log('DOM 덤프:', cardHtml);

// ③ 첫 번째 결과 카드 클릭 → VibeReport
let vibeClicked = false;
const cardSelectors = [
  'aside li[role="option"]',
  'aside li#result-0',
  'aside li.cursor-pointer',
  'aside [role="option"]',
];
for (const sel of cardSelectors) {
  try {
    const el = page.locator(sel).first();
    await el.waitFor({ timeout: 2000 });
    await el.click();
    vibeClicked = true;
    console.log('✓ 카드 클릭:', sel);
    break;
  } catch (_) {}
}
await page.waitForTimeout(2000);
await page.screenshot({ path: `${OUT}/02_vibe_report.png` });
console.log(`✓ 02_vibe_report.png (clicked: ${vibeClicked})`);

// ④ 사이드바만 크롭
try {
  await page.locator('aside').first().screenshot({ path: `${OUT}/02_sidebar_crop.png` });
  console.log('✓ 02_sidebar_crop.png');
} catch (e) { console.log('sidebar crop err:', e.message.slice(0, 60)); }

// ⑤ 뒤로가기 → 적합도(Suitability) 탭
try {
  const backBtn = page.locator('button').filter({ hasText: /목록|결과|Back|backTo/i }).first();
  await backBtn.click({ timeout: 2000 });
  await page.waitForTimeout(600);
  console.log('✓ 뒤로가기');
} catch (_) {}

// 적합도 탭 클릭
try {
  const suitTab = page.locator('button, [role="tab"]').filter({ hasText: /적합도|Suitability|입지/i }).first();
  await suitTab.waitFor({ timeout: 3000 });
  await suitTab.click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/03_suitability.png` });
  console.log('✓ 03_suitability.png');
} catch (e) { console.log('적합도 탭 err:', e.message.slice(0, 60)); }

// ⑥ 비교 탭 클릭
try {
  const cmpTab = page.locator('button, [role="tab"]').filter({ hasText: /비교|Compare/i }).first();
  await cmpTab.waitFor({ timeout: 3000 });
  await cmpTab.click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/04_compare.png` });
  console.log('✓ 04_compare.png');
} catch (e) { console.log('비교 탭 err:', e.message.slice(0, 60)); }

// ⑦ 검색 탭 → 검색어 입력 → 결과
try {
  const searchTab = page.locator('button, [role="tab"]').filter({ hasText: /검색|Search/i }).first();
  await searchTab.click({ timeout: 2000 });
  await page.waitForTimeout(600);
  const input = page.locator('input[type="text"], input[placeholder]').first();
  await input.fill('서울');
  await page.waitForTimeout(400);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/05_search_results.png` });
  console.log('✓ 05_search_results.png');
} catch (e) { console.log('검색 err:', e.message.slice(0, 60)); }

// ⑧ 설정 탭
try {
  const settingsTab = page.locator('button, [role="tab"]').filter({ hasText: /설정|Settings/i }).first();
  await settingsTab.click({ timeout: 2000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/06_settings.png` });
  console.log('✓ 06_settings.png');
} catch (e) { console.log('설정 err:', e.message.slice(0, 60)); }

await browser.close();
console.log(`\n✅ 모든 스크린샷 저장: ${OUT}`);
