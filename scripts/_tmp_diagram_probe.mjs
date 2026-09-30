import { listDiagrams, getLayout } from '../packages/engine-production/src/diagrams/registry.mjs';
import { renderDiagram } from '../packages/engine-production/src/diagrams/render.mjs';
import { deriveTheme } from '../packages/engine-production/src/diagrams/theme.mjs';

const THEME = deriveTheme();
const LAND = { w: 1690, h: 616 };
const PORT = { w: 950, h: 1094 };

const specs = {
  flow: { title: 'The loop', steps: [{ label: 'Lead', icon: 'user' }, { label: 'Send', icon: 'send' }, { label: 'Log', icon: 'check' }] },
  pipeline: { title: 'The path', steps: [{ label: 'Idea', icon: 'bolt' }, { label: 'Script', icon: 'doc' }, { label: 'Record', icon: 'chat' }, { label: 'Edit', icon: 'code' }, { label: 'Publish', icon: 'send' }] },
  cycle: { title: 'The loop', center: 'Growth', steps: [{ label: 'Attract', icon: 'user' }, { label: 'Convert', icon: 'chart' }, { label: 'Serve', icon: 'check' }, { label: 'Retain', icon: 'chat' }] },
  timeline: { title: 'The road', events: [{ label: 'Founded', when: '2020', icon: 'bolt' }, { label: 'First client', when: '2023', icon: 'user' }, { label: 'Product launch', when: '2026', icon: 'send' }] },
  'before-after': { title: 'The change', before: { label: 'Manual', icon: 'user', points: ['Copy by hand', 'Slow', 'Error prone'] }, after: { label: 'Automated', icon: 'bolt', points: ['Runs itself', 'Instant', 'Reliable'] } },
  comparison: { title: 'Which one', columns: [{ label: 'Traditional', icon: 'database', points: ['Rigid', 'Slow to change'] }, { label: 'Custom', icon: 'code', points: ['Fits exactly', 'Fast to change'], }], highlight: 1 },
  decision: { title: 'The branch', question: 'Qualified?', yes: { label: 'Book call', icon: 'check' }, no: { label: 'Nurture', icon: 'chat' }, yesLabel: 'Yes', noLabel: 'No' },
  hierarchy: { title: 'The org', root: { label: 'Company', icon: 'database' }, levels: [[{ label: 'Product', icon: 'code' }, { label: 'Sales', icon: 'user' }], [{ label: 'Design', icon: 'gear' }, { label: 'Build', icon: 'code' }, { label: 'Leads', icon: 'chart' }]] },
  architecture: { title: 'The system', nodes: [{ id: 'app', label: 'Mobile App', icon: 'user' }, { id: 'api', label: 'API', icon: 'code', tone: 'accent' }, { id: 'db', label: 'Database', icon: 'database' }, { id: 'pay', label: 'Payment', icon: 'chart' }, { id: 'notif', label: 'Notifications', icon: 'chat' }], links: [{ from: 'app', to: 'api' }, { from: 'api', to: 'db' }, { from: 'api', to: 'pay' }, { from: 'api', to: 'notif' }] },
  relationship: { title: 'Who talks', nodes: [{ id: 'cust', label: 'Customer', icon: 'user' }, { id: 'merch', label: 'Merchant', icon: 'database' }, { id: 'rider', label: 'Rider', icon: 'bolt' }, { id: 'admin', label: 'Admin', icon: 'gear' }, { id: 'pay', label: 'Payment', icon: 'chart' }], links: [{ from: 'cust', to: 'merch' }, { from: 'merch', to: 'rider' }, { from: 'admin', to: 'merch' }, { from: 'pay', to: 'merch' }] },
  layers: { title: 'The stack', layers: [{ label: 'UI', icon: 'user', points: ['Web', 'App'] }, { label: 'API', icon: 'code' }, { label: 'Business Logic', icon: 'gear' }, { label: 'Database', icon: 'database' }] },
  funnel: { title: 'The funnel', stages: [{ label: 'Visitors', value: '1,000', icon: 'user' }, { label: 'Leads', value: '100', icon: 'chat' }, { label: 'Customers', value: '20', icon: 'check' }] },
};

let fail = 0;
for (const d of listDiagrams()) {
  const spec = specs[d.name];
  try {
    const land = renderDiagram({ name: d.name, spec, box: LAND, ovId: 'ov-1', theme: THEME, timing: { start: 5, dur: 8 } });
    const port = renderDiagram({ name: d.name, spec, box: PORT, ovId: 'ov-1', theme: THEME, timing: { start: 5, dur: 8 } });
    if (!land || !port) { console.log(`FAIL ${d.name}: render null`); fail++; continue; }
    const errs = [];
    if (!land.svg.includes('<svg')) errs.push('no svg');
    if (land.svg !== renderDiagram({ name: d.name, spec, box: LAND, ovId: 'ov-1', theme: THEME, timing: { start: 5, dur: 8 } }).svg) errs.push('nondeterministic');
    if (!land.js.length) errs.push('no js');
    console.log(`${errs.length ? 'FAIL' : 'ok  '} ${d.name.padEnd(14)} svg:${land.svg.length}b js:${land.js.length}ln ${errs.join(',')}`);
    if (errs.length) fail++;
  } catch (e) {
    console.log(`FAIL ${d.name}: ${e.stack.split('\n').slice(0,3).join(' | ')}`);
    fail++;
  }
}
console.log(fail ? `\n${fail} FAILURES` : '\nall layouts render');
