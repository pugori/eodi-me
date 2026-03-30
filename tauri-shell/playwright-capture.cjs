const { chromium } = require('./node_modules/playwright');
const path = require('path');
const BASE = 'C:\\Users\\cha85\\Downloads\\eodi.me\\tauri-shell\\';
const URL = 'http://127.0.0.1:5173/?preview=1';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function newPage(browser) {
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    window.__TAURI_IPC__ = () => Promise.resolve(null);
    window.__TAURI__ = { invoke: () => Promise.resolve(null) };
    // Suppress WhatsNew modal (first-launch overlay)
    try { localStorage.setItem('eodi_whats_new_v2', '1'); } catch (_) {}
    // Suppress onboarding tour
    try { localStorage.setItem('eodi_onboarded_v1', '1'); } catch (_) {}
  });
  page.on('pageerror', e => {
    if (!e.message.includes('invoke') && !e.message.includes('IPC')) {
      console.error('PAGEERROR:', e.message.slice(0, 120));
    }
  });
  return page;
}

async function dismissOnboarding(page) {
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const skip = btns.find(b =>
      b.textContent?.includes('Skip') ||
      b.textContent?.includes('건너뛰기') ||
      b.textContent?.includes('Get Started') ||
      b.textContent?.includes('시작하기')
    );
    if (skip) skip.click();
  });
  await sleep(500);
}

async function load(page) {
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 25000 });
  await sleep(3500);
  await dismissOnboarding(page);
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });

  // ── 1. Browse mode (initial state) ───────────────────────────────────────
  {
    const page = await newPage(browser);
    await load(page);
    // Extra wait for MapLibre dark theme + tile rendering in headless Chrome.
    // map.once('load') applies paint properties AFTER network idle, then tiles
    // need another render cycle before canvas is non-black.
    await sleep(6000);
    await page.screenshot({ path: BASE + 'ss_01_browse.png', fullPage: false });
    console.log('✓ 01 Browse mode');
    await page.close();
  }

  // ── 2. Settings dialog ────────────────────────────────────────────────────
  {
    const page = await newPage(browser);
    await load(page);
    // aria-label="Open settings" (set in Sidebar.tsx)
    await page.evaluate(() => {
      const btn = document.querySelector('[aria-label="Open settings"]') ||
        Array.from(document.querySelectorAll('button')).find(b =>
          (b.getAttribute('aria-label') || '').toLowerCase().includes('setting') ||
          (b.getAttribute('aria-label') || '').toLowerCase().includes('설정')
        );
      if (btn) btn.click();
    });
    await sleep(1800);
    await page.screenshot({ path: BASE + 'ss_02_settings.png' });
    console.log('✓ 02 Settings dialog');
    await page.close();
  }

  // ── 3. Upgrade / License modal ────────────────────────────────────────────
  {
    const page = await newPage(browser);
    await load(page);
    // open settings
    await page.evaluate(() => {
      const btn = document.querySelector('[aria-label="Open settings"]') ||
        Array.from(document.querySelectorAll('button')).find(b =>
          (b.getAttribute('aria-label') || '').toLowerCase().includes('setting') ||
          (b.getAttribute('aria-label') || '').toLowerCase().includes('설정')
        );
      if (btn) btn.click();
    });
    await sleep(1800);
    // click Manage/Upgrade button inside the settings dialog
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const upgrade = btns.find(b => {
        const t = (b.textContent || '').trim();
        return t === '관리' || t === 'Manage' || t === '업그레이드' || t === 'Upgrade' ||
          t.startsWith('관리') || t.startsWith('Manage');
      });
      if (upgrade) upgrade.click();
    });
    await sleep(2500);
    await page.screenshot({ path: BASE + 'ss_03_license.png' });
    console.log('✓ 03 License/Upgrade modal');
    await page.close();
  }

  // ── 4. Search results (type Seoul, wait for listbox) ─────────────────────
  {
    const page = await newPage(browser);
    await load(page);

    const inputCount = await page.locator('input[type="search"]').count();
    console.log('  Search inputs found:', inputCount);

    if (inputCount > 0) {
      const searchInput = page.locator('input[type="search"]').first();
      await searchInput.click();
      await searchInput.fill('Seoul');
      await sleep(600);
      await page.keyboard.press('Enter');
      try {
        await page.waitForSelector('[role="listbox"], [role="option"], [data-result]', { state: 'visible', timeout: 12000 });
      } catch (_) { console.warn('  listbox timeout — engine offline (expected in preview mode)'); }
      await sleep(2000);
      await page.screenshot({ path: BASE + 'ss_04_search.png' });
      console.log('✓ 04 Search results');
    } else {
      await page.screenshot({ path: BASE + 'ss_04_search.png' });
      console.log('⚠ 04 Search — input not found, took fallback screenshot');
    }
    await page.close();
  }

  // ── 5. Analysis tab ───────────────────────────────────────────────────────
  {
    const page = await newPage(browser);
    await load(page);

    // In preview mode the first city is auto-selected; go back to list first
    await page.evaluate(() => {
      const backBtns = Array.from(document.querySelectorAll('button'));
      const back = backBtns.find(b => {
        const t = (b.textContent || '').trim();
        return t.includes('결과 목록') || t.includes('Back') || t.includes('목록으로');
      });
      if (back) back.click();
    });
    await sleep(600);

    // Now click the analysis tab
    await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('button, [role="tab"]'));
      const analysisTab = tabs.find(t => {
        const text = (t.textContent || '').trim();
        return text.includes('입지') || text.includes('분석') || text.includes('Analysis') || text.includes('Suitability');
      });
      if (analysisTab) {
        analysisTab.click();
      }
    });
    await sleep(1500);
    
    await page.screenshot({ path: BASE + 'ss_05_analysis.png' });
    console.log('✓ 05 Analysis tab');
    await page.close();
  }

  // ── 6. Color Legend close-up (clip bottom-right) ─────────────────────────
  {
    const page = await newPage(browser);
    await load(page);
    const legendBox = await page.locator('.color-legend').boundingBox();
    if (legendBox) {
      await page.screenshot({ path: BASE + 'ss_06_legend.png', clip: legendBox });
      console.log('✓ 06 ColorLegend clip');
    } else {
      await page.screenshot({ path: BASE + 'ss_06_legend.png' });
      console.log('⚠ 06 ColorLegend — element not found, full screenshot');
    }
    await page.close();
  }

  // ── 7. Compare Overlay (candidate list) ─────────────────────────────────
  {
    const page = await newPage(browser);
    await load(page);
    await sleep(2000);

    const clicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const compareBtn = btns.find(b => {
        const t = (b.textContent || '').trim();
        return t.includes('바이브 비교') || t.includes('Compare Vibes') || t.includes('Compare');
      });
      if (compareBtn) { compareBtn.click(); return true; }
      return false;
    });
    console.log('  Compare button clicked:', clicked);
    await sleep(2000);

    await page.screenshot({ path: BASE + 'ss_07_compare.png' });
    console.log('✓ 07 Compare Overlay (candidate list)');
    await page.close();
  }

  // ── 8. Compare result (side-by-side radar) ───────────────────────────────
  {
    const page = await newPage(browser);
    await load(page);
    await sleep(2000);

    // Open compare overlay
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = btns.find(b => (b.textContent || '').includes('바이브 비교') || (b.textContent || '').includes('Compare Vibes'));
      if (btn) btn.click();
    });
    await sleep(1500);

    // Click first candidate in the list (buttons with %-match text in the overlay)
    const picked = await page.evaluate(() => {
      // Find the candidates container (max-h list in the compare overlay)
      const allBtns = Array.from(document.querySelectorAll('button'));
      // Candidate buttons have a small vibe dot + city name + percentage
      // They appear in the scrollable candidate list — find ones with % text inside
      const candidateBtn = allBtns.find(b => {
        const t = (b.textContent || '');
        return (t.includes('%') && t.includes('매치') && b.className.includes('w-full'));
      });
      if (candidateBtn) { candidateBtn.click(); return candidateBtn.textContent.slice(0, 40); }
      // Fallback: try first w-full text-left button in the overlay that has % content
      const fallback = allBtns.find(b =>
        b.className.includes('w-full') && b.getAttribute('class')?.includes('text-left')
      );
      if (fallback) { fallback.click(); return fallback.textContent.slice(0, 40); }
      return null;
    });
    console.log('  Picked candidate:', picked);
    await sleep(2000);

    // Click confirm/select button if present
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const confirmBtn = btns.find(b => {
        const t = (b.textContent || '').trim();
        return t.includes('비교하기') || t.includes('Compare') || t.includes('선택');
      });
      if (confirmBtn) confirmBtn.click();
    });
    await sleep(2000);

    await page.screenshot({ path: BASE + 'ss_08_compare_result.png' });
    console.log('✓ 08 Compare result (side-by-side)');
    await page.close();
  }

  await browser.close();
  console.log('\nAll screenshots done!');
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });


