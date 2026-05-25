/* Verify React Flow migration: load page, screenshot, check console errors. */
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await ctx.newPage();

  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  const stats = await page.evaluate(() => {
    const rfNodes = document.querySelectorAll('.react-flow__node');
    const rfEdges = document.querySelectorAll('.react-flow__edge');
    const particles = document.querySelectorAll('g.particles circle, svg circle[r]');
    const minimap = document.querySelector('.react-flow__minimap');
    const controls = document.querySelector('.react-flow__controls');
    return {
      rfNodes: rfNodes.length,
      rfEdges: rfEdges.length,
      minimap: !!minimap,
      controls: !!controls,
      particles: particles.length,
    };
  });
  console.log('stats:', stats);
  console.log('errors:', errors.length);
  errors.slice(0, 8).forEach((e) => console.log('  ', e.slice(0, 200)));

  await page.screenshot({ path: 'scripts/rf-initial.png' });
  // Drag airflow
  const node = await page.$('.react-flow__node[data-id="airflow"]');
  if (node) {
    const box = await node.boundingBox();
    if (box) {
      const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx + 80, cy + 40, { steps: 30 });
      await page.screenshot({ path: 'scripts/rf-drag.png' });
      await page.mouse.up();
    }
  }
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'scripts/rf-after.png' });

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
