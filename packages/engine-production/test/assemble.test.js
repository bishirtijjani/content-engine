// Assembler — one composition from a plan.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildComposition } from '../src/assemble.mjs';
import { loadStyle } from '../src/style.mjs';

const STYLE = loadStyle();
const WORDS = [
  { text: 'We', start: 0.0, end: 0.2 },
  { text: 'automated', start: 0.3, end: 0.8 },
  { text: 'the', start: 0.9, end: 1.0 },
  { text: 'whole', start: 1.1, end: 1.4 },
  { text: 'process.', start: 1.5, end: 2.0 },
];

function build(plan, extra = {}) {
  return buildComposition({
    words: WORDS,
    videoSrc: 'source.mp4',
    width: 1080,
    height: 1920,
    duration: 2.4,
    style: STYLE,
    plan,
    ...extra,
  });
}

test('empty plan builds a plain captioned composition', () => {
  const { html, overlayCount, zoomCount } = build({});
  assert.ok(html.includes('data-composition-id="main"'));
  assert.ok(html.includes('id="a-roll"'));
  assert.ok(html.includes('class="clip cap"'));
  assert.ok(html.includes('window.__timelines'));
  assert.equal(overlayCount, 0);
  assert.equal(zoomCount, 0);
});

test('inlines the designed backdrop as the base layer', () => {
  const { html } = build({});
  assert.ok(html.includes('id="backdrop"'));
  assert.ok(html.includes('preserveAspectRatio'));
  assert.ok(html.includes('bd-grid'));
});

test('a take-over overlay hides the video so the backdrop shows', () => {
  const { html } = build(
    { overlays: [{ kind: 'graphic', name: 'stat-callout', start: 0, end: 2, why: 'show the number', fields: { value: '8', label: 'hours' } }] }
  );
  assert.ok(html.includes('ov-takeover'));
  assert.ok(html.includes("tl.set('#a-roll', { opacity: 0 }"));
  assert.ok(html.includes("tl.set('#a-roll', { opacity: 1 }"));
});

test('renders an animated flow diagram as SVG in a take-over clip', () => {
  const { html, overlayCount } = build(
    { overlays: [{ kind: 'diagram', name: 'flow', start: 0, end: 2.4, why: 'show the process',
      spec: { title: 'The loop', steps: [{ label: 'Lead in', icon: 'user' }, { label: 'Send it', icon: 'send' }] } }] }
  );
  assert.equal(overlayCount, 1);
  assert.ok(html.includes('ov-takeover'));
  assert.ok(html.includes('ov-diagram'));
  assert.ok(html.includes('dg-svg'));
  assert.ok(html.includes('stroke-dasharray'));
  assert.ok(html.includes('dg-arrow'));
  assert.ok(html.includes('strokeDashoffset'));
  assert.ok(html.includes("tl.to('#ov-1 .dg-root'"));
});

test('composes a diagram against a landscape frame box', () => {
  const { html } = build(
    { overlays: [{ kind: 'diagram', name: 'flow', start: 0, end: 2.4, why: 'show the process',
      spec: { steps: [{ label: 'One' }, { label: 'Two' }] } }] },
    { width: 1280, height: 720 }
  );
  assert.ok(html.includes('dg-node-0'));
  assert.ok(html.includes('dg-node-1'));
});

test('omits the video element for audio-only sources', () => {
  const { html } = build({}, { audioOnly: true });
  assert.ok(!html.includes('id="a-roll"'));
  assert.ok(html.includes('a-roll-audio'));
});

test('renders a graphic on the burnt orange canvas (take over)', () => {
  const { html, overlayCount } = build(
    { overlays: [{ kind: 'graphic', name: 'stat-callout', start: 0, end: 1, why: 'show hours', fields: { value: '8 hrs', label: 'saved' } }] }
  );
  assert.equal(overlayCount, 1);
  assert.ok(html.includes('ov-takeover'));
  assert.ok(html.includes('tpl-stat'));
  assert.ok(html.includes('8 hrs'));
  assert.ok(html.includes('class="frame"'));
});

test('a split-frame visual insets the video instead of covering it', () => {
  const { html } = build(
    { overlays: [{ kind: 'visual', file: 'data/x/dash.png', frame: 'left', start: 1, end: 2, why: 'show it' }] },
    { resolveVisual: () => 'visual-1.png' }
  );
  assert.ok(html.includes('ov-split'));
  assert.ok(html.includes("tl.set('#a-roll'"));
  assert.ok(html.includes("left: '52%'"));
});

test('renders a visual on the burnt orange canvas', () => {
  const { html } = build(
    { overlays: [{ kind: 'visual', file: 'data/visuals/demo/dashboard.png', start: 0, end: 1, why: 'show the dashboard' }] },
    { resolveVisual: (id) => (id === 'data/visuals/demo/dashboard.png' ? 'visual-1.png' : null) }
  );
  assert.ok(html.includes('ov-media'));
  assert.ok(html.includes('visual-1.png'));
  assert.ok(html.includes('object-fit: contain'));
});

test('a video visual renders a muted <video>', () => {
  const { html } = build(
    { overlays: [{ kind: 'visual', file: 'data/visuals/demo/clip.mp4', start: 0, end: 1, why: 'show the demo' }] },
    { resolveVisual: () => 'visual-1.mp4' }
  );
  assert.ok(html.includes('<video class="ov-media"'));
  assert.ok(html.includes('muted'));
});

test('skips a visual whose file cannot be resolved', () => {
  const { html } = build(
    { overlays: [{ kind: 'visual', file: 'data/visuals/missing.png', start: 1, end: 2, why: 'x' }] },
    { resolveVisual: () => null }
  );
  assert.ok(!html.includes('id="ov-1"'));
});

test('renders zoom tweens', () => {
  const { html, zoomCount } = build({ zooms: [{ at: 1, scale: 1.15 }] });
  assert.equal(zoomCount, 1);
  assert.ok(html.includes("tl.to('#a-roll'"));
  assert.ok(html.includes('scale: 1.15'));
});

test('applies the grade filter', () => {
  const { html } = build({});
  assert.ok(html.includes('contrast('));
});
