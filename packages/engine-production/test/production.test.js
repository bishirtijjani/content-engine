// Production Engine — post-shoot pipeline tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initDb, makePaths } from '@content-os/core';
import { ProductionEngine } from '../src/index.js';
import { loadStyle } from '../src/style.mjs';

/** A minimal valid segment plan, for the edit/preview gate tests. */
const SNAP_PLAN = {
  video: { id: 'x', duration: 30 },
  segments: [
    {
      id: 's1', kind: 'snapshot', section: 'Start', concept: 'cta', frame: 'full', start: 0, end: 29,
      composition: { text: 'Do the math.', handle: '@x' },
      beats: [{ id: 'b1', start: 0, end: 29, spoken: 'do it', action: { op: 'introduce', target: ['text', 'handle'] }, element: 'cta' }],
    },
  ],
};

/** A throwaway data root — tests must never write into the real data/ dir. */
const TEST_DATA = mkdtempSync(path.join(tmpdir(), 'production-data-'));
/** Clear an item's work in BOTH trees: data/item-<id> and the pre-migration data/compositions/item-<id>. */
const cleanupComposition = (id) => {
  rmSync(path.join(TEST_DATA, `item-${id}`), { recursive: true, force: true });
  rmSync(path.join(TEST_DATA, 'compositions', `item-${id}`), { recursive: true, force: true });
};

function freshDb() {
  const dir = mkdtempSync(path.join(tmpdir(), 'production-engine-'));
  return initDb(path.join(dir, 'test.db'));
}

function approveGateSync(db, gateType, itemId) {
  return db.prepare(
    "INSERT INTO gates (gate_type, target_type, target_id, requested_by, status, decided_by, decided_at) " +
    "VALUES (?, 'content_item', ?, 'test', 'approved', 'test', datetime('now'))"
  ).run(gateType, itemId);
}

function rejectGateSync(db, gateType, itemId) {
  return db.prepare(
    "INSERT INTO gates (gate_type, target_type, target_id, requested_by, status, decided_by, decided_at) " +
    "VALUES (?, 'content_item', ?, 'test', 'rejected', 'human', datetime('now'))"
  ).run(gateType, itemId);
}

/** Attach a recording row (with a real temp file) to an item. */
function attachFootage(db, itemId) {
  db.prepare("INSERT INTO recording_sessions (title) VALUES ('Session')").run();
  const res = db.prepare(
    "INSERT INTO recordings (session_id, file_path, status) VALUES (1, '/tmp/footage.mp4', 'uploaded')"
  ).run();
  const recId = Number(res.lastInsertRowid);
  db.prepare(
    'INSERT INTO content_item_recordings (content_item_id, recording_id, role) VALUES (?, ?, ?)'
  ).run(itemId, recId, 'primary');
  return recId;
}

// ============================================================================
// PROCESS FOOTAGE
// ============================================================================

test('processFootage: transitions ready_to_shoot to shot', () => {
  const db = freshDb();
  db.prepare("INSERT INTO content_items (title, status) VALUES ('Shoot test', 'ready_to_shoot')").run();
  const result = new ProductionEngine(db, { dataDir: TEST_DATA }).processFootage({ targetId: 1 });
  assert.equal(result.processed, 1);
  assert.equal(db.prepare('SELECT status FROM content_items WHERE id = 1').get().status, 'shot');
  db.close();
});

test('processFootage: links recording IDs when provided', () => {
  const db = freshDb();
  db.prepare("INSERT INTO content_items (title, status) VALUES ('Shoot test', 'ready_to_shoot')").run();
  db.prepare("INSERT INTO recording_sessions (title) VALUES ('Session 1')").run();
  db.prepare("INSERT INTO recordings (session_id, file_path) VALUES (1, '/tmp/rec1.mp4')").run();
  db.prepare("INSERT INTO recordings (session_id, file_path) VALUES (1, '/tmp/rec2.mp4')").run();
  const result = new ProductionEngine(db, { dataDir: TEST_DATA }).processFootage({ targetId: 1, recordingIds: [1, 2] });
  assert.equal(result.processed, 1);
  const links = db.prepare('SELECT * FROM content_item_recordings WHERE content_item_id = 1').all();
  assert.equal(links.length, 2);
  db.close();
});

test('processFootage: attaches a file path and creates the recording rows', () => {
  const db = freshDb();
  const dir = mkdtempSync(path.join(tmpdir(), 'footage-'));
  const file = path.join(dir, 'clean.mp4');
  writeFileSync(file, 'x');
  db.prepare("INSERT INTO content_items (title, status) VALUES ('Shoot test', 'ready_to_shoot')").run();
  const result = new ProductionEngine(db, { dataDir: TEST_DATA }).processFootage({ targetId: 1, filePath: file });
  assert.equal(result.processed, 1);
  assert.ok(result.recordingId);
  // The file is ADOPTED into the item's own folder (hardlinked, one copy on
  // disk) so recordings.file_path can never point at wherever the human
  // happened to drop it — and the original is left where it was.
  const adopted = path.join(TEST_DATA, 'item-1', 'source.mp4');
  assert.equal(result.path, adopted);
  const rec = db.prepare('SELECT * FROM recordings WHERE id = ?').get(result.recordingId);
  assert.equal(rec.file_path, adopted);
  assert.ok(existsSync(adopted), 'the item owns its footage now');
  assert.ok(existsSync(file), 'the original file is never touched');
  assert.equal(db.prepare('SELECT status FROM content_items WHERE id = 1').get().status, 'shot');
  db.close();
});

test('processFootage: throws when the file path does not exist', () => {
  const db = freshDb();
  db.prepare("INSERT INTO content_items (title, status) VALUES ('Shoot test', 'ready_to_shoot')").run();
  assert.throws(
    () => new ProductionEngine(db, { dataDir: TEST_DATA }).processFootage({ targetId: 1, filePath: 'nope/missing.mp4' }),
    /footage not found/
  );
  db.close();
});

test('processFootage: skips items not in ready_to_shoot', () => {
  const db = freshDb();
  db.prepare("INSERT INTO content_items (title, status) VALUES ('Not ready', 'scripted')").run();
  const result = new ProductionEngine(db, { dataDir: TEST_DATA }).processFootage({ targetId: 1 });
  assert.equal(result.skipped, 1);
  db.close();
});

test('processFootage: dry-run does not transition', () => {
  const db = freshDb();
  db.prepare("INSERT INTO content_items (title, status) VALUES ('Dry run', 'ready_to_shoot')").run();
  const result = new ProductionEngine(db, { dataDir: TEST_DATA }).processFootage({ targetId: 1, dryRun: true });
  assert.equal(result.processed, 1);
  assert.equal(db.prepare('SELECT status FROM content_items WHERE id = 1').get().status, 'ready_to_shoot');
  db.close();
});

test('processFootage: throws on missing targetId', () => {
  const db = freshDb();
  assert.throws(() => new ProductionEngine(db, { dataDir: TEST_DATA }).processFootage(), /targetId/);
  db.close();
});

test('processFootage: throws on unknown item', () => {
  const db = freshDb();
  assert.throws(() => new ProductionEngine(db, { dataDir: TEST_DATA }).processFootage({ targetId: 99 }), /not found/);
  db.close();
});

test('processFootage: refuses to attach a render as footage', () => {
  const db = freshDb();
  cleanupComposition(1);
  const engine = new ProductionEngine(db, { dataDir: TEST_DATA });
  mkdirSync(engine.rendersDir, { recursive: true });
  const render = path.join(engine.rendersDir, 'item-3.mp4');
  writeFileSync(render, 'rendered');
  db.prepare("INSERT INTO content_items (title, status) VALUES ('Render is not footage', 'ready_to_shoot')").run();
  assert.throws(() => engine.processFootage({ targetId: 1, filePath: render }), /refusing to attach a render as footage/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM recordings').get().n, 0, 'no recording was created');
  db.close();
});

test('listFootage: drop-zone files only — never renders, legacy work, or scratch', () => {
  const db = freshDb();
  const p = makePaths(TEST_DATA);
  mkdirSync(p.inboxDir(), { recursive: true });
  writeFileSync(path.join(p.inboxDir(), 'drop.mp4'), 'x');
  mkdirSync(p.rendersDir(), { recursive: true });
  writeFileSync(path.join(p.rendersDir(), 'item-9.mp4'), 'x');
  mkdirSync(p.tmpDir(), { recursive: true });
  writeFileSync(path.join(p.tmpDir(), 'scratch.mp4'), 'x');
  mkdirSync(p.legacyCompositionsDir(), { recursive: true });
  writeFileSync(path.join(p.legacyCompositionsDir(), 'old.mp4'), 'x');
  mkdirSync(path.join(p.itemDir(5), 'production'), { recursive: true });
  writeFileSync(path.join(p.itemDir(5), 'source.mp4'), 'x');
  writeFileSync(path.join(p.itemDir(5), 'production', 'source.mp4'), 'x');

  const files = new ProductionEngine(db, { dataDir: TEST_DATA }).listFootage().files.map((f) => f.path);
  assert.ok(files.some((f) => f.endsWith('inbox/drop.mp4')), 'the inbox is the drop zone');
  assert.ok(files.some((f) => f.endsWith(path.join('item-5', 'source.mp4'))), 'an attached item source is visible');
  assert.ok(!files.some((f) => f.endsWith(path.join('production', 'source.mp4'))), 'the composition hardlink is not a second file');
  assert.ok(!files.some((f) => f.endsWith('item-9.mp4')), 'a finished video is not waiting footage');
  assert.ok(!files.some((f) => f.endsWith('scratch.mp4')), 'scratch is not footage');
  assert.ok(!files.some((f) => f.endsWith('old.mp4')), 'legacy work is already attached');
  rmSync(p.inboxDir(), { recursive: true, force: true });
  db.close();
});

test('saveSnapshotPlan: the item id is stamped in — a free text id decides nothing', () => {
  const db = freshDb();
  cleanupComposition(1);
  db.prepare("INSERT INTO content_items (title, status) VALUES ('Plan stamp', 'shot')").run();
  const engine = new ProductionEngine(db, { dataDir: TEST_DATA });
  const saved = engine.saveSnapshotPlan({ targetId: 1, plan: { video: { id: 'some-ad-hoc-name' }, segments: [] } });
  const plan = JSON.parse(readFileSync(saved.path, 'utf8'));
  assert.equal(plan.video.item, 1, 'video.item is what the render tools resolve against');
  assert.equal(plan.video.id, 'some-ad-hoc-name', 'the label is kept, it just no longer picks the folder');
  assert.ok(saved.path.includes(path.join('item-1', 'production')), 'it landed in the item tree');
  assert.ok(!existsSync(path.join(TEST_DATA, 'compositions', 'some-ad-hoc-name')), 'and minted no new folder');
  cleanupComposition(1); // leave the shared test root as we found it
  db.close();
});

// ============================================================================
// EDIT
// ============================================================================

test('edit: skips items without footage', () => {
  const db = freshDb();
  db.prepare("INSERT INTO content_items (title, status, video_plan) VALUES ('No footage', 'shot', '{}')").run();
  const result = new ProductionEngine(db, { dataDir: TEST_DATA }).edit({ targetId: 1 });
  assert.equal(result.skipped, 1);
  assert.equal(db.prepare('SELECT status FROM content_items WHERE id = 1').get().status, 'shot');
  db.close();
});

test('edit: skips items without a snapshot plan', () => {
  const db = freshDb();
  db.prepare("INSERT INTO content_items (title, status) VALUES ('No plan', 'shot')").run();
  attachFootage(db, 1);
  const result = new ProductionEngine(db, { dataDir: TEST_DATA }).edit({ targetId: 1 });
  assert.equal(result.skipped, 1);
  assert.equal(result.needsSnapshotPlan, true);
  db.close();
});

test('edit: refuses to build until the snapshot plan is approved', () => {
  const db = freshDb();
  db.prepare("INSERT INTO content_items (title, status) VALUES ('Edit', 'shot')").run();
  attachFootage(db, 1);
  const engine = new ProductionEngine(db, { dataDir: TEST_DATA });
  engine.saveSnapshotPlan({ targetId: 1, plan: SNAP_PLAN });

  const blocked = engine.edit({ targetId: 1, dryRun: true });
  assert.equal(blocked.processed, 0);
  assert.equal(blocked.needsSnapshotPlan, true);

  db.prepare(
    "INSERT INTO gates (gate_type, target_type, target_id, requested_by, status) " +
    "VALUES ('snapshot_plan_review', 'content_item', 1, 'test', 'pending')"
  ).run();
  engine.approveSnapshotPlan({ targetId: 1 });
  const ok = engine.edit({ targetId: 1, dryRun: true });
  assert.equal(ok.processed, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM assets').get().n, 0);
  cleanupComposition(1);
  db.close();
});

test('edit: refuses an invalid snapshot plan and reports why', () => {
  const db = freshDb();
  db.prepare("INSERT INTO content_items (title, status) VALUES ('Bad plan', 'shot')").run();
  attachFootage(db, 1);
  const engine = new ProductionEngine(db, { dataDir: TEST_DATA });
  const bad = structuredClone(SNAP_PLAN);
  bad.segments[0].concept = 'nope';
  engine.saveSnapshotPlan({ targetId: 1, plan: bad });
  const result = engine.edit({ targetId: 1 });
  assert.equal(result.skipped, 1);
  assert.ok(result.problems.some((p) => /is not a snapshot concept/.test(p)));
  cleanupComposition(1);
  db.close();
});

test('edit: skips items not in shot status', () => {
  const db = freshDb();
  db.prepare("INSERT INTO content_items (title, status, video_plan) VALUES ('Wrong', 'ready_to_shoot', '{}')").run();
  const result = new ProductionEngine(db, { dataDir: TEST_DATA }).edit({ targetId: 1 });
  assert.equal(result.skipped, 1);
  db.close();
});

test('edit: throws on missing targetId', () => {
  const db = freshDb();
  assert.throws(() => new ProductionEngine(db, { dataDir: TEST_DATA }).edit(), /targetId/);
  db.close();
});

// ============================================================================
// REQUEST REVIEW
// ============================================================================

test('requestReview: requests asset_review gate for editing items', () => {
  const db = freshDb();
  db.prepare("INSERT INTO content_items (title, status) VALUES ('Review', 'editing')").run();
  const result = new ProductionEngine(db, { dataDir: TEST_DATA }).requestReview({ targetId: 1 });
  assert.equal(result.processed, 1);
  const gate = db.prepare('SELECT gate_type, status FROM gates WHERE target_id = 1').get();
  assert.equal(gate.gate_type, 'asset_review');
  assert.equal(gate.status, 'pending');
  db.close();
});

test('requestReview: skips items not in editing', () => {
  const db = freshDb();
  db.prepare("INSERT INTO content_items (title, status) VALUES ('Wrong', 'shot')").run();
  assert.equal(new ProductionEngine(db, { dataDir: TEST_DATA }).requestReview({ targetId: 1 }).skipped, 1);
  db.close();
});

test('requestReview: skips if a gate is already pending', () => {
  const db = freshDb();
  db.prepare("INSERT INTO content_items (title, status) VALUES ('Pending', 'editing')").run();
  db.prepare(
    "INSERT INTO gates (gate_type, target_type, target_id, requested_by, status) " +
    "VALUES ('asset_review', 'content_item', 1, 'engine', 'pending')"
  ).run();
  assert.equal(new ProductionEngine(db, { dataDir: TEST_DATA }).requestReview({ targetId: 1 }).skipped, 1);
  db.close();
});

test('requestReview: dry-run does not create a gate', () => {
  const db = freshDb();
  db.prepare("INSERT INTO content_items (title, status) VALUES ('Dry', 'editing')").run();
  assert.equal(new ProductionEngine(db, { dataDir: TEST_DATA }).requestReview({ targetId: 1, dryRun: true }).processed, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM gates').get().n, 0);
  db.close();
});

// ============================================================================
// RESUBMIT
// ============================================================================

test('resubmit: requests a fresh gate after rejection', () => {
  const db = freshDb();
  db.prepare("INSERT INTO content_items (title, status) VALUES ('Rejected', 'editing')").run();
  rejectGateSync(db, 'asset_review', 1);
  const result = new ProductionEngine(db, { dataDir: TEST_DATA }).resubmit({ targetId: 1 });
  assert.equal(result.processed, 1);
  const gates = db.prepare('SELECT status FROM gates WHERE target_id = 1 ORDER BY id').all();
  assert.deepEqual(gates.map((g) => g.status), ['rejected', 'pending']);
  db.close();
});

test('resubmit: refuses missing target, unknown item, wrong status, or no rejection', () => {
  const db = freshDb();
  db.prepare("INSERT INTO content_items (title, status) VALUES ('Still shot', 'shot')").run();
  db.prepare("INSERT INTO content_items (title, status) VALUES ('Editing clean', 'editing')").run();
  const engine = new ProductionEngine(db, { dataDir: TEST_DATA });
  assert.throws(() => engine.resubmit(), /targetId/);
  assert.throws(() => engine.resubmit({ targetId: 99 }), /not found/);
  assert.throws(() => engine.resubmit({ targetId: 1 }), /expected 'editing'/);
  assert.throws(() => engine.resubmit({ targetId: 2 }), /no asset_review gate to resubmit/);
  db.close();
});

// ============================================================================
// SCHEDULE
// ============================================================================

test('schedule: moves an approved item to scheduled', () => {
  const db = freshDb();
  db.prepare("INSERT INTO content_items (title, status) VALUES ('Ready', 'editing')").run();
  approveGateSync(db, 'asset_review', 1);
  const result = new ProductionEngine(db, { dataDir: TEST_DATA }).schedule({ targetId: 1 });
  assert.equal(result.processed, 1);
  assert.equal(db.prepare('SELECT status FROM content_items WHERE id = 1').get().status, 'scheduled');
  db.close();
});

test('schedule: refuses without an approved gate', () => {
  const db = freshDb();
  db.prepare("INSERT INTO content_items (title, status) VALUES ('No gate', 'editing')").run();
  assert.throws(() => new ProductionEngine(db, { dataDir: TEST_DATA }).schedule({ targetId: 1 }), /asset_review/);
  db.close();
});

// ============================================================================
// RUN / PIPELINE / SURVEY
// ============================================================================

test('run: throws on unknown action', () => {
  const db = freshDb();
  assert.throws(() => new ProductionEngine(db, { dataDir: TEST_DATA }).run({ action: 'bogus' }), /unknown production action/);
  db.close();
});

test('run: dispatches to a specific action', () => {
  const db = freshDb();
  db.prepare("INSERT INTO content_items (title, status) VALUES ('Dispatch', 'ready_to_shoot')").run();
  const result = new ProductionEngine(db, { dataDir: TEST_DATA }).run({ action: 'process_footage', targetId: 1 });
  assert.equal(result.processed, 1);
  db.close();
});

test('pipeline: handles an empty database gracefully', () => {
  const db = freshDb();
  const result = new ProductionEngine(db, { dataDir: TEST_DATA }).pipeline();
  assert.equal(result.process_footage.processed, 0);
  assert.equal(result.edit.processed, 0);
  assert.equal(result.request_review.processed, 0);
  db.close();
});

test('surveyItems: counts items in owned states', () => {
  const db = freshDb();
  db.prepare("INSERT INTO content_items (title, status) VALUES ('Shot 1', 'shot')").run();
  db.prepare("INSERT INTO content_items (title, status) VALUES ('Shot 2', 'shot')").run();
  db.prepare("INSERT INTO content_items (title, status) VALUES ('Editing 1', 'editing')").run();
  db.prepare("INSERT INTO content_items (title, status) VALUES ('Idea', 'idea')").run();
  const counts = new ProductionEngine(db, { dataDir: TEST_DATA }).surveyItems();
  assert.equal(counts.shot, 2);
  assert.equal(counts.editing, 1);
  db.close();
});

// ============================================================================
// MENU
// ============================================================================

test('menu: exposes the segment model, concepts, actions and icons', () => {
  const db = freshDb();
  const m = new ProductionEngine(db, { dataDir: TEST_DATA }).menu();
  assert.equal(m.plan.model.startsWith('Video -> Segments -> Beats'), true);
  assert.deepEqual(m.plan.segmentKinds, ['footage', 'snapshot', 'clip']);
  assert.ok(m.plan.clip.includes('sourceIn'));
  assert.ok(m.plan.snapshotConcepts.includes('equation'));
  assert.ok(m.plan.beatActions.includes('introduce'));
  assert.ok(m.icons.count > 100);
  assert.deepEqual(m.frames.map((f) => f.name).sort(), ['center', 'full', 'left', 'right']);
  db.close();
});

test('menu: orients to the target item\'s footage', () => {
  const db = freshDb();
  const dir = mkdtempSync(path.join(tmpdir(), 'footage-'));
  const file = path.join(dir, 'myvideo.mp4');
  writeFileSync(file, 'x');
  db.prepare("INSERT INTO content_items (title, status) VALUES ('Menu', 'shot')").run();
  const engine = new ProductionEngine(db, { dataDir: TEST_DATA });
  engine.processFootage({ targetId: 1, filePath: file });
  engine._probe = () => ({ width: 720, height: 1280, duration: 60, audioOnly: false });
  const m = engine.menu({ targetId: 1 });
  assert.ok(m.plan && m.icons);
  db.close();
});

test('edit/preview refuse until the snapshot plan is approved', () => {
  const db = freshDb();
  db.prepare("INSERT INTO content_items (title, status) VALUES ('Gate', 'shot')").run();
  attachFootage(db, 1);
  const engine = new ProductionEngine(db, { dataDir: TEST_DATA });
  engine.saveSnapshotPlan({ targetId: 1, plan: SNAP_PLAN });

  const blocked = engine.edit({ targetId: 1 });
  assert.equal(blocked.processed, 0);
  assert.equal(blocked.needsSnapshotPlan, true);

  const prev = engine.preview({ targetId: 1 });
  assert.equal(prev.processed, 0);
  assert.equal(prev.needsSnapshotPlan, true);

  approveGateSync(db, 'snapshot_plan_review', 1);
  assert.equal(engine.snapshotPlanApproved(1), true);
  cleanupComposition(1);
  db.close();
});

// ============================================================================
// CLIP MEDIA
// ============================================================================

test('_clipMediaProblems: refuses a missing clip source', () => {
  const db = freshDb();
  const engine = new ProductionEngine(db, { dataDir: TEST_DATA });
  const problems = engine._clipMediaProblems({
    segments: [{ id: 'c1', kind: 'clip', src: path.join(TEST_DATA, 'missing-clip.mp4'), start: 0, end: 1 }],
  });
  assert.ok(problems.some((p) => /\(clip\) source not found/.test(p)));
  db.close();
});

test('_clipMediaProblems: refuses a non-video clip source', () => {
  const db = freshDb();
  const engine = new ProductionEngine(db, { dataDir: TEST_DATA });
  const notVideo = path.join(TEST_DATA, 'clip-source.txt');
  writeFileSync(notVideo, 'not a video');
  const problems = engine._clipMediaProblems({
    segments: [{ id: 'c1', kind: 'clip', src: notVideo, start: 0, end: 1 }],
  });
  assert.ok(problems.some((p) => /\(clip\) is not a video/.test(p)));
  db.close();
});

// ============================================================================
// ORIENTATION
// ============================================================================

test('_resolveOrientation: defaults to the footage orientation', () => {
  const db = freshDb();
  const engine = new ProductionEngine(db, { dataDir: TEST_DATA });
  assert.equal(engine._resolveOrientation({}, { width: 720, height: 1280 }), 'portrait');
  assert.equal(engine._resolveOrientation({}, { width: 1920, height: 1080 }), 'landscape');
  assert.equal(engine._resolveOrientation({}, { width: 0, height: 0 }), 'landscape');
  db.close();
});

test('_resolveOrientation: a plan override wins over the source', () => {
  const db = freshDb();
  const engine = new ProductionEngine(db, { dataDir: TEST_DATA });
  assert.equal(engine._resolveOrientation({ output: { orientation: 'landscape' } }, { width: 720, height: 1280 }), 'landscape');
  assert.equal(engine._resolveOrientation({ output: { orientation: 'portrait' } }, { width: 1920, height: 1080 }), 'portrait');
  db.close();
});

test('_fitFor: contain only when the canvas differs from the source', () => {
  const db = freshDb();
  const engine = new ProductionEngine(db, { dataDir: TEST_DATA });
  assert.equal(engine._fitFor('portrait', { width: 720, height: 1280 }), 'cover');
  assert.equal(engine._fitFor('landscape', { width: 1920, height: 1080 }), 'cover');
  assert.equal(engine._fitFor('landscape', { width: 720, height: 1280 }), 'contain');
  assert.equal(engine._fitFor('portrait', { width: 1920, height: 1080 }), 'contain');
  db.close();
});

test('_renderDims: portrait footage picks the portrait canvas', () => {
  const db = freshDb();
  const engine = new ProductionEngine(db, { dataDir: TEST_DATA });
  const style = loadStyle();
  const portrait = engine._renderDims(style, 'final', { width: 720, height: 1280 }, 'portrait');
  assert.deepEqual([portrait.width, portrait.height], [1080, 1920]);
  const landscape = engine._renderDims(style, 'final', { width: 1920, height: 1080 }, 'landscape');
  assert.deepEqual([landscape.width, landscape.height], [1920, 1080]);
  const prev = engine._renderDims(style, 'preview', { width: 720, height: 1280 }, 'portrait');
  assert.deepEqual([prev.width, prev.height], [270, 480]);
  db.close();
});
