// Production Engine — post-shoot pipeline tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initDb } from '@content-os/core';
import { ProductionEngine } from '../src/index.js';

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
  const result = new ProductionEngine(db).processFootage({ targetId: 1 });
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
  const result = new ProductionEngine(db).processFootage({ targetId: 1, recordingIds: [1, 2] });
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
  const result = new ProductionEngine(db).processFootage({ targetId: 1, filePath: file });
  assert.equal(result.processed, 1);
  assert.ok(result.recordingId);
  const rec = db.prepare('SELECT * FROM recordings WHERE id = ?').get(result.recordingId);
  assert.equal(rec.file_path, file);
  assert.equal(db.prepare('SELECT status FROM content_items WHERE id = 1').get().status, 'shot');
  db.close();
});

test('processFootage: throws when the file path does not exist', () => {
  const db = freshDb();
  db.prepare("INSERT INTO content_items (title, status) VALUES ('Shoot test', 'ready_to_shoot')").run();
  assert.throws(
    () => new ProductionEngine(db).processFootage({ targetId: 1, filePath: 'nope/missing.mp4' }),
    /footage not found/
  );
  db.close();
});

test('processFootage: skips items not in ready_to_shoot', () => {
  const db = freshDb();
  db.prepare("INSERT INTO content_items (title, status) VALUES ('Not ready', 'scripted')").run();
  const result = new ProductionEngine(db).processFootage({ targetId: 1 });
  assert.equal(result.skipped, 1);
  db.close();
});

test('processFootage: dry-run does not transition', () => {
  const db = freshDb();
  db.prepare("INSERT INTO content_items (title, status) VALUES ('Dry run', 'ready_to_shoot')").run();
  const result = new ProductionEngine(db).processFootage({ targetId: 1, dryRun: true });
  assert.equal(result.processed, 1);
  assert.equal(db.prepare('SELECT status FROM content_items WHERE id = 1').get().status, 'ready_to_shoot');
  db.close();
});

test('processFootage: throws on missing targetId', () => {
  const db = freshDb();
  assert.throws(() => new ProductionEngine(db).processFootage(), /targetId/);
  db.close();
});

test('processFootage: throws on unknown item', () => {
  const db = freshDb();
  assert.throws(() => new ProductionEngine(db).processFootage({ targetId: 99 }), /not found/);
  db.close();
});

test('listFootage: returns a files list', () => {
  const db = freshDb();
  const result = new ProductionEngine(db).listFootage();
  assert.ok(Array.isArray(result.files));
  db.close();
});

// ============================================================================
// EDIT
// ============================================================================

test('edit: skips items without footage', () => {
  const db = freshDb();
  db.prepare("INSERT INTO content_items (title, status, video_plan) VALUES ('No footage', 'shot', '{}')").run();
  const result = new ProductionEngine(db).edit({ targetId: 1 });
  assert.equal(result.skipped, 1);
  assert.equal(db.prepare('SELECT status FROM content_items WHERE id = 1').get().status, 'shot');
  db.close();
});

test('edit: skips items without an agent-written plan', () => {
  const db = freshDb();
  db.prepare("INSERT INTO content_items (title, status) VALUES ('No plan', 'shot')").run();
  attachFootage(db, 1);
  const result = new ProductionEngine(db).edit({ targetId: 1 });
  assert.equal(result.skipped, 1);
  db.close();
});

test('edit: dry-run processes with footage and a valid plan', () => {
  const db = freshDb();
  db.prepare("INSERT INTO content_items (title, status, video_plan) VALUES ('Edit', 'shot', '{}')").run();
  attachFootage(db, 1);
  approveGateSync(db, 'plan_review', 1);
  const result = new ProductionEngine(db).edit({ targetId: 1, dryRun: true });
  assert.equal(result.processed, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM assets').get().n, 0);
  db.close();
});

test('edit: refuses an off-style plan and reports why', () => {
  const db = freshDb();
  const badPlan = JSON.stringify({ overlays: [{ kind: 'visual', asset: 'visuals/missing', start: 0, end: 2, why: 'show it' }] });
  db.prepare("INSERT INTO content_items (title, status, video_plan) VALUES ('Bad plan', 'shot', ?)").run(badPlan);
  attachFootage(db, 1);
  const result = new ProductionEngine(db).edit({ targetId: 1 });
  assert.equal(result.skipped, 1);
  assert.ok(result.problems.some((p) => /not in the library/.test(p)));
  db.close();
});

test('edit: skips items not in shot status', () => {
  const db = freshDb();
  db.prepare("INSERT INTO content_items (title, status, video_plan) VALUES ('Wrong', 'ready_to_shoot', '{}')").run();
  const result = new ProductionEngine(db).edit({ targetId: 1 });
  assert.equal(result.skipped, 1);
  db.close();
});

test('edit: throws on missing targetId', () => {
  const db = freshDb();
  assert.throws(() => new ProductionEngine(db).edit(), /targetId/);
  db.close();
});

// ============================================================================
// REQUEST REVIEW
// ============================================================================

test('requestReview: requests asset_review gate for editing items', () => {
  const db = freshDb();
  db.prepare("INSERT INTO content_items (title, status) VALUES ('Review', 'editing')").run();
  const result = new ProductionEngine(db).requestReview({ targetId: 1 });
  assert.equal(result.processed, 1);
  const gate = db.prepare('SELECT gate_type, status FROM gates WHERE target_id = 1').get();
  assert.equal(gate.gate_type, 'asset_review');
  assert.equal(gate.status, 'pending');
  db.close();
});

test('requestReview: skips items not in editing', () => {
  const db = freshDb();
  db.prepare("INSERT INTO content_items (title, status) VALUES ('Wrong', 'shot')").run();
  assert.equal(new ProductionEngine(db).requestReview({ targetId: 1 }).skipped, 1);
  db.close();
});

test('requestReview: skips if a gate is already pending', () => {
  const db = freshDb();
  db.prepare("INSERT INTO content_items (title, status) VALUES ('Pending', 'editing')").run();
  db.prepare(
    "INSERT INTO gates (gate_type, target_type, target_id, requested_by, status) " +
    "VALUES ('asset_review', 'content_item', 1, 'engine', 'pending')"
  ).run();
  assert.equal(new ProductionEngine(db).requestReview({ targetId: 1 }).skipped, 1);
  db.close();
});

test('requestReview: dry-run does not create a gate', () => {
  const db = freshDb();
  db.prepare("INSERT INTO content_items (title, status) VALUES ('Dry', 'editing')").run();
  assert.equal(new ProductionEngine(db).requestReview({ targetId: 1, dryRun: true }).processed, 1);
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
  const result = new ProductionEngine(db).resubmit({ targetId: 1 });
  assert.equal(result.processed, 1);
  const gates = db.prepare('SELECT status FROM gates WHERE target_id = 1 ORDER BY id').all();
  assert.deepEqual(gates.map((g) => g.status), ['rejected', 'pending']);
  db.close();
});

test('resubmit: refuses missing target, unknown item, wrong status, or no rejection', () => {
  const db = freshDb();
  db.prepare("INSERT INTO content_items (title, status) VALUES ('Still shot', 'shot')").run();
  db.prepare("INSERT INTO content_items (title, status) VALUES ('Editing clean', 'editing')").run();
  const engine = new ProductionEngine(db);
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
  const result = new ProductionEngine(db).schedule({ targetId: 1 });
  assert.equal(result.processed, 1);
  assert.equal(db.prepare('SELECT status FROM content_items WHERE id = 1').get().status, 'scheduled');
  db.close();
});

test('schedule: refuses without an approved gate', () => {
  const db = freshDb();
  db.prepare("INSERT INTO content_items (title, status) VALUES ('No gate', 'editing')").run();
  assert.throws(() => new ProductionEngine(db).schedule({ targetId: 1 }), /asset_review/);
  db.close();
});

// ============================================================================
// RUN / PIPELINE / SURVEY
// ============================================================================

test('run: throws on unknown action', () => {
  const db = freshDb();
  assert.throws(() => new ProductionEngine(db).run({ action: 'bogus' }), /unknown production action/);
  db.close();
});

test('run: dispatches to a specific action', () => {
  const db = freshDb();
  db.prepare("INSERT INTO content_items (title, status) VALUES ('Dispatch', 'ready_to_shoot')").run();
  const result = new ProductionEngine(db).run({ action: 'process_footage', targetId: 1 });
  assert.equal(result.processed, 1);
  db.close();
});

test('pipeline: handles an empty database gracefully', () => {
  const db = freshDb();
  const result = new ProductionEngine(db).pipeline();
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
  const counts = new ProductionEngine(db).surveyItems();
  assert.equal(counts.shot, 2);
  assert.equal(counts.editing, 1);
  db.close();
});

// ============================================================================
// MAKE SHORT
// ============================================================================

test('makeShort: requires numeric start and end', () => {
  const db = freshDb();
  const engine = new ProductionEngine(db);
  assert.throws(() => engine.makeShort({ targetId: 1 }), /start, end/);
  assert.throws(() => engine.makeShort({ targetId: 1, start: 5, end: 5 }), /end after start/);
  db.close();
});

test('makeShort: skips items without footage', () => {
  const db = freshDb();
  db.prepare("INSERT INTO content_items (title, status) VALUES ('No footage', 'editing')").run();
  const result = new ProductionEngine(db).makeShort({ targetId: 1, start: 5, end: 20 });
  assert.equal(result.skipped, 1);
  db.close();
});

test('makeShort: dry-run reports what it would cut', () => {
  const db = freshDb();
  db.prepare("INSERT INTO content_items (title, status) VALUES ('Short', 'editing')").run();
  attachFootage(db, 1);
  const result = new ProductionEngine(db).makeShort({ targetId: 1, start: 270, end: 315, dryRun: true });
  assert.equal(result.processed, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM assets').get().n, 0);
  db.close();
});

// ============================================================================
// MENU / PLAN
// ============================================================================

test('menu: lists the four frames and the templates', () => {
  const db = freshDb();
  const m = new ProductionEngine(db).menu();
  assert.deepEqual(m.frames.map((f) => f.name).sort(), ['center', 'full', 'left', 'right']);
  assert.ok(m.templates.some((t) => t.name === 'stat-callout' && t.frame === 'center'));
  assert.ok(Array.isArray(m.sfx));
  db.close();
});

test('menu: with a target lists that video\'s visuals folder', () => {
  const db = freshDb();
  const dir = mkdtempSync(path.join(tmpdir(), 'footage-'));
  const file = path.join(dir, 'myvideo.mp4');
  writeFileSync(file, 'x');
  db.prepare("INSERT INTO content_items (title, status) VALUES ('Menu', 'shot')").run();
  const engine = new ProductionEngine(db);
  const attached = engine.processFootage({ targetId: 1, filePath: file });
  writeFileSync(path.join(attached.visualsDir, 'dashboard.png'), 'x');
  const m = engine.menu({ targetId: 1 });
  assert.ok(m.visuals.some((v) => v.file.endsWith('dashboard.png')));
  db.close();
});

test('savePlan: stores a builder-made plan', () => {
  const db = freshDb();
  db.prepare("INSERT INTO content_items (title, status) VALUES ('Plan', 'shot')").run();
  attachFootage(db, 1);
  const engine = new ProductionEngine(db);
  const plan = engine.newPlan()
    .caption({ emphasis: ['automated'] })
    .graphic({ at: [8, 12], name: 'stat-callout', fields: { value: '8 hrs', label: 'saved' }, why: 'show the hours saved' });
  const result = engine.savePlan({ targetId: 1, plan });
  assert.equal(result.saved, true);
  const stored = JSON.parse(db.prepare('SELECT video_plan FROM content_items WHERE id = 1').get().video_plan);
  assert.equal(stored.overlays.length, 1);
  assert.deepEqual(stored.captions.emphasis, ['automated']);
  db.close();
});

test('savePlan: refuses an off-style plan', () => {
  const db = freshDb();
  db.prepare("INSERT INTO content_items (title, status) VALUES ('Bad plan', 'shot')").run();
  attachFootage(db, 1);
  const engine = new ProductionEngine(db);
  const plan = engine.newPlan().visual({ at: [1, 4], file: 'data/x.png', why: 'show it', frame: 'corner' });
  const result = engine.savePlan({ targetId: 1, plan });
  assert.equal(result.saved, false);
  assert.ok(result.problems.some((p) => /frame must be one of/.test(p)));
  assert.equal(db.prepare('SELECT video_plan FROM content_items WHERE id = 1').get().video_plan, null);
  db.close();
});

test('savePlan: throws without a target', () => {
  const db = freshDb();
  assert.throws(() => new ProductionEngine(db).savePlan({ plan: {} }), /targetId/);
  db.close();
});

test('reviewPlan: opens a plan_review gate and returns the board', () => {
  const db = freshDb();
  db.prepare("INSERT INTO content_items (title, status) VALUES ('Board', 'shot')").run();
  const engine = new ProductionEngine(db);
  engine.savePlan({
    targetId: 1,
    plan: { captions: { emphasis: ['automate'] }, overlays: [{ kind: 'graphic', name: 'key-point', start: 8, end: 12, why: 'land the point', fields: { line: 'Automate the work' } }], zooms: [], sfx: [] },
  });
  const r = engine.reviewPlan({ targetId: 1 });
  assert.equal(r.processed, 1);
  assert.equal(r.board.overlays.length, 1);
  assert.equal(r.board.overlays[0].frame, 'center');
  assert.deepEqual(r.board.emphasis, ['automate']);
  const gate = db.prepare("SELECT status FROM gates WHERE gate_type = 'plan_review' AND target_id = 1").get();
  assert.equal(gate.status, 'pending');
  db.close();
});

test('edit/preview refuse until the plan_review gate is approved', () => {
  const db = freshDb();
  db.prepare("INSERT INTO content_items (title, status) VALUES ('Gate', 'shot')").run();
  attachFootage(db, 1);
  const engine = new ProductionEngine(db);
  engine.savePlan({
    targetId: 1,
    plan: { captions: {}, overlays: [], zooms: [], sfx: [] },
  });

  const blocked = engine.edit({ targetId: 1 });
  assert.equal(blocked.processed, 0);
  assert.equal(blocked.needsPlanReview, true);
  assert.ok(blocked.board);

  approveGateSync(db, 'plan_review', 1);
  assert.equal(engine._planReviewApproved(1), true);
  db.close();
});
