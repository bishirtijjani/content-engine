import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSceneGraph, nodeSlots, sceneGraphToHtml, legacyToSceneGraph, formatFigure } from '../src/composition/scene-graph.mjs';
import { validateSnapshotPlan } from '../src/composition/snapshot-spec.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const planPath = path.resolve(__dirname, 'fixtures/item-fin.plan.json');

function validSg() {
  return {
    scene: { id: 's' },
    nodes: [
      { id: 'root', type: 'group', layout: { x: 0, y: 0, w: 1, h: 1 }, children: [
        { id: 't', type: 'text', layout: { x: 0, y: 0, w: 1, h: 0.1 }, text: 'hi' }
      ] }
    ]
  };
}

test('validateSceneGraph accepts a valid scene graph', () => {
  assert.equal(validateSceneGraph(validSg()).length, 0);
});

test('validateSceneGraph rejects a missing scene / bad nodes / bad layout', () => {
  assert.ok(validateSceneGraph(null).length > 0);
  assert.ok(validateSceneGraph({ nodes: [] }).some((p) => /scene/.test(p)));
  assert.ok(validateSceneGraph({ scene: {}, nodes: [{ type: 'text' }] }).some((p) => /id/.test(p)));
  assert.ok(validateSceneGraph({ scene: {}, nodes: [{ id: 'a', type: 'text', layout: { x: 'wide' } }] }).some((p) => /0-1/.test(p)));
});

test('nodeSlots extracts ids recursively (children of children)', () => {
  const sg = {
    scene: { id: 's' },
    nodes: [{ id: 'r', type: 'group', children: [
      { id: 'a', type: 'text' },
      { id: 'b', type: 'group', children: [{ id: 'c', type: 'text' }] }
    ] }]
  };
  assert.deepEqual(nodeSlots(sg).sort(), ['a', 'b', 'c', 'r'].sort());
});

test('sceneGraphToHtml emits data-sg for every node and data-slot for non-root slots', () => {
  const html = sceneGraphToHtml(validSg(), { width: 1080, orientation: 'portrait' });
  assert.ok(html.includes('data-sg="root"'));
  assert.ok(!html.includes('data-slot="root"'), 'root is the container, not a revealable slot');
  assert.ok(html.includes('data-sg="t"'));
  assert.ok(html.includes('data-slot="t"'));
  assert.ok(html.includes('cx-sg-scale'), 'design canvas is scaled to the render size');
});

test('legacyToSceneGraph adapts bars without being a sceneGraph source of truth', () => {
  const sg = legacyToSceneGraph({ id: 'x', start: 0, end: 4, concept: 'bars', composition: { kicker: 'K', bars: [{ label: 'A', value: 5, max: 10 }] } });
  assert.equal(validateSceneGraph(sg).length, 0);
  assert.ok(nodeSlots(sg).includes('bar-0'));
});

test('a snapshot segment authored directly as sceneGraph validates as a normal snapshot', () => {
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  const problems = validateSnapshotPlan(plan);
  assert.deepEqual(problems, [], problems.join('\n'));
  const seg = plan.segments[0];
  assert.equal(seg.kind, 'snapshot');
  assert.ok(seg.sceneGraph && !seg.concept && !seg.composition);
});

test('the financial-dashboard scene graph keeps independent element positioning and beat targets', () => {
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  const seg = plan.segments[0];
  const positions = new Set(seg.sceneGraph.nodes[0].children.map((n) => `${n.layout.x},${n.layout.y},${n.layout.w},${n.layout.h}`));
  assert.ok(positions.size >= 4, 'elements positioned independently, not in a fixed column');
  const slots = new Set(nodeSlots(seg.sceneGraph));
  for (const id of [
    'kicker', 'kicker-rule', 'unit-revenue', 'term-revenue', 'unit-expenses',
    'term-expenses', 'eq-rule', 'label-profit', 'result-profit',
    'txn-card', 'txn-id', 'txn-amount', 'txn-status', 'txn-note'
  ]) {
    assert.ok(slots.has(id), `scene graph has ${id}`);
  }
  const targeted = new Set(seg.beats.flatMap((b) => (Array.isArray(b.action.target) ? b.action.target : [b.action.target])));
  for (const id of ['term-revenue', 'term-expenses', 'result-profit', 'unit-revenue', 'txn-status', 'txn-note']) {
    assert.ok(targeted.has(id), `a beat targets ${id}`);
  }
  const ops = new Set(seg.beats.map((b) => b.action.op));
  for (const op of ['draw', 'pulse', 'move']) assert.ok(ops.has(op), `beats use the ${op} op`);
});

test('formatFigure matches the runtime count-up formatting', () => {
  assert.equal(formatFigure(128400, 'currency'), '$128,400');
  assert.equal(formatFigure(84200, 'int'), '84,200');
  assert.equal(formatFigure(44.2, 'percent'), '44%');
  assert.equal(formatFigure(44200, undefined), '44,200');
});

test('sceneGraphToHtml renders figure/icon/rule nodes generically', () => {
  const sg = {
    scene: { id: 's' },
    nodes: [{ id: 'root', type: 'group', children: [
      { id: 'num', type: 'figure', value: 44200, format: 'currency', layout: { x: 0, y: 0, w: 1, h: 0.1 } },
      { id: 'ico', type: 'icon', name: 'flag', size: 32, layout: { x: 0, y: 0.2, w: 0.1, h: 0.1 } },
      { id: 'rule', type: 'rule', layout: { x: 0, y: 0.4, w: 0.8, h: 0.005 } }
    ] }]
  };
  assert.equal(validateSceneGraph(sg).length, 0);
  const html = sceneGraphToHtml(sg);
  assert.ok(html.includes('class="cx-num"'));
  assert.ok(html.includes('data-count-to="44200"'));
  assert.ok(html.includes('data-count-format="currency"'));
  assert.ok(html.includes('$44,200'), 'final value is correct even without running the timeline');
  assert.ok(html.includes('class="cx-icon"'));
  assert.ok(html.includes('data-sg="rule"'));
});

test('validateSceneGraph rejects a bad figure value and an unknown icon', () => {
  assert.ok(validateSceneGraph({ scene: {}, nodes: [{ id: 'x', type: 'figure', value: 'lots' }] }).some((p) => /number/.test(p)));
  assert.ok(validateSceneGraph({ scene: {}, nodes: [{ id: 'x', type: 'icon', name: 'nope' }] }).some((p) => /icon/.test(p)));
});

test('sceneGraphToHtml inlines an image node as a data-URI <img>', () => {
  const sg = {
    scene: { id: 's' },
    nodes: [{ id: 'root', type: 'group', children: [
      { id: 'pic', type: 'image', src: 'brand/logo-transparent.png', fit: 'contain', radius: 12, layout: { x: 0.2, y: 0.2, w: 0.5, h: 0.3 } }
    ] }]
  };
  assert.equal(validateSceneGraph(sg).length, 0, 'a real repo asset resolves');
  const html = sceneGraphToHtml(sg);
  assert.ok(html.includes('class="cx-img"'));
  assert.ok(html.includes('src="data:image/png;base64,'));
  assert.ok(html.includes('object-fit:contain'));
  assert.ok(html.includes('border-radius:12px'));
});

test('sceneGraphToHtml renders an edge as a single drawable <path> with an arrowhead', () => {
  const sg = {
    scene: { id: 's' },
    nodes: [{ id: 'root', type: 'group', children: [
      { id: 'a-b', type: 'edge', layout: { x: 0, y: 0, w: 1, h: 1 },
        points: [{ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.8 }], stroke: 'white', strokeWidth: 4 }
    ] }]
  };
  assert.equal(validateSceneGraph(sg).length, 0);
  const html = sceneGraphToHtml(sg);
  assert.ok(html.includes('class="cx-edge"'));
  // Authored in canvas fractions, rendered in design-canvas pixels (1080x1920).
  assert.ok(html.includes('viewBox="0 0 1080 1920"'));
  const path = /<path d="([^"]+)"/.exec(html)[1];
  assert.ok(path.startsWith('M 540 960'), 'first point maps to design px');
  assert.ok((path.match(/M/g) || []).length === 2, 'line plus a separate arrowhead sub-path');
});

test('sceneGraphToHtml renders an inline icon on a text node', () => {
  const sg = {
    scene: { id: 's' },
    nodes: [{ id: 'root', type: 'group', children: [
      { id: 'n', type: 'text', icon: 'cpu', iconSize: 40, text: { value: 'Agent' }, layout: { x: 0, y: 0, w: 0.5, h: 0.1 } }
    ] }]
  };
  assert.equal(validateSceneGraph(sg).length, 0);
  const html = sceneGraphToHtml(sg);
  const node = /data-sg="n"[^>]*>(.*?)<\/div>/s.exec(html)[1];
  assert.ok(node.includes('class="cx-icon"'));
  assert.ok(node.includes('Agent'));
});

test('shape nodes render rect, polygon, line and a donut; unknown shapes are refused', () => {
  const sg = {
    scene: { id: 's' },
    nodes: [{ id: 'root', type: 'group', children: [
      { id: 'rect', type: 'shape', shape: 'rect', r: 20, fill: 'blue', layout: { x: 0, y: 0, w: 0.4, h: 0.1 } },
      { id: 'dia', type: 'shape', shape: 'diamond', fill: 'amber', layout: { x: 0, y: 0.2, w: 0.3, h: 0.1 } },
      { id: 'line', type: 'shape', shape: 'line', x1: 0, y1: 0.5, x2: 1, y2: 0.5, stroke: 'white', strokeWidth: 4, layout: { x: 0.1, y: 0.4, w: 0.8, h: 0.02 } },
      { id: 'ring', type: 'shape', shape: 'donut', inner: 0.6, startAngle: 0, endAngle: 360, fill: 'surface', layout: { x: 0.2, y: 0.6, w: 0.4, h: 0.4 } },
    ] }],
  };
  assert.equal(validateSceneGraph(sg).length, 0);
  const html = sceneGraphToHtml(sg);
  assert.ok(html.includes('<rect'));
  assert.ok(html.includes('<polygon'));
  assert.ok(html.includes('<line'));
  assert.ok(html.includes('<path'), 'full donut is a path');
  const donut = /data-sg="ring"[\s\S]*?<path d="([^"]+)"/.exec(html)[1];
  assert.equal((donut.match(/ A /g) || []).length, 4, 'two outer and two inner arcs');
  assert.ok(validateSceneGraph({ scene: {}, nodes: [{ id: 'x', type: 'shape', shape: 'nope' }] }).some((p) => /known shape/.test(p)));
});

test('a full-sweep pie renders as a circle, not a degenerate arc', () => {
  const sg = {
    scene: { id: 's' },
    nodes: [{ id: 'root', type: 'group', children: [
      { id: 'pie', type: 'shape', shape: 'pie', startAngle: 0, endAngle: 360, fill: 'blue', layout: { x: 0.2, y: 0.2, w: 0.4, h: 0.4 } },
    ] }],
  };
  const html = sceneGraphToHtml(sg);
  assert.ok(/data-sg="pie"[\s\S]*?<circle/.test(html));
});

test('a static node is not a slot and is excluded from nodeSlots', () => {
  const sg = {
    scene: { id: 's' },
    nodes: [{ id: 'root', type: 'group', children: [
      { id: 'chrome', type: 'shape', shape: 'rect', static: true, fill: 'ghost', layout: { x: 0, y: 0, w: 1, h: 0.02 } },
      { id: 'content', type: 'text', text: 'hi', layout: { x: 0, y: 0.1, w: 1, h: 0.1 } },
    ] }],
  };
  assert.deepEqual(validateSceneGraph(sg), []);
  const html = sceneGraphToHtml(sg);
  assert.ok(!html.includes('data-slot="chrome"'), 'static chrome is never hidden by the motion sweep');
  assert.ok(html.includes('data-slot="content"'));
  assert.ok(!nodeSlots(sg).includes('chrome'));
  assert.ok(nodeSlots(sg).includes('content'));
});

test('smooth edges support a start arrow and place the label at the midpoint', () => {
  const sg = {
    scene: { id: 's' },
    nodes: [{ id: 'root', type: 'group', children: [
      { id: 'e', type: 'edge', curve: 'smooth', arrowStart: true, label: 'relates',
        points: [{ x: 0.2, y: 0.5 }, { x: 0.4, y: 0.35 }, { x: 0.6, y: 0.5 }], layout: { x: 0, y: 0, w: 1, h: 1 } },
    ] }],
  };
  assert.deepEqual(validateSceneGraph(sg), []);
  const html = sceneGraphToHtml(sg);
  const d = /<path d="([^"]+)"/.exec(html)[1];
  assert.ok(d.includes('C'), 'smooth curve uses cubic segments');
  assert.equal((d.match(/M/g) || []).length, 3, 'line plus two arrowheads');
  assert.ok(html.includes('left:40%'), 'label sits on the midpoint x');
  assert.ok(html.includes('top:33%'), 'label sits on the midpoint y, lifted by the default offset');
});

test('table rows can be individual slots', () => {
  const sg = {
    scene: { id: 's' },
    nodes: [{ id: 'root', type: 'group', children: [
      { id: 'tbl', type: 'table', columns: ['A', 'B'], rows: [['1', '2'], ['3', '4']], rowSlots: true, slot: false },
    ] }],
  };
  assert.deepEqual(validateSceneGraph(sg), []);
  const html = sceneGraphToHtml(sg);
  assert.ok(html.includes('data-slot="row-0"'));
  assert.ok(html.includes('data-slot="row-1"'));
  assert.deepEqual(nodeSlots(sg).filter((s) => s.startsWith('row-')), ['row-0', 'row-1']);
});

test('wrapped text breaks lines and ellipsizes the last one', () => {
  const sg = {
    scene: { id: 's' },
    nodes: [{ id: 'root', type: 'group', children: [
      { id: 'w', type: 'text', text: { value: 'one two three four five six' }, wrap: 10, maxLines: 2, layout: { x: 0, y: 0, w: 1, h: 0.2 } },
    ] }],
  };
  const html = sceneGraphToHtml(sg);
  assert.ok(html.includes('<br>'));
  assert.ok(html.includes('…'));
});

test('validateSceneGraph rejects a bad image src, a short edge, and a bad inline icon', () => {
  assert.ok(validateSceneGraph({ scene: {}, nodes: [{ id: 'x', type: 'image', src: 'nope/missing.png' }] }).some((p) => /resolve/.test(p)));
  assert.ok(validateSceneGraph({ scene: {}, nodes: [{ id: 'x', type: 'image' }] }).some((p) => /src/.test(p)));
  assert.ok(validateSceneGraph({ scene: {}, nodes: [{ id: 'x', type: 'edge', points: [{ x: 0, y: 0 }] }] }).some((p) => /two/.test(p)));
  assert.ok(validateSceneGraph({ scene: {}, nodes: [{ id: 'x', type: 'edge', points: [{ x: 2, y: 0 }, { x: 0, y: 0 }] }] }).some((p) => /0-1/.test(p)));
  assert.ok(validateSceneGraph({ scene: {}, nodes: [{ id: 'x', type: 'text', icon: 'nope', text: 'hi' }] }).some((p) => /icon/.test(p)));
});
