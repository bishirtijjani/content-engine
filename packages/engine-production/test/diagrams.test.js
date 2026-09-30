// Diagrams — the composed SVG visual system (primitives + the flow layout).
import test from 'node:test';
import assert from 'node:assert/strict';
import { getLayout, listDiagrams } from '../src/diagrams/registry.mjs';
import { renderDiagram, validateDiagram, DIAGRAM_CSS } from '../src/diagrams/render.mjs';
import { deriveTheme } from '../src/diagrams/theme.mjs';
import { ICON_NAMES } from '../src/diagrams/icons.mjs';
import { iconGroup, connector } from '../src/diagrams/primitives.mjs';

const THEME = deriveTheme();
const LANDSCAPE = { w: 1690, h: 616 }; // full frame box on a 1920x1080 long video
const PORTRAIT = { w: 950, h: 1094 };  // full frame box on a 1080x1920 short

const SPEC = {
  title: 'The loop',
  steps: [
    { label: 'Lead in', icon: 'user' },
    { label: 'Send it', icon: 'send' },
    { label: 'Log it', icon: 'check' },
  ],
};

function render(over = {}) {
  return renderDiagram({
    name: 'flow', spec: SPEC, box: PORTRAIT, ovId: 'ov-1', theme: THEME,
    timing: { start: 10, dur: 6 },
    ...over,
  });
}

// ---------------------------------------------------------------------------
// registry / theme / icons
// ---------------------------------------------------------------------------

test('the registry lists flow', () => {
  assert.ok(listDiagrams().some((d) => d.name === 'flow' && d.frame === 'full'));
  assert.ok(getLayout('flow'));
  assert.equal(getLayout('ghost'), null);
});

test('the theme comes from the locked style', () => {
  assert.equal(THEME.colors.node, '#0f4c81');
  assert.equal(THEME.colors.accent, '#EA580C');
  assert.ok(THEME.fonts.display);
  assert.ok(THEME.radius > 0);
});

test('the icon set is the ten proposed icons', () => {
  assert.equal(ICON_NAMES.length, 10);
  for (const n of ['user', 'doc', 'code', 'gear', 'database', 'send', 'check', 'bolt', 'chat', 'chart']) {
    assert.ok(ICON_NAMES.includes(n), `missing icon ${n}`);
  }
  assert.ok(iconGroup({ name: 'send', x: 0, y: 0, size: 32 }).includes('<g'));
  assert.equal(iconGroup({ name: 'nope', x: 0, y: 0, size: 32 }), '');
});

test('a connector reports its length and starts hidden', () => {
  const c = connector({ x1: 0, y1: 0, x2: 3, y2: 4, markerId: 'm' });
  assert.equal(c.length, 5);
  assert.ok(c.markup.includes('stroke-dasharray:5'));
  assert.ok(c.markup.includes('marker-end="url(#m)"'));
});

// ---------------------------------------------------------------------------
// geometry
// ---------------------------------------------------------------------------

test('the same spec lays out horizontally on 16:9 and vertically on 9:16', () => {
  const flow = getLayout('flow');
  const land = flow.geometry(SPEC, LANDSCAPE, THEME);
  const port = flow.geometry(SPEC, PORTRAIT, THEME);
  assert.equal(land.orientation, 'landscape');
  assert.equal(port.orientation, 'portrait');
  // landscape nodes share a row; portrait nodes share a column
  const landY = new Set(land.nodes.map((n) => Math.round(n.y)));
  const portX = new Set(port.nodes.map((n) => Math.round(n.x)));
  assert.equal(landY.size, 1);
  assert.equal(portX.size, 1);
  assert.equal(land.edges.length, SPEC.steps.length - 1);
  assert.equal(port.edges.length, SPEC.steps.length - 1);
});

test('every node stays inside the frame box', () => {
  const flow = getLayout('flow');
  for (const box of [LANDSCAPE, PORTRAIT]) {
    const geo = flow.geometry(SPEC, box, THEME);
    for (const n of geo.nodes) {
      assert.ok(n.x >= 0 && n.x + n.w <= geo.w + 0.5, 'node x in bounds');
      assert.ok(n.y >= 0 && n.y + n.h <= geo.h + 0.5, 'node y in bounds');
    }
  }
});

test('geometry is deterministic', () => {
  const flow = getLayout('flow');
  assert.equal(
    JSON.stringify(flow.geometry(SPEC, PORTRAIT, THEME)),
    JSON.stringify(flow.geometry(SPEC, PORTRAIT, THEME))
  );
});

// ---------------------------------------------------------------------------
// validation
// ---------------------------------------------------------------------------

test('validateDiagram accepts a good flow and defaults active to the last step', () => {
  const flow = getLayout('flow');
  assert.deepEqual(validateDiagram(SPEC, flow, { duration: 6 }), []);
  const geo = flow.geometry(SPEC, PORTRAIT, THEME);
  assert.equal(geo.active, SPEC.steps.length - 1);
  assert.ok(geo.nodes[geo.active].active);
});

test('validateDiagram refuses bad specs', () => {
  const flow = getLayout('flow');
  assert.ok(validateDiagram({ steps: [{ label: 'A' }] }, flow).some((p) => /at least 2/.test(p)));
  assert.ok(
    validateDiagram({ steps: Array.from({ length: 6 }, (_, i) => ({ label: `S${i}` })) }, flow)
      .some((p) => /at most 5/.test(p))
  );
  assert.ok(validateDiagram({ steps: [{ label: 'x'.repeat(25) }, { label: 'B' }] }, flow)
    .some((p) => /too long/.test(p)));
  assert.ok(validateDiagram({ steps: [{ label: 'A', icon: 'rocket' }, { label: 'B' }] }, flow)
    .some((p) => /not in the icon set/.test(p)));
  assert.ok(validateDiagram({ title: 'x'.repeat(41), steps: [{ label: 'A' }, { label: 'B' }] }, flow)
    .some((p) => /title is too long/.test(p)));
  assert.ok(validateDiagram({ steps: [{ label: 'A' }, { label: 'B' }], active: 'x' }, flow)
    .some((p) => /whole step number/.test(p)));
});

test('validateDiagram enforces the play-length gate', () => {
  const flow = getLayout('flow');
  const four = { steps: Array.from({ length: 4 }, (_, i) => ({ label: `S${i}` })) };
  assert.ok(validateDiagram(four, flow, { duration: 2.0 }).some((p) => /to play/.test(p)));
  assert.deepEqual(validateDiagram(four, flow, { duration: 2.8 }), []); // 1.0 + 4*0.45
});

// ---------------------------------------------------------------------------
// render
// ---------------------------------------------------------------------------

test('renderDiagram returns the frame, SVG, CSS and timeline', () => {
  const r = render();
  assert.equal(r.frame, 'full');
  assert.equal(r.css, DIAGRAM_CSS);
  assert.ok(r.svg.includes('<svg class="dg-svg"'));
  assert.ok(r.svg.includes('preserveAspectRatio="xMidYMid meet"'));
  assert.ok(r.svg.includes('dg-ov-1-arrow'));
  assert.ok(r.svg.includes('stroke-dasharray'));
  assert.ok(r.svg.includes('dg-node-0') && r.svg.includes('dg-node-2'));
  assert.ok(r.svg.includes('#0f4c81') === false); // colour comes from CSS, not inline
  assert.ok(r.js.some((l) => l.includes('strokeDashoffset')));
  assert.ok(r.js.some((l) => l.includes('.dg-node-2 .dg-node-ring')));
  assert.ok(r.js.some((l) => l.includes(".dg-root")));
});

test('renderDiagram is deterministic', () => {
  assert.equal(render().svg, render().svg);
  assert.equal(render().js.join('\n'), render().js.join('\n'));
});

test('renderDiagram refuses an unknown layout or an invalid spec', () => {
  assert.equal(render({ name: 'ghost' }), null);
  assert.equal(render({ spec: { steps: [{ label: 'only one' }] } }), null);
});
