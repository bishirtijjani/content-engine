// tools/diagram-gallery.mjs — render every diagram layout, both orientations.
//
//   npm run gallery
//
// Writes data/gallery/index.html plus one standalone page per layout/orientation.
// Neutral placeholder copy only: this is the design catalog, never item content.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, '..');
const REPO = path.resolve(PKG_ROOT, '..', '..');

const { loadStyle } = await import(path.join(PKG_ROOT, 'src', 'style.mjs'));
const { composeSnapshotHTML } = await import(path.join(PKG_ROOT, 'src', 'composition', 'snapshot.mjs'));
const { listLayouts } = await import(path.join(PKG_ROOT, 'src', 'diagrams', 'registry.mjs'));
const { compileDiagram } = await import(path.join(PKG_ROOT, 'src', 'diagrams', 'compile.mjs'));

const style = loadStyle();
const OUT = path.join(REPO, 'data', 'gallery');
const DIR = path.join(OUT, 'diagrams');
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

import { SAMPLES } from './diagram-samples.mjs';

const layouts = listLayouts();
const written = [];
for (const layout of layouts) {
  const spec = SAMPLES[layout.name];
  if (!spec) {
    console.warn(`no sample for layout "${layout.name}" — skipped`);
    continue;
  }
  const slots = compileDiagram({ name: layout.name, spec, style, orientation: 'portrait' }).slots;
  for (const orientation of ['portrait', 'landscape']) {
    const width = orientation === 'portrait' ? 1080 : 1920;
    const height = orientation === 'portrait' ? 1920 : 1080;
    const html = composeSnapshotHTML({
      snapshot: { id: `${layout.name}-${orientation}`, diagram: { name: layout.name, spec }, composition: {} },
      style, width, height, orientation,
    });
    const file = `${layout.name}-${orientation}.html`;
    fs.writeFileSync(path.join(DIR, file), html);
    written.push({ name: layout.name, orientation, file, slots, what: layout.what, fields: layout.fields });
  }
}

const scaleP = 0.25;
const pw = Math.round(1080 * scaleP);
const ph = Math.round(1920 * scaleP);
const lw = Math.round(1920 * scaleP);
const lh = Math.round(1080 * scaleP);
const byName = new Map();
for (const w of written) {
  if (!byName.has(w.name)) byName.set(w.name, { name: w.name, what: w.what, fields: w.fields, slots: w.slots, files: {} });
  byName.get(w.name).files[w.orientation] = w.file;
}

const sections = [...byName.values()].map((s) => `
  <section class="layout">
    <div class="head">
      <h2>${s.name}</h2>
      <p>${s.what}</p>
      <div class="fields">${s.fields.map((f) => `<code>${f}</code>`).join('')}</div>
      <div class="slots">${s.slots.map((x) => `<code>${x}</code>`).join('')}</div>
    </div>
    <div class="shots">
      <figure>
        <div class="shot" style="width:${pw}px;height:${ph}px">
          <iframe src="diagrams/${s.files.portrait}" width="1080" height="1920"></iframe>
        </div>
        <figcaption>portrait · 1080×1920</figcaption>
      </figure>
      <figure>
        <div class="shot" style="width:${lw}px;height:${lh}px">
          <iframe src="diagrams/${s.files.landscape}" width="1920" height="1080"></iframe>
        </div>
        <figcaption>landscape · 1920×1080</figcaption>
      </figure>
    </div>
  </section>`).join('');

const index = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>content-os — diagram catalog</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@600;700;800;900&family=Plus+Jakarta+Sans:wght@500;600;700;800&family=JetBrains+Mono:wght@500;600;700;800&display=swap" rel="stylesheet">
<style>
:root{
  --brand-blue:#0f4c81;--brand-orange:#EA580C;--brand-surface:#F59E0B;--brand-text:#FFFFFF;
  --brand-display:'Montserrat',system-ui,sans-serif;--brand-body:'Plus Jakarta Sans',system-ui,sans-serif;--brand-mono:'JetBrains Mono',ui-monospace,monospace;
  --bg:#0b1220;--panel:#111c2e;--line:rgba(255,255,255,.10);--dim:#9fb0c7;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:#e8eef7;font-family:var(--brand-body);line-height:1.5}
a{color:#7fc4ff;text-decoration:none}
.wrap{max-width:1180px;margin:0 auto;padding:44px 24px 96px}
.kicker{font:800 12px/1 var(--brand-body);letter-spacing:.22em;text-transform:uppercase;color:var(--brand-surface);margin:0 0 14px}
h1{font:900 42px/1.05 var(--brand-display);letter-spacing:-.03em;margin:0 0 12px}
h2{font:900 22px/1.2 var(--brand-display);margin:0;text-transform:capitalize}
p{margin:0;color:var(--dim);font-size:14px}
header{border-bottom:1px solid var(--line);padding-bottom:26px}
.lead{max-width:780px;font-size:16px}
.layout{display:flex;gap:28px;align-items:flex-start;padding:34px 0;border-bottom:1px solid var(--line);flex-wrap:wrap}
.head{flex:1;min-width:260px}
.fields,.slots{display:flex;flex-wrap:wrap;gap:5px;margin-top:10px}
.fields code{font:600 10.5px var(--brand-mono);color:var(--brand-surface);background:rgba(245,158,11,.12);padding:2px 6px;border-radius:6px}
.slots code{font:500 10.5px var(--brand-mono);color:#cdd9e8;background:rgba(255,255,255,.07);border:1px solid var(--line);padding:2px 6px;border-radius:6px}
.shots{display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap}
figure{margin:0}
.shot{overflow:hidden;border-radius:12px;background:var(--brand-orange);border:1px solid var(--line)}
.shot iframe{border:0;transform:scale(${scaleP});transform-origin:0 0;display:block}
figcaption{font:600 10.5px var(--brand-mono);color:var(--dim);margin-top:7px}
footer{margin-top:44px;font-size:12.5px;color:var(--dim)}
</style></head>
<body><div class="wrap">
<header>
  <p class="kicker">content-os · diagram catalog</p>
  <h1>The diagram system, in your brand</h1>
  <p class="lead">Every layout compiled by the native diagram layer to the same scene-graph the video pipeline renders. Neutral placeholder copy only. Colours, fonts, radii and the safe box come from <code>config/style.json</code> — nothing here overrides the brand.</p>
</header>
${sections}
<footer>${layouts.length} layouts · portrait + landscape · generated by <code>npm run gallery</code></footer>
</div></body></html>`;

fs.writeFileSync(path.join(OUT, 'index.html'), index);
console.log(`wrote ${path.join(OUT, 'index.html')} (${layouts.length} layouts, ${written.length} pages)`);
