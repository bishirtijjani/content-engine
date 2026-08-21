// State machine + gates tests — the core contract.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initDb } from '../src/db.js';
import {
  transition, fastTrack, StateError, canTransition, gateRequired,
} from '../src/state.js';
import { requestGate, decideGate } from '../src/gates.js';

function freshDb() {
  const dir = mkdtempSync(path.join(tmpdir(), 'contentos-core-'));
  return initDb(path.join(dir, 'test.db'));
}

function addItem(db, title = 'test item') {
  const res = db.prepare('INSERT INTO content_items (title) VALUES (?)').run(title);
  return Number(res.lastInsertRowid);
}

function approveGate(db, itemId, gateType) {
  const gid = requestGate(db, gateType, 'content_item', itemId, { requestedBy: 'test' });
  decideGate(db, gid, 'approved', { decidedBy: 'test' });
}

test('state machine allows legal transitions only', () => {
  assert.ok(canTransition('idea', 'evaluated'));
  assert.ok(canTransition('scripted', 'ready_to_shoot'));
  assert.ok(canTransition('published', 'measured'));
  assert.ok(!canTransition('idea', 'published'));
  assert.ok(!canTransition('archived', 'idea'));
  assert.ok(!canTransition('measured', 'published'));
});

test('gates are required exactly where declared', () => {
  assert.equal(gateRequired('evaluated', 'planned'), 'idea_approval');
  assert.equal(gateRequired('scripted', 'ready_to_shoot'), 'script_review');
  assert.equal(gateRequired('editing', 'scheduled'), 'asset_review');
  assert.equal(gateRequired('idea', 'evaluated'), null);
  assert.equal(gateRequired('scheduled', 'published'), null);
});

test('idea -> planned is blocked until the idea gate is approved', () => {
  const db = freshDb();
  const id = addItem(db);
  transition(db, id, 'evaluated');
  assert.throws(() => transition(db, id, 'planned'), StateError);
  const gid = requestGate(db, 'idea_approval', 'content_item', id, { requestedBy: 'test' });
  assert.throws(() => transition(db, id, 'planned'), StateError); // still pending
  decideGate(db, gid, 'approved', { decidedBy: 'test' });
  transition(db, id, 'planned');
  assert.equal(db.prepare('SELECT status FROM content_items WHERE id = ?').get(id).status, 'planned');
});

test('scripted -> ready_to_shoot is blocked until the script gate is approved', () => {
  const db = freshDb();
  const id = addItem(db);
  approveGate(db, id, 'idea_approval');
  transition(db, id, 'evaluated');
  transition(db, id, 'planned');
  transition(db, id, 'researched');
  transition(db, id, 'scripted');
  assert.throws(() => transition(db, id, 'ready_to_shoot'), StateError);
  approveGate(db, id, 'script_review');
  transition(db, id, 'ready_to_shoot');
  assert.equal(db.prepare('SELECT status FROM content_items WHERE id = ?').get(id).status, 'ready_to_shoot');
});

test('rejected gate stays rejected and blocks the transition', () => {
  const db = freshDb();
  const id = addItem(db);
  transition(db, id, 'evaluated');
  const gid = requestGate(db, 'idea_approval', 'content_item', id);
  decideGate(db, gid, 'rejected', { decidedBy: 'test', notes: 'not worth my face-time' });
  assert.throws(() => transition(db, id, 'planned'), StateError);
  const gid2 = requestGate(db, 'idea_approval', 'content_item', id);
  decideGate(db, gid2, 'approved', { decidedBy: 'test' });
  transition(db, id, 'planned');
});

test('full lifecycle with all three gates and audit history', () => {
  const db = freshDb();
  const id = addItem(db, 'lifecycle');
  transition(db, id, 'evaluated');
  approveGate(db, id, 'idea_approval');
  transition(db, id, 'planned');
  transition(db, id, 'researched');
  transition(db, id, 'scripted');
  approveGate(db, id, 'script_review');
  transition(db, id, 'ready_to_shoot');
  transition(db, id, 'shot');
  transition(db, id, 'editing');
  approveGate(db, id, 'asset_review');
  transition(db, id, 'scheduled');
  transition(db, id, 'published');
  transition(db, id, 'measured');
  assert.equal(db.prepare('SELECT status FROM content_items WHERE id = ?').get(id).status, 'measured');
  const history = db.prepare(
    'SELECT * FROM content_item_history WHERE content_item_id = ? ORDER BY id'
  ).all(id);
  assert.equal(history.length, 10);
  assert.equal(history[0].from_status, 'idea');
  assert.equal(history[0].to_status, 'evaluated');
  assert.equal(history[9].to_status, 'measured');
});

test('failed state allows retry back into the pipeline', () => {
  const db = freshDb();
  const id = addItem(db);
  transition(db, id, 'evaluated');
  approveGate(db, id, 'idea_approval');
  transition(db, id, 'planned');
  transition(db, id, 'researched');
  transition(db, id, 'scripted');
  approveGate(db, id, 'script_review');
  transition(db, id, 'ready_to_shoot');
  transition(db, id, 'shot');
  transition(db, id, 'editing');
  transition(db, id, 'failed', { reason: 'render crashed' });
  assert.equal(db.prepare('SELECT status FROM content_items WHERE id = ?').get(id).status, 'failed');
  transition(db, id, 'editing', { reason: 'retry after fix' });
  assert.equal(db.prepare('SELECT status FROM content_items WHERE id = ?').get(id).status, 'editing');
});

// -- fast-track --------------------------------------------------------------

test('fast-track requires a reason', () => {
  const db = freshDb();
  const id = addItem(db);
  assert.throws(() => fastTrack(db, id, 'scripted'), StateError);
});

test('fast-track refuses non-content targets (never past shooting)', () => {
  const db = freshDb();
  const id = addItem(db);
  assert.throws(
    () => fastTrack(db, id, 'published', { reason: 'breaking news' }),
    StateError,
  );
  assert.throws(
    () => fastTrack(db, id, 'shot', { reason: 'breaking news' }),
    StateError,
  );
});

test('fast-track enforces every gate on the crossed path', () => {
  const db = freshDb();
  const id = addItem(db);
  // idea -> ready_to_shoot crosses evaluated->planned (idea_approval)
  // AND scripted->ready_to_shoot (script_review) — both must be approved
  assert.throws(
    () => fastTrack(db, id, 'ready_to_shoot', { reason: 'breaking news' }),
    StateError,
  );
  // approve the idea gate only — still blocked by script_review on the path
  approveGate(db, id, 'idea_approval');
  assert.throws(
    () => fastTrack(db, id, 'ready_to_shoot', { reason: 'breaking news' }),
    StateError,
  );
  // approve the script gate too — now allowed
  approveGate(db, id, 'script_review');
  const result = fastTrack(db, id, 'ready_to_shoot', { reason: 'breaking news' });
  assert.equal(result.from, 'idea');
  assert.equal(result.to, 'ready_to_shoot');
  assert.deepEqual(result.skipped, ['evaluated', 'planned', 'researched', 'scripted']);
});

test('fast-track records skipped states in the audit trail', () => {
  const db = freshDb();
  const id = addItem(db);
  approveGate(db, id, 'idea_approval');
  approveGate(db, id, 'script_review');
  fastTrack(db, id, 'ready_to_shoot', { reason: 'breaking news' });
  const history = db.prepare(
    'SELECT * FROM content_item_history WHERE content_item_id = ? ORDER BY id'
  ).all(id);
  assert.equal(history.length, 1);
  assert.equal(history[0].from_status, 'idea');
  assert.equal(history[0].to_status, 'ready_to_shoot');
  assert.deepEqual(JSON.parse(history[0].skipped_states), ['evaluated', 'planned', 'researched', 'scripted']);
  assert.match(history[0].reason, /breaking news/);
});

test('fast-track cannot skip the script gate even when jumping to scripted', () => {
  const db = freshDb();
  const id = addItem(db);
  // idea -> scripted: the path crosses evaluated->planned (idea_approval).
  // script_review is NOT on this path (it guards scripted->ready_to_shoot),
  // so only idea_approval is required.
  approveGate(db, id, 'idea_approval');
  const result = fastTrack(db, id, 'scripted', { reason: 'breaking news' });
  assert.equal(result.to, 'scripted');
  // but jumping to ready_to_shoot DOES require script_review
  assert.throws(
    () => fastTrack(db, id, 'ready_to_shoot', { reason: 'breaking news' }),
    StateError,
  );
});