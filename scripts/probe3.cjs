/* Track per-particle position across frames during drag. Detect:
 *  - "teleports": particle cx/cy jumps > THRESH px in one frame
 *  - "vanish-midway": particle disappears (display=none) while not near
 *    any node centroid (i.e., not at edge endpoint).
 */
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await ctx.newPage();

  // Tag particles with stable id, hook setAttribute to record trails.
  await page.addInitScript(() => {
    window.__trails = new Map();
    window.__events = [];
    const origAppend = SVGGElement.prototype.appendChild;
    SVGGElement.prototype.appendChild = function (child) {
      const r = origAppend.call(this, child);
      if (this.classList && this.classList.contains('particles') && child.tagName === 'circle') {
        const id = `p${window.__events.length}_${Date.now()}`;
        child.setAttribute('data-pid', id);
      }
      return r;
    };
    const origSet = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (k, v) {
      origSet.call(this, k, v);
      if (this.tagName === 'circle' && this.getAttribute('data-pid')) {
        const pid = this.getAttribute('data-pid');
        if (k === 'cx' || k === 'cy' || k === 'display') {
          if (!window.__trails.has(pid)) window.__trails.set(pid, []);
          window.__trails.get(pid).push({
            t: performance.now(), k, v, cx: this.getAttribute('cx'),
            cy: this.getAttribute('cy'), display: this.getAttribute('display'),
          });
        }
      }
    };
  });

  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.waitForSelector('g.node[data-id]');

  // Get node centroids in SVG coords.
  const centroids = await page.evaluate(() => {
    const out = {};
    document.querySelectorAll('g.node[data-id]').forEach((g) => {
      const rect = g.querySelector('rect');
      const x = +rect.getAttribute('x'), y = +rect.getAttribute('y');
      const w = +rect.getAttribute('width'), h = +rect.getAttribute('height');
      out[g.getAttribute('data-id')] = { x: x + w/2, y: y + h/2, w, h };
    });
    return out;
  });

  // Reset trails right before drag.
  await page.evaluate(() => { window.__trails = new Map(); });

  // Drag airflow in a wide path.
  const node = await page.$('g.node[data-id="airflow"] rect');
  const box = await node.boundingBox();
  const cx0 = box.x + box.width / 2, cy0 = box.y + box.height / 2;
  await page.mouse.move(cx0, cy0);
  await page.mouse.down();
  for (let i = 0; i < 30; i++) {
    await page.mouse.move(cx0 + Math.cos(i * 0.4) * 100, cy0 + Math.sin(i * 0.4) * 60, { steps: 6 });
    await page.waitForTimeout(40);
  }
  await page.mouse.up();
  await page.waitForTimeout(500);

  // Read trails.
  const trails = await page.evaluate(() => {
    const out = {};
    for (const [pid, arr] of window.__trails.entries()) out[pid] = arr;
    return out;
  });

  // Analyze: per particle, find biggest single-frame jump and detect vanishes.
  let analyzed = 0;
  let teleports = 0;
  let midVanish = 0;
  const JUMP_THRESH = 60; // SVG units
  const examples = [];
  for (const [pid, arr] of Object.entries(trails)) {
    analyzed++;
    let lastCx = null, lastCy = null, lastT = 0;
    for (const ev of arr) {
      const cx = ev.cx ? +ev.cx : null;
      const cy = ev.cy ? +ev.cy : null;
      if (ev.k === 'display' && ev.v === 'none') {
        // Check if last known pos is near any node centroid (=> normal end of flight)
        let nearNode = false;
        for (const c of Object.values(centroids)) {
          if (lastCx != null && Math.hypot(cx ? cx - c.x : lastCx - c.x,
                                            cy ? cy - c.y : lastCy - c.y) < Math.max(c.w, c.h)) {
            nearNode = true; break;
          }
        }
        if (!nearNode) {
          midVanish++;
          if (examples.length < 5) examples.push({ pid, type: 'vanish', cx: lastCx, cy: lastCy });
        }
      }
      if (cx != null && cy != null && lastCx != null && lastCy != null) {
        const dt = ev.t - lastT;
        const dist = Math.hypot(cx - lastCx, cy - lastCy);
        if (dt < 50 && dist > JUMP_THRESH) {
          teleports++;
          if (examples.length < 10) examples.push({ pid, type: 'teleport', from: [lastCx, lastCy], to: [cx, cy], dt: dt.toFixed(0), dist: dist.toFixed(0) });
        }
      }
      if (cx != null) lastCx = cx;
      if (cy != null) lastCy = cy;
      lastT = ev.t;
    }
  }

  console.log(`particles seen: ${analyzed}`);
  console.log(`teleports (>${JUMP_THRESH}px in <50ms): ${teleports}`);
  console.log(`mid-edge vanishes: ${midVanish}`);
  console.log('examples:');
  for (const e of examples) console.log(' ', JSON.stringify(e));

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
