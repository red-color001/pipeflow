/* Record video while dragging airflow node. */
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    recordVideo: { dir: 'scripts/video', size: { width: 1600, height: 900 } },
  });
  const page = await ctx.newPage();

  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.waitForSelector('g.node[data-id]');

  // Click fit-to-content if available to make sure nodes visible
  // Drag the airflow node around in a wide arc.
  const node = await page.$('g.node[data-id="airflow"] rect');
  const box = await node.boundingBox();
  if (!box) { console.log('no bbox'); await browser.close(); return; }
  const cx0 = box.x + box.width / 2, cy0 = box.y + box.height / 2;

  await page.mouse.move(cx0, cy0);
  await page.mouse.down();
  // Slow drag to allow visual inspection.
  for (let i = 0; i < 60; i++) {
    const angle = i / 60 * Math.PI * 2;
    const tx = cx0 + Math.cos(angle) * 120;
    const ty = cy0 + Math.sin(angle) * 80;
    await page.mouse.move(tx, ty, { steps: 8 });
  }
  await page.mouse.up();
  await page.waitForTimeout(1500);

  // Now leave node alone, watch flow.
  await page.waitForTimeout(3000);

  await page.screenshot({ path: 'scripts/probe2.png', fullPage: false });
  await ctx.close();
  await browser.close();

  const vids = fs.readdirSync('scripts/video');
  console.log('video:', vids);
})().catch((e) => { console.error(e); process.exit(1); });
