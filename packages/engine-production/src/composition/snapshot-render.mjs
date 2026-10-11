// composition/snapshot-render.mjs — render snapshot completed compositions to stills.
//
// The plan step: every snapshot's finished composition is rendered to a PNG so
// the look can be judged before any motion or video is built. Also builds a
// snapshot grid (one grid image of all stills) for the at-a-glance view.
import fs from 'node:fs';
import path from 'node:path';
import { composeSnapshotHTML } from './snapshot.mjs';

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.HYPERFRAMES_BROWSER_PATH,
    '/root/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',
  ];
  return candidates.find((p) => p && fs.existsSync(p));
}

async function openBrowser() {
  const puppeteer = (await import('puppeteer-core')).default;
  const chrome = findChrome();
  if (!chrome) throw new Error('no Chrome found — set CHROME_PATH');
  return puppeteer.launch({
    executablePath: chrome, headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--force-color-profile=srgb', '--hide-scrollbars'],
  });
}

/** Render each snapshot's completed composition to {outDir}/<id>.png. */
export async function renderSnapshotStills({ snapshots, style, outDir, htmlDir = null, width = 1080, height = 1920, orientation = 'portrait' }) {
  fs.mkdirSync(outDir, { recursive: true });
  if (htmlDir) fs.mkdirSync(htmlDir, { recursive: true });
  const browser = await openBrowser();
  const results = [];
  try {
    for (const snapshot of snapshots) {
      const html = composeSnapshotHTML({ snapshot, style, width, height, orientation });
      let htmlPath = null;
      if (htmlDir) {
        htmlPath = path.join(htmlDir, `${snapshot.id}.html`);
        fs.writeFileSync(htmlPath, html);
      }
      const page = await browser.newPage();
      await page.setViewport({ width, height, deviceScaleFactor: 1 });
      if (htmlPath) {
        await page.goto('file://' + htmlPath, { waitUntil: 'networkidle0', timeout: 60000 });
      } else {
        await page.setContent(html, { waitUntil: 'networkidle0', timeout: 60000 });
      }
      await page.evaluate(() => document.fonts.ready);
      await new Promise((r) => setTimeout(r, 200));
      const fit = await page.evaluate(() => {
        const stage = document.querySelector('.cx-stage').getBoundingClientRect();
        // Every descendant must stay inside the safe box — the whole content, not
        // just the top-level blocks (a padded card used to spill past the box).
        const descendants = [...document.querySelectorAll('.cx-stage *')].map((el) => el.getBoundingClientRect());
        const boxes = descendants.length ? descendants : [stage];
        const top = Math.min(...boxes.map((k) => k.top));
        const bottom = Math.max(...boxes.map((k) => k.bottom));
        const left = Math.min(...boxes.map((k) => k.left));
        const right = Math.max(...boxes.map((k) => k.right));
        const offenders = [...document.querySelectorAll('.cx-stage *')]
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.right > stage.right + 1 || r.left < stage.left - 1 || r.bottom > stage.bottom + 1 || r.top < stage.top - 1;
          })
          .slice(0, 5)
          .map((el) => ({ tag: el.tagName.toLowerCase(), slot: el.getAttribute('data-slot') || null }));
        return {
          vTop: Math.round(top), vBottom: Math.round(bottom), xLeft: Math.round(left), xRight: Math.round(right),
          boxTop: Math.round(stage.top), boxBottom: Math.round(stage.bottom), boxLeft: Math.round(stage.left), boxRight: Math.round(stage.right),
          offenders,
          fits: top >= stage.top - 1 && bottom <= stage.bottom + 1 && left >= stage.left - 1 && right <= stage.right + 1,
        };
      });
      const png = path.join(outDir, `${snapshot.id}.png`);
      await page.screenshot({ path: png });
      await page.close();
      results.push({ id: snapshot.id, path: png, fit });
    }
  } finally {
    await browser.close();
  }
  return results;
}

/** Build the snapshot grid (all stills tiled) as one PNG. */
export async function renderSnapshotGrid({ items, outPath, cols = 3, cellW = 360, cellH = 640 }) {
  const rows = Math.ceil(items.length / cols);
  const cells = items
    .map((it) => `<div class="cell"><img src="file://${it.path}"><div class="cap">${it.id}</div></div>`)
    .join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{width:${cols * cellW}px;height:${rows * cellH}px;background:#111;display:grid;
      grid-template-columns:repeat(${cols},${cellW}px);grid-auto-rows:${cellH}px}
    .cell{position:relative;overflow:hidden}
    .cell img{width:100%;height:100%;object-fit:cover;display:block}
    .cap{position:absolute;left:8px;bottom:8px;font:700 18px system-ui;color:#fff;
      background:rgba(0,0,0,.55);padding:3px 10px;border-radius:6px}
  </style></head><body>${cells}</body></html>`;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  // Write a real file so file:// images load (setContent blocks file subresources).
  const htmlPath = outPath.replace(/\.png$/, '.html');
  fs.writeFileSync(htmlPath, html, 'utf8');
  const browser = await openBrowser();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: cols * cellW, height: rows * cellH, deviceScaleFactor: 1 });
    await page.goto('file://' + htmlPath, { waitUntil: 'networkidle0', timeout: 60000 });
    await page.evaluate(() => document.fonts.ready);
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({ path: outPath });
    await page.close();
  } finally {
    await browser.close();
  }
  return outPath;
}
