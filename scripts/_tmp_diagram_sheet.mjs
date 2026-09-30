// _tmp_diagram_sheet.mjs — one composition that lays every diagram type on its
// own row, all rendered at once, so a single snapshot shows them all.
import { writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderDiagram } from '../packages/engine-production/src/diagrams/render.mjs';
import { deriveTheme } from '../packages/engine-production/src/diagrams/theme.mjs';
import { DIAGRAM_CSS } from '../packages/engine-production/src/diagrams/render.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(ROOT, 'data', 'compositions', 'dg-sheet');
mkdirSync(dir, { recursive: true });

const theme = deriveTheme();
const tileW = 900;
const tileH = 620;
const gap = 24;
const cols = 3;

const specs = {
  flow: { title: 'Flow', steps: [{ label: 'Lead', icon: 'user' }, { label: 'CRM', icon: 'database' }, { label: 'Email', icon: 'send' }] },
  pipeline: { title: 'Pipeline', steps: [{ label: 'Idea', icon: 'bolt' }, { label: 'Script', icon: 'doc' }, { label: 'Record', icon: 'chat' }, { label: 'Publish', icon: 'send' }], progress: 2 },
  cycle: { title: 'Cycle', center: 'Growth', steps: [{ label: 'Attract', icon: 'user' }, { label: 'Convert', icon: 'chart' }, { label: 'Serve', icon: 'check' }, { label: 'Retain', icon: 'chat' }] },
  timeline: { title: 'Timeline', events: [{ label: 'Founded', when: '2020', icon: 'bolt' }, { label: 'First client', when: '2023', icon: 'user' }, { label: 'Launch', when: '2026', icon: 'send' }], active: 2 },
  'before-after': { title: 'Before / After', before: { label: 'Manual', icon: 'user', points: ['Copy by hand', 'Slow'] }, after: { label: 'Automated', icon: 'bolt', points: ['Runs itself', 'Instant'] } },
  comparison: { title: 'Comparison', columns: [{ label: 'Off-the-shelf', icon: 'database', points: ['Rigid', 'Fees'] }, { label: 'Custom', icon: 'code', points: ['Exact fit', 'You own it'] }], highlight: 1 },
  decision: { title: 'Decision Tree', question: 'Qualified?', yes: { label: 'Book a call', icon: 'check' }, no: { label: 'Nurture', icon: 'chat' }, yesLabel: 'Yes', noLabel: 'No' },
  hierarchy: { title: 'Hierarchy', root: { label: 'Company', icon: 'database' }, levels: [[{ label: 'Product', icon: 'code' }, { label: 'Sales', icon: 'user' }], [{ label: 'Design', icon: 'gear' }, { label: 'Build', icon: 'code' }, { label: 'Growth', icon: 'chart' }]] },
  architecture: { title: 'Architecture', nodes: [{ id: 'app', label: 'Mobile App', icon: 'user' }, { id: 'api', label: 'API', icon: 'code', tone: 'accent' }, { id: 'db', label: 'Database', icon: 'database' }, { id: 'pay', label: 'Payments', icon: 'chart' }, { id: 'notif', label: 'Notifications', icon: 'chat' }], links: [{ from: 'app', to: 'api' }, { from: 'api', to: 'db' }, { from: 'api', to: 'pay' }, { from: 'api', to: 'notif' }] },
  relationship: { title: 'Relationship', nodes: [{ id: 'cust', label: 'Customer', icon: 'user' }, { id: 'merch', label: 'Merchant', icon: 'database' }, { id: 'rider', label: 'Rider', icon: 'bolt' }, { id: 'admin', label: 'Admin', icon: 'gear' }, { id: 'pay', label: 'Payment', icon: 'chart' }], links: [{ from: 'cust', to: 'merch' }, { from: 'merch', to: 'rider' }, { from: 'admin', to: 'merch' }, { from: 'pay', to: 'merch' }] },
  layers: { title: 'Layers', layers: [{ label: 'Interface', icon: 'user', points: ['Web'] }, { label: 'API', icon: 'code' }, { label: 'Business Logic', icon: 'gear' }, { label: 'Database', icon: 'database' }] },
  funnel: { title: 'Funnel', stages: [{ label: 'Visitors', value: '1,000', icon: 'user' }, { label: 'Leads', value: '100', icon: 'chat' }, { label: 'Customers', value: '20', icon: 'check' }] },
};

const names = Object.keys(specs);
const sheetW = cols * tileW + (cols + 1) * gap;
const rows = Math.ceil(names.length / cols);
const sheetH = rows * tileH + (rows + 1) * gap;

let tiles = '';
let js = '';
names.forEach((name, i) => {
  const col = i % cols;
  const row = Math.floor(i / cols);
  const ox = gap + col * (tileW + gap);
  const oy = gap + row * (tileH + gap);
  const r = renderDiagram({ name, spec: specs[name], box: { w: tileW, h: tileH }, ovId: `t${i}`, theme, timing: { start: 0, dur: 9 } });
  if (!r) { console.log(`SKIP ${name}`); return; }
  // Wrap the diagram's own <svg> in a tile-sized <svg> placed at x/y with
  // explicit dimensions, so `.dg-svg{width:100%;height:100%}` fills only the tile.
  const inner = r.svg.replace('<svg ', '<svg x="0" y="0" width="' + tileW + '" height="' + tileH + '" ');
  tiles += `  <svg x="${ox}" y="${oy}" width="${tileW}" height="${tileH}" viewBox="0 0 ${tileW} ${tileH}"><rect class="tile" x="0" y="0" width="${tileW}" height="${tileH}" rx="20"/>${inner}</svg>\n`;
  // offset this tile's timeline positions by its slot is complex; instead every
  // tile owns its own paused timeline under a unique key and the sheet plays a
  // master line per tile. Simpler: tag each tile's lines to a per-tile timeline.
  js += `// tile ${i} ${name}\n` + r.js.join('\n') + '\n';
});
void gap; void sheetH;

const html = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8" />
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<style>
:root{--u:1;--brand-blue:#0f4c81;--brand-orange:#EA580C;--brand-text:#FFFFFF;--brand-display:'Montserrat',system-ui,sans-serif;--brand-body:'Plus Jakarta Sans',system-ui,sans-serif;}
body{margin:0;background:#EA580C;}
#root{position:relative;width:${sheetW}px;height:${sheetH}px;overflow:hidden;background:#EA580C;}
.tile{fill:#C94A08;fill-opacity:.35;}
${DIAGRAM_CSS}
</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-width="${sheetW}" data-height="${sheetH}" data-fps="24" data-duration="9">
<svg viewBox="0 0 ${sheetW} ${sheetH}" width="${sheetW}" height="${sheetH}">
${tiles}
</svg>
</div>
<script>
window.__timelines = window.__timelines || {};
const tl = gsap.timeline({ paused: true });
${js}
window.__timelines["main"] = tl;
</script></body></html>
`;

writeFileSync(path.join(dir, 'index.html'), html, 'utf8');
console.log(`sheet ${sheetW}x${sheetH} -> ${dir}`);
if (existsSync(path.join(ROOT, 'data', 'renders', 'sample-src.mp4'))) {
  // no video needed; static screenshot canvas
}
