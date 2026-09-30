// _tmp_diagram_samples.mjs — build 16:9 + 9:16 sample compositions for every
// diagram type, so each can be checked/rendered and visually inspected.
import { writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildComposition } from '../packages/engine-production/src/assemble.mjs';
import { loadStyle } from '../packages/engine-production/src/style.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'compositions');
const SRC = path.join(ROOT, 'data', 'renders', 'sample-src.mp4');
const style = loadStyle();
const duration = 9;

const specs = {
  flow: { title: 'How the loop works', steps: [{ label: 'Lead fills form', icon: 'user' }, { label: 'CRM captures', icon: 'database' }, { label: 'Email goes out', icon: 'send' }, { label: 'Follow-up logged', icon: 'check' }] },
  pipeline: { title: 'From idea to publish', steps: [{ label: 'Idea', icon: 'bolt' }, { label: 'Script', icon: 'doc' }, { label: 'Record', icon: 'chat' }, { label: 'Edit', icon: 'code' }, { label: 'Publish', icon: 'send' }], progress: 4 },
  cycle: { title: 'The growth loop', center: 'Growth', steps: [{ label: 'Attract', icon: 'user' }, { label: 'Convert', icon: 'chart' }, { label: 'Serve', icon: 'check' }, { label: 'Retain', icon: 'chat' }] },
  timeline: { title: 'How we got here', events: [{ label: 'Founded', when: '2020', icon: 'bolt' }, { label: 'First client', when: '2023', icon: 'user' }, { label: 'Product launch', when: '2026', icon: 'send' }], active: 2 },
  'before-after': { title: 'The transformation', before: { label: 'Manual', icon: 'user', points: ['Copy by hand', 'Slow and risky', 'Easy to forget'] }, after: { label: 'Automated', icon: 'bolt', points: ['Runs itself', 'Instant', 'Never misses'] } },
  comparison: { title: 'Two ways to build', columns: [{ label: 'Off-the-shelf', icon: 'database', points: ['Rigid', 'You adapt to it', 'Monthly fees'] }, { label: 'Custom system', icon: 'code', points: ['Fits exactly', 'It adapts to you', 'You own it'] }], highlight: 1 },
  decision: { title: 'Route the lead', question: 'Qualified?', yes: { label: 'Book a call', icon: 'check' }, no: { label: 'Nurture', icon: 'chat' }, yesLabel: 'Yes', noLabel: 'No' },
  hierarchy: { title: 'How the company runs', root: { label: 'Company', icon: 'database' }, levels: [[{ label: 'Product', icon: 'code' }, { label: 'Sales', icon: 'user' }], [{ label: 'Design', icon: 'gear' }, { label: 'Engineering', icon: 'code' }, { label: 'Growth', icon: 'chart' }]] },
  architecture: { title: 'The platform', nodes: [{ id: 'app', label: 'Mobile App', icon: 'user' }, { id: 'api', label: 'API', icon: 'code', tone: 'accent' }, { id: 'db', label: 'Database', icon: 'database' }, { id: 'pay', label: 'Payments', icon: 'chart' }, { id: 'notif', label: 'Notifications', icon: 'chat' }], links: [{ from: 'app', to: 'api', label: 'calls' }, { from: 'api', to: 'db', label: 'reads' }, { from: 'api', to: 'pay', label: 'charges' }, { from: 'api', to: 'notif', label: 'sends' }] },
  relationship: { title: 'Marketplace actors', nodes: [{ id: 'cust', label: 'Customer', icon: 'user' }, { id: 'merch', label: 'Merchant', icon: 'database' }, { id: 'rider', label: 'Rider', icon: 'bolt' }, { id: 'admin', label: 'Admin', icon: 'gear' }, { id: 'pay', label: 'Payment', icon: 'chart' }], links: [{ from: 'cust', to: 'merch', label: 'orders' }, { from: 'merch', to: 'rider', label: 'dispatch' }, { from: 'admin', to: 'merch', label: 'approves' }, { from: 'pay', to: 'merch', label: 'settles' }] },
  layers: { title: 'The stack', layers: [{ label: 'Interface', icon: 'user', points: ['Web', 'Mobile'] }, { label: 'API', icon: 'code' }, { label: 'Business Logic', icon: 'gear' }, { label: 'Database', icon: 'database' }] },
  funnel: { title: 'Where the numbers go', stages: [{ label: 'Visitors', value: '1,000', icon: 'user' }, { label: 'Leads', value: '100', icon: 'chat' }, { label: 'Customers', value: '20', icon: 'check' }] },
};

const builds = [
  { suffix: '16x9', width: 1280, height: 720 },
  { suffix: '9x16', width: 720, height: 1280 },
];

let count = 0;
for (const [name, spec] of Object.entries(specs)) {
  const plan = {
    captions: { emphasis: [] },
    overlays: [{ kind: 'diagram', name, why: `show the ${name}`, start: 0, end: duration, spec }],
    zooms: [], sfx: [],
  };
  for (const b of builds) {
    const dir = path.join(OUT, `dg-${name}-${b.suffix}`);
    mkdirSync(dir, { recursive: true });
    const { html, overlayCount } = buildComposition({
      words: [], videoSrc: 'source.mp4', width: b.width, height: b.height,
      duration, style, plan,
    });
    writeFileSync(path.join(dir, 'index.html'), html, 'utf8');
    if (existsSync(SRC)) copyFileSync(SRC, path.join(dir, 'source.mp4'));
    count += overlayCount;
    console.log(`dg-${name}-${b.suffix}: ${b.width}x${b.height} overlays=${overlayCount}`);
  }
}
console.log(`\n${count} compositions written`);
