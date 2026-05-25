/* Playwright probe: open UI, observe dot animation while dragging a node,
 * report any particle resets/disappearances. */
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false, args: ['--start-maximized'] });
  const ctx = await browser.newContext({ viewport: null });
  const page = await ctx.newPage();

  const consoleMsgs = [];
  page.on('console', (m) => consoleMsgs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => consoleMsgs.push(`[pageerror] ${e.message}`));

  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
  // Allow socket + topology to load.
  await page.waitForTimeout(2000);

  // Wait until at least one node rendered.
  await page.waitForSelector('g.node[data-id]', { timeout: 10_000 });

  // Capture particle counts over time, before and during a node drag.
  const sample = () => page.evaluate(() => {
    const particles = document.querySelectorAll('g.particles > circle');
    const visible = Array.from(particles).filter((c) => c.getAttribute('display') !== 'none');
    return {
      total: particles.length,
      visible: visible.length,
      ids: visible.map((c) => `${c.getAttribute('cx')},${c.getAttribute('cy')}`),
    };
  });

  console.log('=== before drag ===');
  for (let i = 0; i < 5; i++) {
    const s = await sample();
    console.log(`t+${i*200}ms: total=${s.total} visible=${s.visible}`);
    await page.waitForTimeout(200);
  }

  // Drag the airflow node.
  const node = await page.$('g.node[data-id="airflow"] rect');
  if (!node) {
    console.log('airflow node not found');
    await browser.close();
    return;
  }
  const box = await node.boundingBox();
  if (!box) { console.log('no bbox'); await browser.close(); return; }
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  console.log(`\n=== dragging airflow from (${cx},${cy}) ===`);

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  // Sample particle count during drag movement
  for (let i = 0; i < 10; i++) {
    await page.mouse.move(cx + i * 12, cy + (i % 2 ? 8 : -8), { steps: 5 });
    const s = await sample();
    console.log(`drag step ${i}: visible=${s.visible}`);
    await page.waitForTimeout(150);
  }
  await page.mouse.up();

  console.log('\n=== after drag ===');
  for (let i = 0; i < 5; i++) {
    const s = await sample();
    console.log(`t+${i*200}ms: visible=${s.visible}`);
    await page.waitForTimeout(200);
  }

  // Screenshot for visual reference
  await page.screenshot({ path: 'scripts/probe.png', fullPage: false });
  console.log('\nscreenshot → scripts/probe.png');

  console.log('\n=== console output ===');
  consoleMsgs.slice(-20).forEach((m) => console.log(m));

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
