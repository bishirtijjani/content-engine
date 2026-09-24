// Plan — the shape the agent writes and the checker that guards the style.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyPlan,
  normalizePlan,
  parsePlan,
  summarizePlan,
  validatePlan,
} from '../src/plan.mjs';
import { loadStyle } from '../src/style.mjs';

const STYLE = loadStyle();
const CATALOG = {
  templates: ['stat-callout', 'lower-third'],
  templateIndex: {
    'stat-callout': { fields: ['value', 'label'], frame: 'center' },
    'lower-third': { fields: ['name', 'role'], frame: 'left' },
  },
  visuals: ['visuals/dashboard', 'visuals/demo-clip'],
  sfx: ['sfx/whoosh', 'sfx/ding'],
};
const opts = { duration: 60, style: STYLE, catalog: CATALOG };

test('emptyPlan is valid for a plain captioned video', () => {
  assert.deepEqual(validatePlan(emptyPlan(), opts), []);
});

test('normalizePlan fills every field', () => {
  const p = normalizePlan({ captions: { emphasis: ['x', ''] }, overlays: 'nope' });
  assert.deepEqual(p.captions.emphasis, ['x']);
  assert.deepEqual(p.overlays, []);
  assert.deepEqual(p.zooms, []);
  assert.deepEqual(p.sfx, []);
});

test('summarizePlan counts each part', () => {
  const s = summarizePlan({
    captions: { emphasis: ['a', 'b'] },
    overlays: [{ kind: 'visual', start: 1, end: 3, asset: 'x', why: 'y' }],
    zooms: [{ at: 1, scale: 1.1 }],
    sfx: [{ at: 1, sound: 'sfx/whoosh' }],
  });
  assert.deepEqual(s, { emphasis: 2, overlays: 1, zooms: 1, sfx: 1 });
});

test('a full valid plan passes', () => {
  const plan = {
    captions: { emphasis: ['automated'] },
    overlays: [
      { start: 12, end: 18, kind: 'graphic', name: 'stat-callout', why: 'show the hours saved', fields: { value: '8 hrs' } },
      { start: 30, end: 36, kind: 'visual', file: 'data/visuals/demo/dashboard.png', why: 'show the real dashboard' },
    ],
    zooms: [{ at: 12, scale: 1.15 }],
    sfx: [{ at: 12, sound: 'sfx/whoosh' }],
  };
  assert.deepEqual(validatePlan(plan, opts), []);
});

test('rejects a non-object plan', () => {
  assert.deepEqual(validatePlan('nope', {}), ['plan must be an object']);
  assert.deepEqual(validatePlan(null, {}), ['plan must be an object']);
});

test('rejects an unknown overlay kind', () => {
  const problems = validatePlan({ overlays: [{ kind: 'sticker', start: 1, end: 3, why: 'x' }] }, opts);
  assert.ok(problems.some((p) => /kind must be one of/.test(p)));
});

test('rejects an overlay with no purpose', () => {
  const problems = validatePlan({ overlays: [{ kind: 'graphic', name: 'stat-callout', start: 1, end: 3 }] }, opts);
  assert.ok(problems.some((p) => /needs a "why"/.test(p)));
});

test('rejects a filler purpose', () => {
  const problems = validatePlan(
    { overlays: [{ kind: 'graphic', name: 'stat-callout', start: 1, end: 3, why: 'looks nice' }] }, opts
  );
  assert.ok(problems.some((p) => /says nothing/.test(p)));
});

test('rejects a graphic not in the library', () => {
  const problems = validatePlan(
    { overlays: [{ kind: 'graphic', name: 'ghost-card', start: 1, end: 3, why: 'show it' }] }, opts
  );
  assert.ok(problems.some((p) => /not in the library/.test(p)));
});

test('rejects a library visual not in the library', () => {
  const problems = validatePlan(
    { overlays: [{ kind: 'visual', asset: 'visuals/missing', start: 1, end: 3, why: 'show it' }] }, opts
  );
  assert.ok(problems.some((p) => /not in the library/.test(p)));
});

test('accepts a per-video visual file without the library', () => {
  const problems = validatePlan(
    { overlays: [{ kind: 'visual', file: 'data/visuals/demo/dashboard.png', start: 1, end: 3, why: 'show it' }] }, opts
  );
  assert.deepEqual(problems, []);
});

test('rejects a visual with no file', () => {
  const problems = validatePlan({ overlays: [{ kind: 'visual', start: 1, end: 3, why: 'show it' }] }, opts);
  assert.ok(problems.some((p) => /needs a "file"/.test(p)));
});

test('rejects an unknown frame', () => {
  const problems = validatePlan(
    { overlays: [{ kind: 'visual', file: 'data/x.png', frame: 'corner', start: 1, end: 3, why: 'show it' }] }, opts
  );
  assert.ok(problems.some((p) => /frame must be one of/.test(p)));
});

test('accepts a valid split frame', () => {
  const problems = validatePlan(
    { overlays: [{ kind: 'visual', file: 'data/x.png', frame: 'left', start: 1, end: 3, why: 'show it' }] }, opts
  );
  assert.deepEqual(problems, []);
});

test('rejects a field the graphic does not take', () => {
  const problems = validatePlan(
    { overlays: [{ kind: 'graphic', name: 'stat-callout', start: 1, end: 3, why: 'show it', fields: { value: '8', nope: 'x' } }] }, opts
  );
  assert.ok(problems.some((p) => /does not take/.test(p)));
});

test('rejects overlapping overlays', () => {
  const problems = validatePlan(
    {
      overlays: [
        { kind: 'visual', asset: 'visuals/dashboard', start: 10, end: 20, why: 'a' },
        { kind: 'visual', asset: 'visuals/dashboard', start: 15, end: 25, why: 'b' },
      ],
    },
    opts
  );
  assert.ok(problems.some((p) => /overlaps/.test(p)));
});

test('allows back-to-back overlays that only touch', () => {
  const problems = validatePlan(
    {
      overlays: [
        { kind: 'visual', asset: 'visuals/dashboard', start: 10, end: 20, why: 'a' },
        { kind: 'visual', asset: 'visuals/dashboard', start: 20, end: 30, why: 'b' },
      ],
    },
    opts
  );
  assert.deepEqual(problems, []);
});

test('rejects an overlay past the end of the video', () => {
  const problems = validatePlan(
    { overlays: [{ kind: 'visual', asset: 'visuals/dashboard', start: 58, end: 65, why: 'a' }] }, opts
  );
  assert.ok(problems.some((p) => /past the end/.test(p)));
});

test('rejects an overlay too short to read', () => {
  const problems = validatePlan(
    { overlays: [{ kind: 'visual', asset: 'visuals/dashboard', start: 10, end: 10.2, why: 'a' }] }, opts
  );
  assert.ok(problems.some((p) => /shorter than/.test(p)));
});

test('rejects a zoom scale outside the style range', () => {
  const problems = validatePlan({ zooms: [{ at: 5, scale: 3 }] }, opts);
  assert.ok(problems.some((p) => /outside the style range/.test(p)));
});

test('rejects too many zooms for the length', () => {
  const zooms = Array.from({ length: 10 }, (_, i) => ({ at: i, scale: 1.1 }));
  const problems = validatePlan({ zooms }, { ...opts, duration: 30 });
  assert.ok(problems.some((p) => /too many zooms/.test(p)));
});

test('rejects an unknown sound', () => {
  const problems = validatePlan({ sfx: [{ at: 5, sound: 'sfx/nope' }] }, opts);
  assert.ok(problems.some((p) => /not in the library/.test(p)));
});

test('accepts a style cue alias as a sound', () => {
  const problems = validatePlan({ sfx: [{ at: 5, sound: 'whoosh-soft' }] }, opts);
  assert.deepEqual(problems, []);
});

test('parsePlan throws a plain error on bad JSON', () => {
  assert.throws(() => parsePlan('{not json'), /not valid JSON/);
  assert.equal(parsePlan(null), null);
  assert.equal(parsePlan(''), null);
});
