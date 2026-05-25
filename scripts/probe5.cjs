/* Snapshot every animation frame, track per-circle (cx, cy, display) across
 * frames. Detect intra-flight jumps. */
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await ctx.newPage();

  await page.addInitScript(() => {
    window.__snaps = [];
    function snap() {
      const arr = [];
      document.querySelectorAll('g.particles > circle').forEach((c, idx) => {
        arr.push({
          i: idx,
          cx: +c.getAttribute('cx') || 0,
          cy: +c.getAttribute('cy') || 0,
          d: c.getAttribute('display') || '',
        });
      });
      window.__snaps.push({ t: performance.now(), parts: arr });
      requestAnimationFrame(snap);
    }
    requestAnimationFrame(snap);
  });

  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.waitForSelector('g.node[data-id]');

  // Capture during drag.
  await page.evaluate(() => { window.__snaps = []; });
  const node = await page.$('g.node[data-id="airflow"] rect');
  const box = await node.boundingBox();
  const cx0 = box.x + box.width / 2, cy0 = box.y + box.height / 2;
  await page.mouse.move(cx0, cy0);
  await page.mouse.down();
  for (let i = 0; i < 25; i++) {
    await page.mouse.move(cx0 + Math.cos(i * 0.4) * 100, cy0 + Math.sin(i * 0.4) * 60, { steps: 6 });
    await page.waitForTimeout(50);
  }
  await page.mouse.up();
  await page.waitForTimeout(800);
  const snaps = await page.evaluate(() => window.__snaps);

  // For each particle index i, scan consecutive frames where d='' both,
  // detect cx/cy jumps.
  const N = snaps[0]?.parts.length ?? 0;
  let teleports = 0;
  const ex = [];
  for (let i = 0; i < N; i++) {
    for (let f = 1; f < snaps.length; f++) {
      const prev = snaps[f-1].parts[i];
      const cur = snaps[f].parts[i];
      if (!prev || !cur) continue;
      if (prev.d === 'none' || cur.d === 'none') continue;
      const dt = snaps[f].t - snaps[f-1].t;
      const dist = Math.hypot(cur.cx - prev.cx, cur.cy - prev.cy);
      if (dt < 50 && dist > 80) {
        teleports++;
        if (ex.length < 8) ex.push({ slot: i, frame: f, from: [prev.cx.toFixed(0), prev.cy.toFixed(0)], to: [cur.cx.toFixed(0), cur.cy.toFixed(0)], dt: dt.toFixed(0), dist: dist.toFixed(0) });
      }
    }
  }
  console.log(`frames captured: ${snaps.length}`);
  console.log(`particle slots: ${N}`);
  console.log(`intra-flight teleports (>80px, <50ms): ${teleports}`);
  ex.forEach((e) => console.log(' ', JSON.stringify(e)));

  // Also: detect "mid-edge vanish" — particle was clearly moving (cx/cy changed
  // > 0 frame over frame) then suddenly display='none' while not near edge end.
  const centroids = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('g.node[data-id]').forEach((g) => {
      const r = g.querySelector('rect');
      out.push({
        cx: +r.getAttribute('x') + +r.getAttribute('width') / 2,
        cy: +r.getAttribute('y') + +r.getAttribute('height') / 2,
        w: +r.getAttribute('width'), h: +r.getAttribute('height'),
      });
    });
    return out;
  });

  let vanishes = 0; const vex = [];
  for (let i = 0; i < N; i++) {
    for (let f = 1; f < snaps.length; f++) {
      const prev = snaps[f-1].parts[i];
      const cur = snaps[f].parts[i];
      if (!prev || !cur) continue;
      if (prev.d === '' && cur.d === 'none') {
        const near = centroids.some((c) => Math.hypot(prev.cx - c.cx, prev.cy - c.cy) < Math.max(c.w, c.h));
        if (!near) {
          vanishes++;
          if (vex.length < 8) vex.push({ slot: i, frame: f, at: [prev.cx.toFixed(0), prev.cy.toFixed(0)] });
        }
      }
    }
  }
  console.log(`\nmid-edge vanishes: ${vanishes}`);
  vex.forEach((e) => console.log(' ', JSON.stringify(e)));

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
