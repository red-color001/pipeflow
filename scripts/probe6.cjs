/* Visual proof: screenshot mid-drag. */
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await ctx.newPage();
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  const node = await page.$('g.node[data-id="airflow"] rect');
  const box = await node.boundingBox();
  const cx0 = box.x + box.width / 2, cy0 = box.y + box.height / 2;
  await page.mouse.move(cx0, cy0);
  await page.mouse.down();
  // Drag slowly to one direction, screenshot mid-way.
  await page.mouse.move(cx0 + 80, cy0 + 40, { steps: 20 });
  await page.screenshot({ path: 'scripts/mid-drag.png' });
  await page.mouse.move(cx0 + 160, cy0 + 80, { steps: 20 });
  await page.screenshot({ path: 'scripts/mid-drag2.png' });
  await page.mouse.up();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'scripts/after-drag.png' });

  // Particle count check
  const counts = await page.evaluate(() => {
    const all = document.querySelectorAll('g.particles > circle');
    const v = Array.from(all).filter((c) => c.getAttribute('display') !== 'none');
    return { total: all.length, visible: v.length };
  });
  console.log('particles:', counts);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
