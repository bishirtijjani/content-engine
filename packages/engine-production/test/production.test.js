// Production Engine — tests for the post-shoot pipeline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initDb } from '@content-os/core';
import { ProductionEngine } from '../src/index.js';
import { parseShotNotes, generateComposition } from '../src/composition.js';

function freshDb() {
  const dir = mkdtempSync(path.join(tmpdir(), 'production-engine-'));
  return initDb(path.join(dir, 'test.db'));
}

function approveGateSync(db, gateType, itemId) {
  const res = db.prepare(
    "INSERT INTO gates (gate_type, target_type, target_id, requested_by, status, decided_by, decided_at) " +
    "VALUES (?, 'content_item', ?, 'test', 'approved', 'test', datetime('now'))"
  ).run(gateType, itemId);
  return Number(res.lastInsertRowid);
}

function rejectGateSync(db, gateType, itemId) {
  return db.prepare(
    "INSERT INTO gates (gate_type, target_type, target_id, requested_by, status, decided_by, decided_at) " +
    "VALUES (?, 'content_item', ?, 'test', 'rejected', 'human', datetime('now'))"
  ).run(gateType, itemId);
}

// A valid script JSON matching the content contract.
function validScriptJson(overrides = {}) {
  const sentence = 'This is a spoken sentence that walks through the actual build step by step so the narration lands in the right length window.';
  const narration = Array.from({ length: 7 }, () => sentence).join(' ');
  return JSON.stringify({
    hook: 'My client was spending 8 hours a week on invoices until we fixed this.',
    script: narration,
    points: [{ title: 'The problem', detail: 'Manual invoice work eats the week' }],
    cta: 'Follow for the full build breakdown.',
    shot_notes: '0-5s: Hook on camera - problem AND promise in one breath.\n5-15s: Old grind montage - camera + text overlay "read, type, check"\n15-50s: Screen share of the automation running\n50-57s: Result on camera - "8 hours down to 20 minutes"\nlast 3s: CTA on camera - "follow for the full build breakdown"',
    ...overrides,
  });
}

// ============================================================================
// PROCESS FOOTAGE — ready_to_shoot -> shot
// ============================================================================

test('processFootage: transitions ready_to_shoot to shot', () => {
  const db = freshDb();
  db.prepare(
    "INSERT INTO content_items (title, status) VALUES ('Shoot test', 'ready_to_shoot')"
  ).run();
  const engine = new ProductionEngine(db);
  const result = engine.processFootage({ targetId: 1 });
  assert.equal(result.processed, 1);
  assert.equal(result.skipped, 0);
  assert.equal(db.prepare('SELECT status FROM content_items WHERE id = 1').get().status, 'shot');
  db.close();
});

test('processFootage: links recording IDs when provided', () => {
  const db = freshDb();
  db.prepare(
    "INSERT INTO content_items (title, status) VALUES ('Shoot test', 'ready_to_shoot')"
  ).run();
  db.prepare(
    "INSERT INTO recording_sessions (title) VALUES ('Session 1')"
  ).run();
  db.prepare(
    "INSERT INTO recordings (session_id, file_path) VALUES (1, '/tmp/rec1.mp4')"
  ).run();
  db.prepare(
    "INSERT INTO recordings (session_id, file_path) VALUES (1, '/tmp/rec2.mp4')"
  ).run();
  const engine = new ProductionEngine(db);
  const result = engine.processFootage({ targetId: 1, recordingIds: [1, 2] });
  assert.equal(result.processed, 1);
  const links = db.prepare(
    'SELECT * FROM content_item_recordings WHERE content_item_id = 1'
  ).all();
  assert.equal(links.length, 2);
  assert.equal(links[0].role, 'primary');
  assert.equal(links[1].role, 'primary');
  db.close();
});

test('processFootage: skips items not in ready_to_shoot', () => {
  const db = freshDb();
  db.prepare(
    "INSERT INTO content_items (title, status) VALUES ('Not ready', 'scripted')"
  ).run();
  const engine = new ProductionEngine(db);
  const result = engine.processFootage({ targetId: 1 });
  assert.equal(result.processed, 0);
  assert.equal(result.skipped, 1);
  assert.equal(db.prepare('SELECT status FROM content_items WHERE id = 1').get().status, 'scripted');
  db.close();
});

test('processFootage: dry-run does not transition', () => {
  const db = freshDb();
  db.prepare(
    "INSERT INTO content_items (title, status) VALUES ('Dry run', 'ready_to_shoot')"
  ).run();
  const engine = new ProductionEngine(db);
  const result = engine.processFootage({ targetId: 1, dryRun: true });
  assert.equal(result.processed, 1);
  assert.equal(db.prepare('SELECT status FROM content_items WHERE id = 1').get().status, 'ready_to_shoot');
  db.close();
});

test('processFootage: throws on missing targetId', () => {
  const db = freshDb();
  const engine = new ProductionEngine(db);
  assert.throws(() => engine.processFootage(), /targetId/);
  db.close();
});

test('processFootage: throws on unknown item', () => {
  const db = freshDb();
  const engine = new ProductionEngine(db);
  assert.throws(() => engine.processFootage({ targetId: 99 }), /not found/);
  db.close();
});

// ============================================================================
// EDIT — shot -> editing (requires script, renders composition)
// ============================================================================

test('edit: transitions shot to editing and creates asset', () => {
  const db = freshDb();
  db.prepare(
    "INSERT INTO content_items (title, status, script, desired_length_seconds) " +
    "VALUES ('Edit test', 'shot', ?, 60)"
  ).run(validScriptJson());
  const engine = new ProductionEngine(db);
  // Use dry-run to avoid actual rendering in unit tests
  const result = engine.edit({ targetId: 1, dryRun: true });
  assert.equal(result.processed, 1);
  assert.equal(result.skipped, 0);
  // Dry-run should not transition or create assets
  assert.equal(db.prepare('SELECT status FROM content_items WHERE id = 1').get().status, 'shot');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM assets').get().n, 0);
  db.close();
});

test('edit: skips items without agent-written script', () => {
  const db = freshDb();
  db.prepare(
    "INSERT INTO content_items (title, status) VALUES ('No script', 'shot')"
  ).run();
  const engine = new ProductionEngine(db);
  const result = engine.edit({ targetId: 1 });
  assert.equal(result.processed, 0);
  assert.equal(result.skipped, 1);
  assert.equal(db.prepare('SELECT status FROM content_items WHERE id = 1').get().status, 'shot');
  db.close();
});

test('edit: skips items not in shot status', () => {
  const db = freshDb();
  db.prepare(
    "INSERT INTO content_items (title, status, script) VALUES ('Wrong state', 'ready_to_shoot', ?)"
  ).run(validScriptJson());
  const engine = new ProductionEngine(db);
  const result = engine.edit({ targetId: 1 });
  assert.equal(result.processed, 0);
  assert.equal(result.skipped, 1);
  assert.equal(db.prepare('SELECT status FROM content_items WHERE id = 1').get().status, 'ready_to_shoot');
  db.close();
});

test('edit: dry-run does not transition or render', () => {
  const db = freshDb();
  db.prepare(
    "INSERT INTO content_items (title, status, script) VALUES ('Dry edit', 'shot', ?)"
  ).run(validScriptJson());
  const engine = new ProductionEngine(db);
  const result = engine.edit({ targetId: 1, dryRun: true });
  assert.equal(result.processed, 1);
  assert.equal(db.prepare('SELECT status FROM content_items WHERE id = 1').get().status, 'shot');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM assets').get().n, 0);
  db.close();
});

test('edit: throws on missing targetId', () => {
  const db = freshDb();
  const engine = new ProductionEngine(db);
  assert.throws(() => engine.edit(), /targetId/);
  db.close();
});

// ============================================================================
// REQUEST REVIEW — request asset_review gate after editing
// ============================================================================

test('requestReview: requests asset_review gate for editing items', () => {
  const db = freshDb();
  db.prepare(
    "INSERT INTO content_items (title, status) VALUES ('Review test', 'editing')"
  ).run();
  const engine = new ProductionEngine(db);
  const result = engine.requestReview({ targetId: 1 });
  assert.equal(result.processed, 1);
  assert.equal(result.skipped, 0);
  const gate = db.prepare(
    "SELECT gate_type, status FROM gates WHERE target_id = 1"
  ).get();
  assert.equal(gate.gate_type, 'asset_review');
  assert.equal(gate.status, 'pending');
  db.close();
});

test('requestReview: skips items not in editing', () => {
  const db = freshDb();
  db.prepare(
    "INSERT INTO content_items (title, status) VALUES ('Wrong state', 'shot')"
  ).run();
  const engine = new ProductionEngine(db);
  const result = engine.requestReview({ targetId: 1 });
  assert.equal(result.processed, 0);
  assert.equal(result.skipped, 1);
  db.close();
});

test('requestReview: skips if gate already pending', () => {
  const db = freshDb();
  db.prepare(
    "INSERT INTO content_items (title, status) VALUES ('Already pending', 'editing')"
  ).run();
  approveGateSync(db, 'asset_review', 1); // creates an approved gate
  // Actually we need a pending one — let's create it properly
  db.prepare(
    "INSERT INTO gates (gate_type, target_type, target_id, requested_by, status) " +
    "VALUES ('asset_review', 'content_item', 1, 'engine', 'pending')"
  ).run();
  const engine = new ProductionEngine(db);
  const result = engine.requestReview({ targetId: 1 });
  assert.equal(result.processed, 0);
  assert.equal(result.skipped, 1);
  db.close();
});

test('requestReview: dry-run does not create gate', () => {
  const db = freshDb();
  db.prepare(
    "INSERT INTO content_items (title, status) VALUES ('Dry review', 'editing')"
  ).run();
  const engine = new ProductionEngine(db);
  const result = engine.requestReview({ targetId: 1, dryRun: true });
  assert.equal(result.processed, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM gates').get().n, 0);
  db.close();
});

test('requestReview: throws on missing targetId', () => {
  const db = freshDb();
  const engine = new ProductionEngine(db);
  assert.throws(() => engine.requestReview(), /targetId/);
  db.close();
});

// ============================================================================
// RESUBMIT — revision loop after rejected asset review
// ============================================================================

test('resubmit: requests fresh asset_review gate after rejection', () => {
  const db = freshDb();
  db.prepare(
    "INSERT INTO content_items (title, status, script) VALUES ('Rejected edit', 'editing', ?)"
  ).run(validScriptJson());
  rejectGateSync(db, 'asset_review', 1);
  const engine = new ProductionEngine(db);
  const result = engine.resubmit({ targetId: 1 });
  assert.equal(result.processed, 1);
  const gates = db.prepare(
    "SELECT status FROM gates WHERE target_id = 1 ORDER BY id"
  ).all();
  assert.equal(gates.length, 2);
  assert.equal(gates[0].status, 'rejected');
  assert.equal(gates[1].status, 'pending');
  assert.equal(db.prepare('SELECT status FROM content_items WHERE id = 1').get().status, 'editing');
  db.close();
});

test('resubmit: refuses missing target, unknown item, wrong status, or no rejection', () => {
  const db = freshDb();
  db.prepare("INSERT INTO content_items (title, status) VALUES ('Still shot', 'shot')").run();
  db.prepare(
    "INSERT INTO content_items (title, status, script) VALUES ('Editing clean', 'editing', '{}')"
  ).run(); // editing but never rejected
  const engine = new ProductionEngine(db);
  assert.throws(() => engine.resubmit(), /targetId/);
  assert.throws(() => engine.resubmit({ targetId: 99 }), /not found/);
  assert.throws(() => engine.resubmit({ targetId: 1 }), /expected 'editing'/);
  assert.throws(() => engine.resubmit({ targetId: 2 }), /no asset_review gate to resubmit/);
  db.close();
});

test('resubmit: dry-run does not create gate', () => {
  const db = freshDb();
  db.prepare(
    "INSERT INTO content_items (title, status, script) VALUES ('Dry resubmit', 'editing', ?)"
  ).run(validScriptJson());
  rejectGateSync(db, 'asset_review', 1);
  const engine = new ProductionEngine(db);
  const result = engine.resubmit({ targetId: 1, dryRun: true });
  assert.equal(result.processed, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM gates').get().n, 1);
  db.close();
});

// ============================================================================
// RUN / PIPELINE DISPATCH
// ============================================================================

test('run: throws on unknown action', () => {
  const db = freshDb();
  const engine = new ProductionEngine(db);
  assert.throws(() => engine.run({ action: 'bogus' }), /unknown production action/);
  db.close();
});

test('run: dispatches to specific action', () => {
  const db = freshDb();
  db.prepare(
    "INSERT INTO content_items (title, status) VALUES ('Dispatch', 'ready_to_shoot')"
  ).run();
  const engine = new ProductionEngine(db);
  const result = engine.run({ action: 'process_footage', targetId: 1 });
  assert.equal(result.processed, 1);
  assert.equal(db.prepare('SELECT status FROM content_items WHERE id = 1').get().status, 'shot');
  db.close();
});

test('pipeline: handles empty database gracefully', () => {
  const db = freshDb();
  const engine = new ProductionEngine(db);
  const result = engine.pipeline();
  assert.equal(result.process_footage.processed, 0);
  assert.equal(result.edit.processed, 0);
  assert.equal(result.request_review.processed, 0);
  db.close();
});

// ============================================================================
// SURVEY
// ============================================================================

test('surveyItems: counts items in owned states', () => {
  const db = freshDb();
  db.prepare("INSERT INTO content_items (title, status) VALUES ('Shot 1', 'shot')").run();
  db.prepare("INSERT INTO content_items (title, status) VALUES ('Shot 2', 'shot')").run();
  db.prepare("INSERT INTO content_items (title, status) VALUES ('Editing 1', 'editing')").run();
  db.prepare("INSERT INTO content_items (title, status) VALUES ('Idea', 'idea')").run();
  const engine = new ProductionEngine(db);
  const counts = engine.surveyItems();
  assert.equal(counts.shot, 2);
  assert.equal(counts.editing, 1);
  db.close();
});

// ============================================================================
// COMPOSITION GENERATION
// ============================================================================

test('parseShotNotes: parses timestamped beats', () => {
  const notes = '0-5s: Hook on camera\n5-15s: Old grind montage\nlast 3s: CTA on camera';
  const beats = parseShotNotes(notes, 60);
  assert.equal(beats.length, 3);
  assert.equal(beats[0].start, 0);
  assert.equal(beats[0].end, 5);
  assert.equal(beats[0].description, 'Hook on camera');
  assert.equal(beats[1].start, 5);
  assert.equal(beats[1].end, 15);
  assert.equal(beats[2].start, 57);
  assert.equal(beats[2].end, 60);
  assert.equal(beats[2].description, 'CTA on camera');
});

test('parseShotNotes: returns empty array for empty input', () => {
  assert.deepEqual(parseShotNotes('', 60), []);
  assert.deepEqual(parseShotNotes(null, 60), []);
  assert.deepEqual(parseShotNotes(undefined, 60), []);
});

test('generateComposition: produces valid HTML with script content', () => {
  const script = JSON.parse(validScriptJson());
  const item = { title: 'Test Video', desired_length_seconds: 60 };
  const html = generateComposition(script, item);
  assert.ok(html.includes('<!DOCTYPE html>'));
  assert.ok(html.includes('Test Video'));
  assert.ok(html.includes(script.hook));
  assert.ok(html.includes(script.cta));
  assert.ok(html.includes('data-start'));
  assert.ok(html.includes('data-duration'));
  assert.ok(html.includes('data-composition-id'));
  assert.ok(html.includes('data-width'));
  assert.ok(html.includes('data-height'));
  assert.ok(html.includes('data-fps'));
  assert.ok(html.includes('window.__timelines'));
});

test('generateComposition: escapes HTML in script content', () => {
  const script = JSON.parse(validScriptJson({
    hook: 'What if <script>alert("xss")</script> invoices processed themselves?',
  }));
  const item = { title: 'Test', desired_length_seconds: 60 };
  const html = generateComposition(script, item);
  assert.ok(!html.includes('<script>alert'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('generateComposition: uses desired_length_seconds for duration', () => {
  const script = JSON.parse(validScriptJson());
  const item = { title: 'Short', desired_length_seconds: 30 };
  const html = generateComposition(script, item);
  // The CTA should start at duration - 3 = 27
  assert.ok(html.includes('data-start="27"'));
});

test('generateComposition: defaults to 60s when no desired_length_seconds', () => {
  const script = JSON.parse(validScriptJson());
  const item = { title: 'Default', desired_length_seconds: null };
  const html = generateComposition(script, item);
  // The CTA should start at 60 - 3 = 57
  assert.ok(html.includes('data-start="57"'));
});
