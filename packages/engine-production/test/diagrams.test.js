// Diagrams — the 58-layout authoring layer, compiled natively to scene graphs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listLayouts } from '../src/diagrams/registry.mjs';
import { compileDiagram, validateDiagramSpec, diagramSlots } from '../src/diagrams/compile.mjs';
import { synthesizeDiagramBeats } from '../src/diagrams/beats.mjs';
import { validateSceneGraph, nodeSlots } from '../src/composition/scene-graph.mjs';
import { renderSnapshotHtml } from '../src/composition/snapshot.mjs';
import { primitives } from '../src/diagrams/primitives.mjs';
import { frameBox } from '../src/diagrams/frame.mjs';
import { loadStyle } from '../src/style.mjs';
import { deriveBeats } from '../src/beats.mjs';
import { SAMPLES } from '../tools/diagram-samples.mjs';

const style = loadStyle();
const layouts = listLayouts();

test('every registered layout has a neutral sample', () => {
  for (const layout of layouts) {
    assert.ok(SAMPLES[layout.name], `missing sample for ${layout.name}`);
  }
  assert.ok(layouts.length >= 50, `expected the full layout set, got ${layouts.length}`);
});

test('every layout compiles in both orientations with a valid scene graph', () => {
  for (const layout of layouts) {
    const spec = SAMPLES[layout.name];
    for (const orientation of ['portrait', 'landscape']) {
      const compiled = compileDiagram({ name: layout.name, spec, style, orientation });
      assert.deepEqual(validateSceneGraph(compiled.sceneGraph), [], `${layout.name} (${orientation}) scene graph`);
      assert.ok(compiled.sceneGraph.nodes.length, `${layout.name} has nodes`);
      assert.ok(compiled.slots.length, `${layout.name} has slots`);
    }
  }
});

test('slots, rendered nodes and build order agree for every layout', () => {
  for (const layout of layouts) {
    const spec = SAMPLES[layout.name];
    for (const orientation of ['portrait', 'landscape']) {
      const { sceneGraph, slots, build } = compileDiagram({ name: layout.name, spec, style, orientation });
      const unique = new Set(slots);
      assert.equal(unique.size, slots.length, `${layout.name} has duplicate slots`);
      const rendered = new Set(nodeSlots(sceneGraph).filter((s) => s !== 'root'));
      for (const slot of slots) assert.ok(rendered.has(slot), `${layout.name}: slot ${slot} has no node`);
      for (const node of rendered) assert.ok(unique.has(node), `${layout.name}: node ${node} is not a declared slot`);
      const built = new Set(build.flat());
      for (const slot of slots) assert.ok(built.has(slot), `${layout.name}: slot ${slot} is never built`);
      for (const slot of built) assert.ok(unique.has(slot), `${layout.name}: build targets unknown slot ${slot}`);
    }
  }
});

test('slot ids are stable across orientations', () => {
  for (const layout of layouts) {
    const spec = SAMPLES[layout.name];
    const a = compileDiagram({ name: layout.name, spec, style, orientation: 'portrait' }).slots;
    const b = compileDiagram({ name: layout.name, spec, style, orientation: 'landscape' }).slots;
    assert.deepEqual(a, b, `${layout.name} slot ids drift with orientation`);
  }
});

test('spec validation refuses bad input', () => {
  assert.ok(validateDiagramSpec('flow', {}).some((p) => /steps/.test(p)));
  assert.ok(validateDiagramSpec('flow', { steps: [{ label: 'one' }] }).some((p) => /2-5/.test(p)));
  assert.ok(validateDiagramSpec('flow', { steps: [{ label: 'one', icon: 'nope' }, { label: 'two' }] }).some((p) => /icon/.test(p)));
  assert.ok(validateDiagramSpec('nope', {}).some((p) => /unknown/.test(p)));
  assert.ok(validateDiagramSpec('table', { columns: ['a', 'b'], rows: [['1']] }).some((p) => /cells/.test(p)));
  assert.ok(validateDiagramSpec('gauge', { value: 120, min: 0, max: 100 }).some((p) => /between/.test(p)));
});

test('compiling an invalid spec throws instead of rendering a broken diagram', () => {
  assert.throws(() => compileDiagram({ name: 'flow', spec: {}, style }), /invalid/);
  assert.throws(() => compileDiagram({ name: 'missing-layout', spec: {}, style }), /unknown diagram layout/);
});

test('a diagram segment renders through renderSnapshotHtml', () => {
  const { html } = renderSnapshotHtml({
    id: 'd1',
    diagram: { name: 'flow', spec: SAMPLES.flow },
  }, { style, width: 1080, height: 1920, orientation: 'portrait' });
  assert.ok(html.includes('data-slot="node-0"'));
  assert.ok(html.includes('data-slot="link-0"'));
  assert.ok(html.includes('cx-sg-scale'));
});

test('diagram slots are namespaced by the layout and beat-addressable', () => {
  const slots = diagramSlots('architecture', SAMPLES.architecture);
  assert.ok(slots.includes('node-app'));
  assert.ok(slots.includes('link-0'));
  assert.ok(!slots.includes('root'));
});

test('synthesized diagram beats introduce every slot from narration', () => {
  // Ten sentences across the segment, enough for the flow build order.
  const words = [];
  let t = 0;
  for (let s = 0; s < 10; s++) {
    const line = `Sentence number ${s + 1} lands here.`;
    for (const w of line.split(' ')) {
      words.push({ text: w, start: t, end: t + 0.3 });
      t += 0.34;
    }
  }
  const beats = deriveBeats(words);
  const plan = {
    segments: [{
      id: 'd1', kind: 'snapshot', start: 1, end: 30,
      diagram: { name: 'flow', spec: SAMPLES.flow },
    }],
  };
  const out = synthesizeDiagramBeats(plan, beats, { style });
  const seg = out.segments[0];
  assert.ok(seg.beats.length > 0, 'beats were synthesized');
  const introduced = new Set(seg.beats.flatMap((b) => {
    const target = b.action?.target;
    return Array.isArray(target) ? target : target ? [target] : [];
  }));
  for (const slot of diagramSlots('flow', SAMPLES.flow)) {
    assert.ok(introduced.has(slot), `no beat introduces ${slot}`);
  }
});

test('cardContent row fills the card and centres the icon', () => {
  const P = primitives({ ...frameBox(style, 'portrait'), style });
  const box = { x: 0, y: 0, w: 900, h: 180 };
  const c = P.cardContent(box, { icon: 'bolt', label: 'A label' }, { mode: 'row' });
  const m = c.meta;
  assert.equal(m.mode, 'row');
  assert.ok(m.iconBox.w >= Math.min(box.w, box.h) * 0.18, 'icon is not tiny');
  assert.ok(m.iconBox.x + m.iconBox.w <= m.labelBox.x, 'label starts after the icon');
  assert.ok(Math.abs((m.labelBox.x + m.labelBox.w) - (m.cb.x + m.cb.w)) < 1, 'label fills to the content edge');
  const top = m.iconBox.y - box.y;
  const bottom = box.y + box.h - (m.iconBox.y + m.iconBox.h);
  assert.ok(Math.abs(top - bottom) < 2, 'icon is vertically centred');
});

test('cardContent stack centres the icon+label group and scales the icon up', () => {
  const P = primitives({ ...frameBox(style, 'portrait'), style });
  const box = { x: 0, y: 0, w: 451, h: 440 };
  const c = P.cardContent(box, { icon: 'database', label: 'The service' }, { mode: 'stack' });
  const m = c.meta;
  assert.equal(m.mode, 'stack');
  assert.ok(m.iconBox.w >= Math.min(box.w, box.h) * 0.18, 'icon scales with the card');
  assert.ok(m.labelBox.y >= m.iconBox.y + m.iconBox.h, 'label sits below the icon');
  const top = m.iconBox.y - box.y;
  const bottom = box.y + box.h - (m.labelBox.y + m.labelBox.h);
  assert.ok(Math.abs(top - bottom) < 3, 'the group is vertically centred');
});

test('cardContent list distributes rows to the content bottom', () => {
  const P = primitives({ ...frameBox(style, 'portrait'), style });
  const box = { x: 0, y: 0, w: 428, h: 497 };
  const c = P.cardContent(box, {
    header: 'Customer',
    rows: [{ left: 'id', right: 'uuid' }, { left: 'name', right: 'text' }, { left: 'email', right: 'text' }],
  }, { mode: 'list' });
  const m = c.meta;
  assert.equal(m.mode, 'list');
  assert.ok(m.area.h > 0);
  // The rows block is allocated to the content bottom by construction.
  assert.ok(Math.abs((m.area.y + m.area.h) - (box.y + box.h - m.pad)) < 1);
});

test('cardContent reserves explicit leading and trailing regions', () => {
  const P = primitives({ ...frameBox(style, 'portrait'), style });
  const box = { x: 0, y: 0, w: 950, h: 225 };
  const c = P.cardContent(box, { icon: 'trophy', label: 'Item one' }, {
    mode: 'row', leading: 0.09, trailing: 0.51,
  });
  const m = c.meta;
  assert.ok(Math.abs(m.leadingBox.w - m.cb.w * 0.09) < 1);
  assert.ok(Math.abs(m.trailingBox.x - (m.area.x + m.area.w)) < 1);
  assert.ok(Math.abs(m.labelBox.x + m.labelBox.w - m.trailingBox.x) < 1);
});

test('cards that use cardContent meet the fit rules in every layout and orientation', () => {
  for (const layout of layouts) {
    const spec = SAMPLES[layout.name];
    for (const orientation of ['portrait', 'landscape']) {
      const { sceneGraph } = compileDiagram({ name: layout.name, spec, style, orientation });
      const walk = (nodes) => {
        for (const n of nodes ?? []) {
          if (n.type === 'group' && n.meta?.mode) {
            const m = n.meta;
            const rel = (b) => ({ x: b.x - m.card.x, y: b.y - m.card.y, w: b.w, h: b.h });
            const minSide = Math.min(m.card.w, m.card.h);
            if (m.iconBox) {
              assert.ok(
                Math.min(m.iconBox.w, m.iconBox.h) >= minSide * 0.18 - 0.5,
                `${layout.name} ${orientation}: icon ${m.iconBox.w} too small for card ${m.card.w}x${m.card.h}`,
              );
            }
            for (const key of ['iconBox', 'labelBox']) {
              if (!m[key]) continue;
              const b = rel(m[key]);
              assert.ok(b.x >= -0.5 && b.y >= -0.5, `${layout.name}: ${key} starts outside the card`);
              assert.ok(b.x + b.w <= m.card.w + 0.5, `${layout.name}: ${key} overflows right`);
              assert.ok(b.y + b.h <= m.card.h + 0.5, `${layout.name}: ${key} overflows bottom`);
            }
            if (m.labelBox && m.trailingBox.w === 0) {
              const lb = rel(m.labelBox);
              const rightGap = m.card.w - (lb.x + lb.w);
              assert.ok(rightGap <= Math.max(m.card.w * 0.15, m.pad + 1), `${layout.name}: dead space right (${Math.round(rightGap)})`);
            }
            if (m.mode !== 'list' && m.labelBox && m.iconBox) {
              const ib = m.iconBox ? rel(m.iconBox) : null;
              const lb = rel(m.labelBox);
              const top = Math.min(ib?.y ?? lb.y, lb.y);
              const bottom = Math.max(ib ? ib.y + ib.h : lb.y, lb.y + lb.h);
              assert.ok((bottom - top) / m.card.h >= 0.45, `${layout.name}: content too small for the card`);
            }
          }
          if (n.children) walk(n.children);
        }
      };
      walk(sceneGraph.nodes);
    }
  }
});

test('explicit beats are never overwritten by the synthesizer', () => {
  const authored = [{ id: 'b1', start: 1, end: 4, spoken: 'x', action: { op: 'introduce', target: ['node-0'] } }];
  const plan = { segments: [{ id: 'd', kind: 'snapshot', start: 1, end: 9, diagram: { name: 'flow', spec: SAMPLES.flow }, beats: authored }] };
  const out = synthesizeDiagramBeats(plan, [{ start: 1, end: 9, text: 'x' }], { style });
  assert.equal(out.segments[0].beats, authored);
});
