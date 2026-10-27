// Snapshot plan — the Video -> Snapshots -> Beats schema, gates, and recipes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadStyle } from '../src/style.mjs';
import {
  ACTION_OPS, SNAPSHOT_CONCEPTS, normalizeSnapshotPlan, validateSnapshotPlan, summarizeSnapshotPlan,
} from '../src/composition/snapshot-spec.mjs';
import { composeSnapshot, composeSnapshotHTML, SNAPSHOT_RECIPES } from '../src/composition/snapshot.mjs';
import { snapshotPlanTable, deriveNarrationBeats } from '../src/composition/snapshot-plan.mjs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initDb } from '@content-os/core';
import { ProductionEngine } from '../src/index.js';

function freshDb() {
  const dir = mkdtempSync(path.join(tmpdir(), 'snapshot-plan-'));
  return initDb(path.join(dir, 'test.db'));
}

/** A throwaway data root — tests must never write into the real data/ dir. */
const TEST_DATA = mkdtempSync(path.join(tmpdir(), 'snapshot-data-'));

const STYLE = loadStyle();

const PLAN = {
  video: { id: 'v', duration: 30, orientation: 'portrait' },
  segments: [
    { id: 'f1', kind: 'footage', section: 'Hook', start: 0, end: 1, transitionOut: { technique: 'crossfade' } },
    {
      id: 's1', kind: 'snapshot', section: 'The math', concept: 'equation', frame: 'full', start: 1, end: 12,
      transitionOut: { technique: 'crossfade' },
      composition: {
        terms: [{ value: '40', label: 'questions a day' }, { value: '5', unit: 'min', label: 'each' }],
        result: { value: '200', unit: 'min', label: 'a day' },
      },
      beats: [
        { id: 'b1', start: 1, end: 5, spoken: 'forty times', action: { op: 'introduce', target: ['term-0', 'term-1'] }, element: 'rows' },
        { id: 'b2', start: 6, end: 11, spoken: 'equals two hundred', action: { op: 'reveal', target: 'result' }, element: 'result' },
      ],
    },
    {
      id: 's2', kind: 'snapshot', section: 'CTA', concept: 'cta', frame: 'full', start: 13, end: 29,
      composition: { text: 'Do the math.', handle: '@iambishir' },
      beats: [{ id: 'b3', start: 13, end: 28, spoken: 'do the math', action: { op: 'introduce', target: ['text', 'handle'] }, element: 'cta card' }],
    },
  ],
};

test('the snapshot vocabulary is exposed', () => {
  assert.ok(SNAPSHOT_CONCEPTS.includes('equation') && SNAPSHOT_CONCEPTS.includes('quote'));
  assert.ok(ACTION_OPS.includes('introduce') && ACTION_OPS.includes('highlight') && ACTION_OPS.includes('hold'));
});

test('a well-formed snapshot plan passes', () => {
  assert.deepEqual(validateSnapshotPlan(PLAN), []);
});

test('summarize counts segments, snapshots, clips and beats', () => {
  assert.deepEqual(summarizeSnapshotPlan(PLAN), { segments: 3, snapshots: 2, clips: 0, beats: 3 });
});

const CLIP = {
  id: 'c1', kind: 'clip', section: 'The screen',
  src: 'data/item-4/screen/screenrec1.mp4',
  start: 12, end: 13, sourceIn: 0, sourceOut: 1,
  why: 'show the real personalization screen while the steps are named',
};

test('a well-formed clip segment passes', () => {
  const plan = structuredClone(PLAN);
  plan.segments.splice(2, 0, structuredClone(CLIP));
  assert.deepEqual(validateSnapshotPlan(plan), []);
  assert.deepEqual(summarizeSnapshotPlan(plan), { segments: 4, snapshots: 2, clips: 1, beats: 3 });
});

test('a clip needs a src and a why', () => {
  const noSrc = structuredClone(PLAN);
  noSrc.segments.splice(2, 0, { ...structuredClone(CLIP), src: undefined });
  assert.ok(validateSnapshotPlan(noSrc).some((p) => /\(clip\) needs a "src"/.test(p)));

  const noWhy = structuredClone(PLAN);
  noWhy.segments.splice(2, 0, { ...structuredClone(CLIP), why: undefined });
  assert.ok(validateSnapshotPlan(noWhy).some((p) => /\(clip\) needs a "why"/.test(p)));
});

test('a clip whose source length does not match its on-screen length is refused', () => {
  const plan = structuredClone(PLAN);
  plan.segments.splice(2, 0, { ...structuredClone(CLIP), end: 15 });
  assert.ok(validateSnapshotPlan(plan).some((p) => /plays 1\.00s of source but is on screen 3\.00s/.test(p)));
});

test('a clip with sourceOut before sourceIn is refused', () => {
  const plan = structuredClone(PLAN);
  plan.segments.splice(2, 0, { ...structuredClone(CLIP), sourceIn: 2, sourceOut: 1 });
  assert.ok(validateSnapshotPlan(plan).some((p) => /sourceOut must be after sourceIn/.test(p)));
});

test('a clip-only plan is valid (a video does not need a snapshot if it has a clip)', () => {
  const plan = {
    video: { duration: 10 },
    segments: [
      { id: 'f1', kind: 'footage', start: 0, end: 2 },
      { id: 'c1', kind: 'clip', src: 'screen.mp4', start: 2, end: 10, sourceIn: 0, sourceOut: 8, why: 'show the real screen' },
    ],
  };
  assert.deepEqual(validateSnapshotPlan(plan), []);
});

test('an unknown concept is refused', () => {
  const bad = structuredClone(PLAN);
  bad.segments[1].concept = 'nope';
  assert.ok(validateSnapshotPlan(bad).some((p) => /is not a snapshot concept/.test(p)));
});

test('an empty composition is refused', () => {
  const bad = structuredClone(PLAN);
  bad.segments[1].composition = {};
  assert.ok(validateSnapshotPlan(bad).some((p) => /empty composition/.test(p)));
});

test('a snapshot with no beats is refused', () => {
  const bad = structuredClone(PLAN);
  bad.segments[1].beats = [];
  assert.ok(validateSnapshotPlan(bad).some((p) => /has no beats/.test(p)));
});

test('an unknown beat action is refused', () => {
  const bad = structuredClone(PLAN);
  bad.segments[1].beats[0].action.op = 'explode';
  assert.ok(validateSnapshotPlan(bad).some((p) => /action.op/.test(p)));
});

test('a beat targeting a slot the concept does not have is refused', () => {
  const bad = structuredClone(PLAN);
  bad.segments[1].beats[0].action.target = ['term-9'];
  assert.ok(validateSnapshotPlan(bad).some((p) => /is not a slot of equation/.test(p)));
});

test('a non-hold beat with no target is refused', () => {
  const bad = structuredClone(PLAN);
  bad.segments[1].beats[0].action.target = undefined;
  assert.ok(validateSnapshotPlan(bad).some((p) => /action.target is required/.test(p)));
});

test('a slot introduced by no beat is refused', () => {
  const bad = structuredClone(PLAN);
  bad.segments[1].beats[0].action.target = ['term-0']; // 'term-1' now uncovered
  assert.ok(validateSnapshotPlan(bad).some((p) => /slot "term-1" is introduced by no beat/.test(p)));
});

test('a hold beat needs no target', () => {
  const plan = structuredClone(PLAN);
  plan.segments[1].beats[0].action = { op: 'introduce', target: ['term-0', 'term-1', 'result'] };
  plan.segments[1].beats[1].action = { op: 'hold' };
  assert.deepEqual(validateSnapshotPlan(plan), []);
});

test('a beat outside its segment window is refused', () => {
  const bad = structuredClone(PLAN);
  bad.segments[1].beats[1].end = 30;
  assert.ok(validateSnapshotPlan(bad).some((p) => /ends after its segment window/.test(p)));
});

test('overlapping segments are refused', () => {
  const bad = structuredClone(PLAN);
  bad.segments[2].start = 5;
  assert.ok(validateSnapshotPlan(bad).some((p) => /overlaps the previous segment/.test(p)));
});

test('a narration beat not covered by any segment is refused', () => {
  const beats = [{ id: 'n1', start: 40, end: 41, text: 'outro' }];
  assert.ok(validateSnapshotPlan(PLAN, { beats }).some((p) => /is not covered by any segment/.test(p)));
});

test('cues spoken inside their beats pass; a cue spoken elsewhere is refused', () => {
  const words = [
    { text: '40', start: 1.2, end: 1.5 }, { text: '5', start: 1.6, end: 1.8 },
    { text: '200', start: 6.5, end: 6.8 },
  ];
  assert.deepEqual(validateSnapshotPlan(PLAN, { words }), []);
  const bad = structuredClone(PLAN);
  bad.segments[1].beats[0].action.cue = { 'term-0': '200' }; // 200 is spoken in b2, not b1
  const problems = validateSnapshotPlan(bad, { words });
  assert.ok(problems.some((p) => /"term-0" is cued on "200", which is not spoken in this beat/.test(p)));
});

test('every concept has a recipe', () => {
  for (const c of SNAPSHOT_CONCEPTS) assert.ok(typeof SNAPSHOT_RECIPES[c] === 'function', `${c} recipe`);
});

test('composeSnapshot renders a completed composition inside the safe box', () => {
  const { html, css } = composeSnapshot(PLAN.segments[1], { style: STYLE, width: 1080, height: 1920 });
  assert.ok(html.includes('cx-stage') && html.includes('cx-card'));
  assert.ok(html.includes('>40<') && html.includes('>200<'));
  assert.ok(css.includes('cx-stage'));
  assert.ok(!/background:\s*var\(--brand-blue\)[^"]*border-radius:\s*18px/.test(html), 'no generic 18px card');
});

test('composeSnapshotHTML is a standalone page', () => {
  const html = composeSnapshotHTML({ snapshot: PLAN.segments[2], style: STYLE, width: 1080, height: 1920 });
  assert.ok(html.startsWith('<!doctype html>') && html.includes('id="backdrop"') && html.includes('@iambishir'));
});

test('the plan table is grouped by segment with one row per beat', () => {
  const table = snapshotPlanTable(PLAN);
  assert.ok(table.includes('| Segment | Beat | Time | Spoken | Action | Element |'));
  assert.ok(table.includes('**1 · Hook · footage**'));
  assert.ok(table.includes('**2 · The math**') && table.includes('**3 · CTA**'));
  assert.equal((table.match(/\| b\d /g) ?? []).length, 3);
});

// ---- narration is mandatory + the engine gate ------------------------------

test('narration is mandatory — a video without a script/transcript is refused', () => {
  assert.throws(() => deriveNarrationBeats({ scriptText: null, transcriptJson: null }), /no script/);
  assert.throws(() => deriveNarrationBeats({ scriptText: 'hello', transcriptJson: null }), /no transcript/);
});

test('snapshotPlanApproved is false until the gate is approved', () => {
  const db = freshDb();
  db.prepare("INSERT INTO content_items (title, status) VALUES ('X', 'shot')").run();
  const engine = new ProductionEngine(db, { dataDir: TEST_DATA });
  assert.equal(engine.snapshotPlanApproved(1), false);
  db.prepare(
    "INSERT INTO gates (gate_type, target_type, target_id, requested_by, status, decided_by, decided_at) " +
    "VALUES ('snapshot_plan_review', 'content_item', 1, 'test', 'approved', 'test', datetime('now'))"
  ).run();
  assert.equal(engine.snapshotPlanApproved(1), true);
});

test('approveSnapshotPlan throws when nothing is pending', () => {
  const db = freshDb();
  db.prepare("INSERT INTO content_items (title, status) VALUES ('X', 'shot')").run();
  const engine = new ProductionEngine(db, { dataDir: TEST_DATA });
  assert.throws(() => engine.approveSnapshotPlan({ targetId: 1 }), /no snapshot plan waiting/);
});

test('saveSnapshotPlan requires a segments list', () => {
  const db = freshDb();
  db.prepare("INSERT INTO content_items (title, status) VALUES ('X', 'shot')").run();
  const engine = new ProductionEngine(db, { dataDir: TEST_DATA });
  assert.throws(() => engine.saveSnapshotPlan({ targetId: 1, plan: {} }), /segments list/);
});
