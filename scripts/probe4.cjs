/* Refined: detect teleports ONLY within a single flight (continuous
 * display=''), so FREE pool reuse doesn't pollute. */
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await ctx.newPage();

  await page.addInitScript(() => {
    window.__events = [];
    const origSet = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (k, v) {
      origSet.call(this, k, v);
      if (this.tagName === 'circle' && this.parentNode?.classList?.contains('particles')) {
        if (k === 'cx' || k === 'cy' || k === 'display') {
          // Assign per-element node id once.
          if (!this.__nid) {
            this.__nid = window.__events.length || 1;
            // Actually need unique id. Use random.
            this.__nid = Math.random().toString(36).slice(2, 9);
          }
          window.__events.push({
            t: performance.now(),
            nid: this.__nid,
            k, v,
            cx: this.getAttribute('cx'),
            cy: this.getAttribute('cy'),
            display: this.getAttribute('display'),
          });
        }
      }
    };
  });

  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.waitForSelector('g.node[data-id]');

  // Clear events; let some flight happen WITHOUT drag.
  await page.evaluate(() => { window.__events = []; });
  await page.waitForTimeout(2000);
  const baseline = await page.evaluate(() => window.__events);

  // Now drag.
  await page.evaluate(() => { window.__events = []; });
  const node = await page.$('g.node[data-id="airflow"] rect');
  const box = await node.boundingBox();
  const cx0 = box.x + box.width / 2, cy0 = box.y + box.height / 2;
  await page.mouse.move(cx0, cy0);
  await page.mouse.down();
  for (let i = 0; i < 25; i++) {
    await page.mouse.move(cx0 + Math.cos(i * 0.4) * 100, cy0 + Math.sin(i * 0.4) * 60, { steps: 6 });
    await page.waitForTimeout(40);
  }
  await page.mouse.up();
  await page.waitForTimeout(400);
  const during = await page.evaluate(() => window.__events);

  function analyze(events, label) {
    // Group by nid into flights — split when display=none seen.
    const flights = new Map();
    const lastDisplay = new Map();
    for (const ev of events) {
      const nid = ev.nid;
      const prevDisplay = lastDisplay.get(nid);
      // Flight boundary: when display changes to none, or when display newly set to ''.
      if (ev.k === 'display') {
        if (ev.v === 'none') {
          lastDisplay.set(nid, 'none');
        } else {
          lastDisplay.set(nid, '');
          // start new flight
          if (!flights.has(nid)) flights.set(nid, []);
          flights.get(nid).push([]);
        }
        continue;
      }
      if (prevDisplay === 'none') continue; // ignore writes while hidden
      if (!flights.has(nid)) flights.set(nid, [[]]);
      const list = flights.get(nid);
      list[list.length - 1].push(ev);
    }

    let teleports = 0; const examples = [];
    for (const [nid, flightArr] of flights.entries()) {
      for (const flight of flightArr) {
        let lastCx = null, lastCy = null, lastT = 0;
        for (const ev of flight) {
          const cx = ev.cx ? +ev.cx : null, cy = ev.cy ? +ev.cy : null;
          if (lastCx != null && cx != null && cy != null && lastCy != null) {
            const dt = ev.t - lastT;
            const dist = Math.hypot(cx - lastCx, cy - lastCy);
            if (dt < 100 && dist > 50) {
              teleports++;
              if (examples.length < 8) examples.push({ nid, from: [lastCx.toFixed(0), lastCy.toFixed(0)], to: [cx.toFixed(0), cy.toFixed(0)], dt: dt.toFixed(0), dist: dist.toFixed(0) });
            }
          }
          if (cx != null) lastCx = cx;
          if (cy != null) lastCy = cy;
          lastT = ev.t;
        }
      }
    }
    console.log(`[${label}] flights=${[...flights.values()].reduce((s, a) => s + a.length, 0)} teleports=${teleports}`);
    examples.forEach((e) => console.log(' ', JSON.stringify(e)));
  }

  analyze(baseline, 'idle (no drag)');
  console.log();
  analyze(during, 'during drag');

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
