// Lifecycle tests — the full loop, driven directly by the engine.
// The agent calls the engine as a library. No terminal.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initDb, transition, requestGate, decideGate, fastTrack } from '@content-os/core';
import { ContentEngine } from '../src/index.js';

function freshDb() {
  const dir = mkdtempSync(path.join(tmpdir(), 'lifecycle-'));
  return initDb(path.join(dir, 'test.db'));
}

function approveGate(db, gateType, itemId) {
  const res = db.prepare(
    "INSERT INTO gates (gate_type, target_type, target_id, requested_by, status, decided_by, decided_at) " +
    "VALUES (?, 'content_item', ?, 'test', 'approved', 'test', datetime('now'))"
  ).run(gateType, itemId);
  return Number(res.lastInsertRowid);
}

// Agent-written content satisfying the structured script contract
// (~161 spoken words — inside 120-180 for a default 60s item).
function validScriptJson() {
  const sentence = 'This is a spoken sentence that walks through the actual build step by step so the narration lands in the right length window.';
  const narration = Array.from({ length: 7 }, () => sentence).join(' ');
  return JSON.stringify({
    hook: 'My client was spending 8 hours a week on invoices until we fixed this.',
    script: narration,
    points: [{ title: 'The problem', detail: 'Manual invoice work eats the week' }],
    cta: 'Follow for the full build breakdown.',
    shot_notes: 'Screen recording of the automation running, cut on sentence boundaries.',
  });
}

const RESEARCH_NOTES =
  'Facts: Manual invoicing costs small businesses about 8 hours weekly. ' +
  'Source: client time-tracking audit, July. Claims to verify: hours saved after automation.';

// ============================================================================
// FULL LIFECYCLE: idea → measured (all three gates)
// ============================================================================

test('full lifecycle: idea → measured through the engine (with all three gates)', () => {
  const db = freshDb();
  const engine = new ContentEngine(db);

  // --- Step 1: the agent generates a fresh idea and registers it ---
  const d = engine.addIdeas(['Is DeepSeek V4 Flash actually cheaper than GLM?']);
  assert.equal(d.processed, 1);

  // --- Step 2: evaluate → evaluated (scores + requests idea gate) ---
  const ev = engine.evaluate();
  assert.equal(ev.processed, 1);
  assert.ok(ev.items[0].score > 0);

  // --- Step 3: plan → blocked (idea gate not approved) ---
  const p1 = engine.plan();
  assert.equal(p1.processed, 0);
  assert.equal(p1.skipped, 1);

  // --- Step 4: human approves idea gate ---
  approveGate(db, 'idea_approval', 1);

  // --- Step 5: plan → planned ---
  const p2 = engine.plan();
  assert.equal(p2.processed, 1);
  const planned = db.prepare('SELECT status FROM content_items WHERE id = 1').get();
  assert.equal(planned.status, 'planned');

  // --- Step 6: agent writes research notes, engine finalizes → researched ---
  db.prepare(
    "UPDATE content_items SET research_notes = ? WHERE id = 1"
  ).run(RESEARCH_NOTES);
  const r = engine.research();
  assert.equal(r.processed, 1);

  // --- Step 7: agent writes the finished script, engine finalizes ---
  db.prepare(
    "UPDATE content_items SET script = ?, " +
    "shot_instructions = 'talking head + screen share' WHERE id = 1"
  ).run(validScriptJson());
  const sc = engine.script();
  assert.equal(sc.processed, 1);
  const scripted = db.prepare('SELECT status, script FROM content_items WHERE id = 1').get();
  assert.equal(scripted.status, 'scripted');
  assert.match(JSON.parse(scripted.script).hook, /8 hours/);

  // --- Step 8: ready → blocked (script gate not approved) ---
  const item = db.prepare('SELECT status FROM content_items WHERE id = 1').get();
  assert.throws(() => {
    transition(db, 1, 'ready_to_shoot', { actor: 'test', reason: 'test' });
  });

  // --- Step 9: human approves script gate ---
  approveGate(db, 'script_review', 1);

  // --- Step 10: ready → ready_to_shoot ---
  transition(db, 1, 'ready_to_shoot', { actor: 'test', reason: 'ready' });

  // --- Step 11: shot → shot ---
  transition(db, 1, 'shot', { actor: 'test', reason: 'filmed' });

  // --- Step 12: editing → editing ---
  transition(db, 1, 'editing', { actor: 'test', reason: 'production' });

  // --- Step 13: request asset_review gate, approve, move to scheduled ---
  requestGate(db, 'asset_review', 'content_item', 1, {
    requestedBy: 'test', note: 'assets ready',
  });
  approveGate(db, 'asset_review', 1);

  // Create asset + post to allow publish
  db.prepare("INSERT INTO assets (content_item_id, platform, file_path, status) VALUES (1, 'tiktok', '/tmp/test.mp4', 'ready')").run();
  db.prepare("INSERT INTO posts (content_item_id, platform, status) VALUES (1, 'tiktok', 'scheduled')").run();
  transition(db, 1, 'scheduled', { actor: 'test', reason: 'scheduled' });

  // --- Step 14: published ---
  db.prepare("UPDATE posts SET status = 'published', published_at = datetime('now') WHERE id = 1").run();
  transition(db, 1, 'published', { actor: 'test', reason: 'live' });

  // --- Step 15: metrics + measured ---
  db.prepare("INSERT INTO metrics (post_id, views, likes, shares, collected_at) VALUES (1, 1500, 80, 12, datetime('now'))").run();
  transition(db, 1, 'measured', { actor: 'test', reason: 'metrics collected' });

  const final = db.prepare('SELECT status FROM content_items WHERE id = 1').get();
  assert.equal(final.status, 'measured');

  // Verify full audit trail
  const history = db.prepare(
    'SELECT COUNT(*) AS n FROM content_item_history WHERE content_item_id = 1'
  ).get();
  assert.ok(history.n >= 6, `should have >= 6 history entries, got ${history.n}`);

  db.close();
});

// ============================================================================
// BATCH PRODUCTION: session → recordings → items → assets → posts
// ============================================================================

test('batch production: session → recordings → items → assets → posts', () => {
  const db = freshDb();
  const engine = new ContentEngine(db);

  // The agent generates 3 fresh ideas, then the pipeline takes over
  engine.addIdeas([
    { title: 'Item A' },
    { title: 'Item B' },
    { title: 'Item C' },
  ]);
  engine.evaluate();

  // Approve all idea gates
  for (let i = 1; i <= 3; i++) approveGate(db, 'idea_approval', i);

  engine.plan();

  // Agent writes research notes + scripts — the engine never writes content
  db.prepare("UPDATE content_items SET research_notes = ? WHERE id IN (1, 2, 3)").run(RESEARCH_NOTES);
  engine.research();
  db.prepare("UPDATE content_items SET script = ? WHERE id IN (1, 2, 3)").run(validScriptJson());
  engine.script();

  // Approve all script gates
  for (let i = 1; i <= 3; i++) approveGate(db, 'script_review', i);

  // Move all to ready_to_shoot
  for (let i = 1; i <= 3; i++) transition(db, i, 'ready_to_shoot', { actor: 'test', reason: 'ready' });

  // Create a recording session and assign items
  const sessRes = db.prepare(
    "INSERT INTO recording_sessions (title, scheduled_at, status) VALUES ('Shoot day', datetime('now'), 'planned')"
  ).run();
  const sessionId = Number(sessRes.lastInsertRowid);

  for (let i = 1; i <= 3; i++) {
    db.prepare("UPDATE content_items SET session_id = ? WHERE id = ?").run(sessionId, i);
  }

  // Upload footage
  db.prepare("UPDATE recording_sessions SET status = 'footage_uploaded' WHERE id = ?").run(sessionId);

  // Register recordings
  for (let i = 1; i <= 3; i++) {
    db.prepare(
      "INSERT INTO recordings (session_id, file_path, duration_seconds, status) VALUES (?, ?, ?, 'uploaded')"
    ).run(sessionId, `/footage/item_${i}.mp4`, 60);
  }

  // Create assets + posts for each item
  for (let i = 1; i <= 3; i++) {
    transition(db, i, 'shot', { actor: 'test', reason: 'filmed' });
    transition(db, i, 'editing', { actor: 'test', reason: 'production' });
    requestGate(db, 'asset_review', 'content_item', i, { requestedBy: 'test', note: 'assets ready' });
    approveGate(db, 'asset_review', i);
    db.prepare("INSERT INTO assets (content_item_id, platform, file_path, status) VALUES (?, 'tiktok', ?, 'ready')").run(i, `/assets/item_${i}.mp4`);
    db.prepare("INSERT INTO posts (content_item_id, platform, status) VALUES (?, 'tiktok', 'scheduled')").run(i);
    transition(db, i, 'scheduled', { actor: 'test', reason: 'scheduled' });
  }

  // Verify all 3 items are scheduled
  const scheduled = db.prepare("SELECT COUNT(*) AS n FROM content_items WHERE status = 'scheduled'").get();
  assert.equal(scheduled.n, 3);

  // Verify session has recordings
  const recs = db.prepare("SELECT COUNT(*) AS n FROM recordings WHERE session_id = ?").get(sessionId);
  assert.equal(recs.n, 3);

  db.close();
});

// ============================================================================
// FAST-TRACK: breaking news compresses content stages
// ============================================================================

test('fast-track: breaking news compresses content stages, gates still enforced', () => {
  const db = freshDb();
  const engine = new ContentEngine(db);

  // Create an idea
  db.prepare("INSERT INTO content_items (title, source) VALUES ('Breaking news', 'trend')").run();

  // Evaluate so it moves to evaluated status
  engine.evaluate();

  // Fast-track: evaluated → scripted
  // Must approve BOTH gates on the path: idea_approval (evaluated→planned) and script_review (scripted→ready)
  approveGate(db, 'idea_approval', 1);
  approveGate(db, 'script_review', 1);
  fastTrack(db, 1, 'scripted', { actor: 'test', reason: 'breaking news — need this today' });

  const item = db.prepare('SELECT status FROM content_items WHERE id = 1').get();
  assert.equal(item.status, 'scripted');

  // Now fast-track to ready_to_shoot
  transition(db, 1, 'ready_to_shoot', { actor: 'test', reason: 'ready' });

  const ready = db.prepare('SELECT status FROM content_items WHERE id = 1').get();
  assert.equal(ready.status, 'ready_to_shoot');

  // Verify skipped states were recorded
  const history = db.prepare(
    "SELECT skipped_states FROM content_item_history WHERE content_item_id = 1 AND to_status = 'scripted'"
  ).get();
  assert.ok(history.skipped_states, 'should have skipped_states recorded');

  db.close();
});

// ============================================================================
// ILLEGAL JUMPS: state machine blocks invalid transitions
// ============================================================================

test('state machine blocks illegal jumps through direct engine calls', () => {
  const db = freshDb();
  const engine = new ContentEngine(db);

  db.prepare("INSERT INTO content_items (title) VALUES ('Test idea')").run();
  engine.discover();

  // Can't jump from idea to shot directly
  assert.throws(() => {
    transition(db, 1, 'shot', { actor: 'test', reason: 'test' });
  });

  // Can't jump from idea to scripted
  assert.throws(() => {
    transition(db, 1, 'scripted', { actor: 'test', reason: 'test' });
  });

  db.close();
});

// ============================================================================
// RENDER: script renders to presentable Markdown
// ============================================================================

test('render: generates presentable Markdown from script data', async () => {
  const { generateMarkdown } = await import('../../../src/render-script.js');

  const scriptData = {
    hook: 'What if client onboarding took 10 minutes instead of 2 hours?',
    script: 'Most agencies waste hours on manual onboarding. Here\'s the fix.',
    points: [
      { title: 'The Problem', detail: 'Manual forms, back-and-forth emails, missed details.' },
      { title: 'The Solution', detail: 'Automated intake → CRM → kickoff. Done.' },
    ],
    cta: 'Follow for more automation tips',
    shot_notes: 'Screen recording of the automation in action.',
  };

  const item = {
    title: 'Automate Client Onboarding',
    pillar: 'workflow-automation',
    format: 'hybrid',
    hook_style: 'question',
    desired_length_seconds: 60,
    target_audience: 'agency owners',
  };

  const md = generateMarkdown(scriptData, item);

  // Verify structure
  assert.match(md, /# Automate Client Onboarding/);
  assert.match(md, /## Hook/);
  assert.match(md, /What if client onboarding/);
  assert.match(md, /## Script/);
  assert.match(md, /## Talking Points/);
  assert.match(md, /### 1\. The Problem/);
  assert.match(md, /### 2\. The Solution/);
  assert.match(md, /## Call to Action/);
  assert.match(md, /Follow for more/);
  assert.match(md, /## Shot Notes/);
  assert.match(md, /Screen recording/);
  assert.match(md, /\*\*Pillar:\*\* workflow-automation/);
  assert.match(md, /\*\*Format:\*\* hybrid/);
  assert.match(md, /\*\*Length:\*\* 60s/);
});
