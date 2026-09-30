// Diagrams — the 11 shape-specific layouts, on top of Flow.
import test from 'node:test';
import assert from 'node:assert/strict';
import { getLayout, listDiagrams } from '../src/diagrams/registry.mjs';
import { renderDiagram, validateDiagram } from '../src/diagrams/render.mjs';
import { deriveTheme } from '../src/diagrams/theme.mjs';

const THEME = deriveTheme();
const LANDSCAPE = { w: 1690, h: 616 };
const PORTRAIT = { w: 950, h: 1094 };

const ALL = [
  'flow', 'pipeline', 'cycle', 'timeline', 'before-after', 'comparison',
  'decision', 'hierarchy', 'architecture', 'relationship', 'layers', 'funnel',
];

// one valid spec per layout, at the edge of the allowed counts
const SPECS = {
  flow: { title: 'The loop', steps: [{ label: 'Lead', icon: 'user' }, { label: 'Send', icon: 'send' }, { label: 'Log', icon: 'check' }] },
  pipeline: { title: 'The path', steps: [{ label: 'Idea', icon: 'bolt' }, { label: 'Script', icon: 'doc' }, { label: 'Record', icon: 'chat' }, { label: 'Edit', icon: 'code' }, { label: 'Publish', icon: 'send' }] },
  cycle: { title: 'The loop', center: 'Growth', steps: [{ label: 'Attract', icon: 'user' }, { label: 'Convert', icon: 'chart' }, { label: 'Serve', icon: 'check' }, { label: 'Retain', icon: 'chat' }] },
  timeline: { title: 'The road', events: [{ label: 'Founded', when: '2020', icon: 'bolt' }, { label: 'First client', when: '2023', icon: 'user' }, { label: 'Product launch', when: '2026', icon: 'send' }] },
  'before-after': { title: 'The change', before: { label: 'Manual', icon: 'user', points: ['Copy by hand', 'Slow'] }, after: { label: 'Automated', icon: 'bolt', points: ['Runs itself', 'Instant'] } },
  comparison: { title: 'Which one', columns: [{ label: 'Traditional', icon: 'database', points: ['Rigid', 'Slow'] }, { label: 'Custom', icon: 'code', points: ['Exact fit', 'Fast'] }], highlight: 1 },
  decision: { title: 'The branch', question: 'Qualified?', yes: { label: 'Book call', icon: 'check' }, no: { label: 'Nurture', icon: 'chat' }, yesLabel: 'Yes', noLabel: 'No' },
  hierarchy: { title: 'The org', root: { label: 'Company', icon: 'database' }, levels: [[{ label: 'Product', icon: 'code' }, { label: 'Sales', icon: 'user' }], [{ label: 'Design', icon: 'gear' }, { label: 'Build', icon: 'code' }, { label: 'Leads', icon: 'chart' }]] },
  architecture: { title: 'The system', nodes: [{ id: 'app', label: 'Mobile App', icon: 'user' }, { id: 'api', label: 'API', icon: 'code', tone: 'accent' }, { id: 'db', label: 'Database', icon: 'database' }, { id: 'pay', label: 'Payment', icon: 'chart' }, { id: 'notif', label: 'Notifications', icon: 'chat' }], links: [{ from: 'app', to: 'api' }, { from: 'api', to: 'db' }, { from: 'api', to: 'pay' }, { from: 'api', to: 'notif' }] },
  relationship: { title: 'Who talks', nodes: [{ id: 'cust', label: 'Customer', icon: 'user' }, { id: 'merch', label: 'Merchant', icon: 'database' }, { id: 'rider', label: 'Rider', icon: 'bolt' }, { id: 'admin', label: 'Admin', icon: 'gear' }, { id: 'pay', label: 'Payment', icon: 'chart' }], links: [{ from: 'cust', to: 'merch' }, { from: 'merch', to: 'rider' }, { from: 'admin', to: 'merch' }, { from: 'pay', to: 'merch' }] },
  layers: { title: 'The stack', layers: [{ label: 'UI', icon: 'user', points: ['Web', 'App'] }, { label: 'API', icon: 'code' }, { label: 'Business Logic', icon: 'gear' }, { label: 'Database', icon: 'database' }] },
  funnel: { title: 'The funnel', stages: [{ label: 'Visitors', value: '1,000', icon: 'user' }, { label: 'Leads', value: '100', icon: 'chat' }, { label: 'Customers', value: '20', icon: 'check' }] },
};

function render(name, spec, box) {
  return renderDiagram({ name, spec, box, ovId: 'ov-1', theme: THEME, timing: { start: 5, dur: 8 } });
}

test('all 12 diagram types are registered', () => {
  const names = listDiagrams().map((d) => d.name);
  for (const n of ALL) assert.ok(names.includes(n), `missing ${n}`);
  assert.equal(names.length, 12);
});

test('every diagram renders in 16:9 and 9:16', () => {
  for (const name of ALL) {
    const spec = SPECS[name];
    for (const box of [LANDSCAPE, PORTRAIT]) {
      const r = render(name, spec, box);
      assert.ok(r, `${name} returned null`);
      assert.equal(r.frame, 'full');
      assert.ok(r.svg.startsWith('<svg class="dg-svg"'), `${name} svg head`);
      assert.ok(r.svg.endsWith('</svg>'), `${name} svg closed`);
      assert.ok(r.svg.includes(`dg-ov-1-arrow`), `${name} arrow marker id`);
      assert.ok(r.svg.includes('preserveAspectRatio="xMidYMid meet"'), `${name} aspect`);
      assert.ok(r.js.length > 0, `${name} has a timeline`);
      assert.ok(!r.svg.includes('NaN'), `${name} has no NaN`);
      assert.ok(!r.svg.includes('undefined'), `${name} has no undefined`);
    }
  }
});

test('every diagram is deterministic', () => {
  for (const name of ALL) {
    const a = render(name, SPECS[name], PORTRAIT);
    const b = render(name, SPECS[name], PORTRAIT);
    assert.equal(a.svg, b.svg, `${name} svg`);
    assert.equal(a.js.join('\n'), b.js.join('\n'), `${name} js`);
  }
});

test('the timeline only animates within the overlay window', () => {
  for (const name of ALL) {
    const r = render(name, SPECS[name], LANDSCAPE); // start 5, dur 8 -> [5,13]
    const times = (r.js.join('\n').match(/,\s*(-?\d+(?:\.\d+)?)\);/g) ?? []).map((s) => Number(s.replace(/[,\s);]/g, '')));
    for (const t of times) assert.ok(t >= 4.99 && t <= 13.01, `${name}: tween at ${t} outside window`);
  }
});

// ---- per-type validation ---------------------------------------------------

test('validation refuses obviously broken specs', () => {
  const cases = [
    ['pipeline', { steps: [{ label: 'one' }] }],
    ['cycle', { steps: [{ label: 'a' }, { label: 'b' }] }], // cycle needs 3+
    ['timeline', { events: [{ label: 'x', when: 'a'.repeat(20) }] }],
    ['before-after', { before: { label: 'x' } }], // needs after
    ['comparison', { columns: [{ label: 'a' }, { label: 'b' }, { label: 'c' }, { label: 'd' }] }],
    ['decision', { question: 'Q?', yes: { label: 'y' } }], // needs no
    ['hierarchy', { root: { label: 'r' }, levels: [[{ label: 'x' }]] }], // needs 2+ levels
    ['architecture', { nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], links: [{ from: 'a', to: 'zzz' }] }],
    ['relationship', { nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], links: [{ from: 'a', to: 'zzz' }] }],
    ['layers', { layers: [{ label: 'only one' }] }],
    ['funnel', { stages: [{ label: 'only', value: '1' }] }],
  ];
  for (const [name, spec] of cases) {
    const problems = validateDiagram(spec, getLayout(name), {});
    assert.ok(problems.length > 0, `${name} should be refused: ${JSON.stringify(spec)}`);
    assert.equal(render(name, spec, LANDSCAPE), null, `${name} should not render`);
  }
});

test('relationship refuses a spaghetti link count', () => {
  const nodes = Array.from({ length: 5 }, (_, i) => ({ id: `n${i}`, label: `N${i}` }));
  const links = [];
  for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) links.push({ from: `n${i}`, to: `n${j}` });
  const problems = validateDiagram({ nodes, links }, getLayout('relationship'), {});
  assert.ok(problems.some((p) => /too many links/.test(p)));
});

test('architecture accepts a labelled link and refuses a duplicate id', () => {
  const ok = {
    nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
    links: [{ from: 'a', to: 'b', label: 'writes' }],
  };
  assert.deepEqual(validateDiagram(ok, getLayout('architecture'), {}), []);
  const dup = { nodes: [{ id: 'a', label: 'A' }, { id: 'a', label: 'B' }], links: [{ from: 'a', to: 'a' }] };
  assert.ok(validateDiagram(dup, getLayout('architecture'), {}).some((p) => /used twice/.test(p)));
});

test('cycle uses real circular geometry (nodes on a ring)', () => {
  const geo = getLayout('cycle').geometry(SPECS.cycle, LANDSCAPE, THEME);
  const dist = (nd) => Math.hypot(nd.x - geo.cx, nd.y - geo.cy);
  const radii = geo.nodes.map(dist);
  assert.ok(radii.every((r) => Math.abs(r - radii[0]) < 0.5), 'all nodes share the ring radius');
  assert.equal(geo.arcs.length, SPECS.cycle.steps.length); // a closed loop
});

test('funnel narrows from top to bottom', () => {
  const geo = getLayout('funnel').geometry(SPECS.funnel, LANDSCAPE, THEME);
  const widths = geo.bands.map((b) => b.wA);
  for (let i = 1; i < widths.length; i++) assert.ok(widths[i] < widths[i - 1], `stage ${i} is narrower`);
});

test('layers stack top to bottom and narrow toward the top', () => {
  const geo = getLayout('layers').geometry(SPECS.layers, LANDSCAPE, THEME);
  for (let i = 1; i < geo.bands.length; i++) {
    assert.ok(geo.bands[i].y > geo.bands[i - 1].y, 'bands go down');
    assert.ok(geo.bands[i].w >= geo.bands[i - 1].w, 'bands widen downward');
  }
});
