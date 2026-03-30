import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

const OUT = '/tmp/eodi_screens';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setViewportSize({ width: 1400, height: 900 });

// Real mode (not preview) — connects to live engine
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(4000);

// Close onboarding if present
async function closeOnboarding() {
  for (const text of ['건너뛰기', 'Skip', '시작하기', 'Start', 'Get Started']) {
    try {
      const btn = page.locator('button').filter({ hasText: text }).first();
      await btn.waitFor({ timeout: 2000 });
      await btn.click();
      await page.waitForTimeout(1000);
      console.log(`  onboarding: clicked "${text}"`);
    } catch (_) {}
  }
  try { await page.keyboard.press('Escape'); await page.waitForTimeout(500); } catch (_) {}
}
await closeOnboarding();

// 01. Initial landing page
await page.screenshot({ path: `${OUT}/01_landing.png` });
console.log('01_landing.png');

// 02. Navigate to UAE (Dubai area) where we have data
// Use the country selector if available, or search
try {
  // Try clicking on the country dropdown/selector
  const countryBtn = page.locator('button, [role="combobox"], select').filter({ hasText: /country|국가|나라/i }).first();
  await countryBtn.click({ timeout: 2000 });
  await page.waitForTimeout(500);
  const uaeOption = page.locator('li, option, [role="option"]').filter({ hasText: /AE|UAE|United Arab/i }).first();
  await uaeOption.click({ timeout: 2000 });
  await page.waitForTimeout(2000);
  console.log('  navigated via country selector');
} catch (_) {
  // Fallback: search for Dubai
  try {
    const input = page.locator('input[type="text"], input[type="search"], input[placeholder]').first();
    await input.click();
    await page.waitForTimeout(300);
    await input.fill('Dubai');
    await page.waitForTimeout(500);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(3000);
    console.log('  searched for Dubai');
  } catch (e) {
    console.log('  search fallback err:', e.message.slice(0, 60));
  }
}

await page.screenshot({ path: `${OUT}/02_after_search.png` });
console.log('02_after_search.png');

// 03. Try clicking a result card to see VibeReport
try {
  const selectors = [
    'aside li[role="option"]',
    'aside li#result-0',
    'aside li.cursor-pointer',
    '[role="option"]',
    'aside li',
  ];
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      await el.waitFor({ timeout: 1500 });
      await el.click();
      console.log(`  clicked result: ${sel}`);
      break;
    } catch (_) {}
  }
  await page.waitForTimeout(2500);
} catch (_) {}
await page.screenshot({ path: `${OUT}/03_vibe_detail.png` });
console.log('03_vibe_detail.png');

// 04. Sidebar crop
try {
  await page.locator('aside').first().screenshot({ path: `${OUT}/04_sidebar.png` });
  console.log('04_sidebar.png');
} catch (e) { console.log('sidebar crop err:', e.message.slice(0, 60)); }

// 05. Try different tabs/modes
const tabs = [
  { name: 'suitability', patterns: ['적합도', 'Suitability', '입지'] },
  { name: 'compare', patterns: ['비교', 'Compare'] },
];
for (const tab of tabs) {
  try {
    for (const pattern of tab.patterns) {
      try {
        const tabEl = page.locator('button, [role="tab"]').filter({ hasText: new RegExp(pattern, 'i') }).first();
        await tabEl.waitFor({ timeout: 1500 });
        await tabEl.click();
        await page.waitForTimeout(1500);
        console.log(`  clicked tab: ${pattern}`);
        break;
      } catch (_) {}
    }
    await page.screenshot({ path: `${OUT}/05_${tab.name}.png` });
    console.log(`05_${tab.name}.png`);
  } catch (e) { console.log(`${tab.name} err:`, e.message.slice(0, 60)); }
}

// 06. Go back to explore mode and zoom into hexagons
try {
  const exploreTab = page.locator('button, [role="tab"]').filter({ hasText: /탐색|Explore|동네/i }).first();
  await exploreTab.click({ timeout: 2000 });
  await page.waitForTimeout(1000);
} catch (_) {}

await page.screenshot({ path: `${OUT}/06_explore.png` });
console.log('06_explore.png');

// 07. Check tooltip/hover on a hexagon if visible
try {
  // Find a hexagon element or canvas and hover
  const canvas = page.locator('canvas').first();
  await canvas.hover({ position: { x: 700, y: 450 } });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/07_hover.png` });
  console.log('07_hover.png');
} catch (e) { console.log('hover err:', e.message.slice(0, 60)); }

// 08. Mobile viewport
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/08_mobile.png` });
console.log('08_mobile.png');

// 09. Tablet viewport
await page.setViewportSize({ width: 768, height: 1024 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/09_tablet.png` });
console.log('09_tablet.png');

// Reset to desktop
await page.setViewportSize({ width: 1400, height: 900 });
await page.waitForTimeout(1000);

// 10. Dark mode full page
await page.screenshot({ path: `${OUT}/10_final_desktop.png`, fullPage: false });
console.log('10_final_desktop.png');

await browser.close();
console.log(`\nAll screenshots saved to ${OUT}`);
