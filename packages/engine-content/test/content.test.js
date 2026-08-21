// Content Engine — the full pipeline and all actions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initDb } from '@content-os/core';
import { ContentEngine } from '../src/index.js';

function freshDb() {
  const dir = mkdtempSync(path.join(tmpdir(), 'content-engine-'));
  return initDb(path.join(dir, 'test.db'));
}

function approveGateSync(db, gateType, itemId) {
  const res = db.prepare(
    "INSERT INTO gates (gate_type, target_type, target_id, requested_by, status, decided_by, decided_at) " +
    "VALUES (?, 'content_item', ?, 'test', 'approved', 'test', datetime('now'))"
  ).run(gateType, itemId);
  return Number(res.lastInsertRowid);
}

// ============================================================================
// FRESH IDEAS — agent-generated each cycle (no static bank)
// ============================================================================

test('addIdeas: registers fresh agent-generated ideas', () => {
  const db = freshDb();
  const engine = new ContentEngine(db);
  const result = engine.addIdeas([
    { title: 'AI pricing comparison', source: 'trend', pillar: 'ai-tools' },
    { title: 'DeepSeek vs GLM benchmark', source: 'question' },
    'Simple string idea',
  ]);
  assert.equal(result.processed, 3);
  const items = db.prepare('SELECT * FROM content_items ORDER BY id').all();
  assert.equal(items.length, 3);
  assert.equal(items[0].title, 'AI pricing comparison');
  assert.equal(items[0].source, 'trend');
  assert.equal(items[2].title, 'Simple string idea');
  assert.equal(items[2].source, 'other');
  db.close();
});

test('addIdeas: dedupes against ALL existing items (any status)', () => {
  const db = freshDb();
  db.prepare("INSERT INTO content_items (title, status) VALUES ('Already covered', 'published')").run();
  const engine = new ContentEngine(db);
  const result = engine.addIdeas([
    { title: 'Already covered' },
    { title: 'Fresh topic' },
  ]);
  assert.equal(result.processed, 1);
  assert.equal(result.duplicates, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM content_items').get().n, 2);
  db.close();
});

test('addIdeas: ignores entries without a title', () => {
  const db = freshDb();
  const engine = new ContentEngine(db);
  const result = engine.addIdeas([{ source: 'trend' }, null, { title: 'Valid' }]);
  assert.equal(result.processed, 1);
  db.close();
});

test('discover: creates ideas from engagement items classified as idea', () => {
  const db = freshDb();
  db.prepare(
    "INSERT INTO engagement_items (platform, author, text, classification, status) " +
    "VALUES ('tiktok', 'user1', 'How do you handle client onboarding?', 'idea', 'new')"
  ).run();
  const engine = new ContentEngine(db);
  const result = engine.discover();
  assert.equal(result.processed, 1);
  const item = db.prepare('SELECT * FROM content_items WHERE id = 1').get();
  assert.equal(item.title, 'How do you handle client onboarding?');
  assert.equal(item.source, 'comment');
  const eng = db.prepare('SELECT status FROM engagement_items WHERE id = 1').get();
  assert.equal(eng.status, 'saved_as_idea');
  db.close();
});

test('discover: returns 0 when no sources available', () => {
  const db = freshDb();
  const engine = new ContentEngine(db);
  const result = engine.discover();
  assert.equal(result.processed, 0);
  db.close();
});

// ============================================================================
// EVALUATE
// ============================================================================

test('evaluate: scores ideas and requests idea_approval gate', () => {
  const db = freshDb();
  db.prepare(
    "INSERT INTO content_items (title, source, pillar, priority) " +
    "VALUES ('Test idea', 'question', 'ai-tools', 'high')"
  ).run();
  const engine = new ContentEngine(db);
  const result = engine.evaluate();
  assert.equal(result.processed, 1);
  assert.equal(result.items.length, 1);
  assert.ok(result.items[0].score > 0);
  assert.ok(result.items[0].score <= 100);
  const item = db.prepare('SELECT status FROM content_items WHERE id = 1').get();
  assert.equal(item.status, 'evaluated');
  const gate = db.prepare("SELECT gate_type, status FROM gates WHERE target_id = 1").get();
  assert.equal(gate.gate_type, 'idea_approval');
  assert.equal(gate.status, 'pending');
  db.close();
});

test('evaluate: high-priority question sources score highest', () => {
  const db = freshDb();
  db.prepare(
    "INSERT INTO content_items (title, source, pillar, priority) " +
    "VALUES ('Best', 'question', 'ai-tools', 'high')"
  ).run();
  db.prepare(
    "INSERT INTO content_items (title, source, priority) " +
    "VALUES ('Worst', 'other', 'low')"
  ).run();
  const engine = new ContentEngine(db);
  const result = engine.evaluate();
  assert.equal(result.items.length, 2);
  assert.ok(result.items[0].score > result.items[1].score,
    `best (${result.items[0].score}) should score higher than worst (${result.items[1].score})`);
  db.close();
});

test('evaluate: dry-run does not move items', () => {
  const db = freshDb();
  db.prepare("INSERT INTO content_items (title) VALUES ('Dry eval')").run();
  const engine = new ContentEngine(db);
  const result = engine.evaluate({ dryRun: true });
  assert.equal(result.processed, 1);
  assert.equal(db.prepare('SELECT status FROM content_items WHERE id = 1').get().status, 'idea');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM gates').get().n, 0);
  db.close();
});

test('evaluate: skips items already in evaluated status', () => {
  const db = freshDb();
  db.prepare("INSERT INTO content_items (title, status) VALUES ('Already evaluated', 'evaluated')").run();
  const engine = new ContentEngine(db);
  const result = engine.evaluate();
  assert.equal(result.processed, 0);
  db.close();
});

// ============================================================================
// PLAN — requires approved idea gate
// ============================================================================

test('plan: fills plan fields from playbook rules and moves to planned', () => {
  const db = freshDb();
  db.prepare(
    "INSERT INTO content_items (title, source, pillar) VALUES ('Plan test', 'trend', 'ai-tools')"
  ).run();
  db.prepare("UPDATE content_items SET status = 'evaluated' WHERE id = 1").run();
  approveGateSync(db, 'idea_approval', 1);
  db.prepare(
    "INSERT INTO playbook_rules (rule, dimension, dimension_value, metric, effect, magnitude, status) " +
    "VALUES ('question hooks work', 'hook_style', 'question', 'retention', 'up', 2.3, 'active')"
  ).run();
  const engine = new ContentEngine(db);
  const result = engine.plan();
  assert.equal(result.processed, 1);
  assert.equal(result.skipped, 0);
  const item = db.prepare('SELECT * FROM content_items WHERE id = 1').get();
  assert.equal(item.status, 'planned');
  assert.equal(item.hook_style, 'question');
  assert.equal(item.format, 'talking_head');
  assert.ok(item.desired_length_seconds > 0);
  db.close();
});

test('plan: skips items without approved idea gate', () => {
  const db = freshDb();
  db.prepare("INSERT INTO content_items (title, status) VALUES ('No gate', 'evaluated')").run();
  const engine = new ContentEngine(db);
  const result = engine.plan();
  assert.equal(result.processed, 0);
  assert.equal(result.skipped, 1);
  assert.equal(db.prepare('SELECT status FROM content_items WHERE id = 1').get().status, 'evaluated');
  db.close();
});

test('plan: uses item existing hook_style over playbook default', () => {
  const db = freshDb();
  db.prepare(
    "INSERT INTO content_items (title, hook_style, status) VALUES ('Has hook', 'contrarian', 'evaluated')"
  ).run();
  approveGateSync(db, 'idea_approval', 1);
  db.prepare(
    "INSERT INTO playbook_rules (rule, dimension, dimension_value, effect, magnitude, status) " +
    "VALUES ('q hooks', 'hook_style', 'question', 'up', 2.0, 'active')"
  ).run();
  const engine = new ContentEngine(db);
  engine.plan();
  const item = db.prepare('SELECT hook_style FROM content_items WHERE id = 1').get();
  assert.equal(item.hook_style, 'contrarian');
  db.close();
});

// ============================================================================
// RESEARCH
// ============================================================================

test('research: finalizes items with agent-written research notes', () => {
  const db = freshDb();
  db.prepare(
    "INSERT INTO content_items (title, pillar, angle, source, research_notes) " +
    "VALUES ('Research test', 'ai-tools', 'pricing comparison', 'trend', " +
    "'Facts: DeepSeek V4 Flash costs 60% less per token than GLM. Source: vendor pricing page. Claims to verify: benchmark numbers.')"
  ).run();
  db.prepare("UPDATE content_items SET status = 'planned' WHERE id = 1").run();
  const engine = new ContentEngine(db);
  const result = engine.research();
  assert.equal(result.processed, 1);
  assert.equal(result.skipped, 0);
  const item = db.prepare('SELECT * FROM content_items WHERE id = 1').get();
  assert.equal(item.status, 'researched');
  // The engine must NOT touch agent-written content
  assert.match(item.research_notes, /DeepSeek V4 Flash/);
  db.close();
});

test('research: skips items without agent-written research notes', () => {
  const db = freshDb();
  db.prepare("INSERT INTO content_items (title, status) VALUES ('No notes', 'planned')").run();
  const engine = new ContentEngine(db);
  const result = engine.research();
  assert.equal(result.processed, 0);
  assert.equal(result.skipped, 1);
  assert.equal(db.prepare('SELECT status FROM content_items WHERE id = 1').get().status, 'planned');
  db.close();
});

test('research: dry-run does not move items', () => {
  const db = freshDb();
  db.prepare(
    "INSERT INTO content_items (title, status, research_notes) " +
    "VALUES ('Dry res', 'planned', 'agent notes')"
  ).run();
  const engine = new ContentEngine(db);
  const result = engine.research({ dryRun: true });
  assert.equal(result.processed, 1);
  assert.equal(db.prepare('SELECT status FROM content_items WHERE id = 1').get().status, 'planned');
  db.close();
});

// ============================================================================
// SCRIPT
// ============================================================================

test('script: finalizes agent-written script and requests script_review gate', () => {
  const db = freshDb();
  db.prepare(
    "INSERT INTO content_items (title, hook_style, pillar, cta, research_notes, script) " +
    "VALUES ('Script test', 'question', 'ai-tools', 'follow for more', 'check pricing', " +
    "'Hook: What if your invoices processed themselves?\\n\\nPoint 1: The 8-hour problem\\nPoint 2: The automation\\nPoint 3: The result\\nCTA: follow for more')"
  ).run();
  db.prepare("UPDATE content_items SET status = 'researched' WHERE id = 1").run();
  const engine = new ContentEngine(db);
  const result = engine.script();
  assert.equal(result.processed, 1);
  assert.equal(result.skipped, 0);
  const item = db.prepare('SELECT * FROM content_items WHERE id = 1').get();
  assert.equal(item.status, 'scripted');
  // The engine must NOT touch agent-written content
  assert.match(item.script, /What if your invoices processed themselves/);
  const gate = db.prepare("SELECT gate_type, status FROM gates WHERE target_id = 1").get();
  assert.equal(gate.gate_type, 'script_review');
  assert.equal(gate.status, 'pending');
  db.close();
});

test('script: skips items without agent-written script — no placeholders', () => {
  const db = freshDb();
  db.prepare("INSERT INTO content_items (title, status) VALUES ('No script', 'researched')").run();
  const engine = new ContentEngine(db);
  const result = engine.script();
  assert.equal(result.processed, 0);
  assert.equal(result.skipped, 1);
  const item = db.prepare('SELECT status, script FROM content_items WHERE id = 1').get();
  assert.equal(item.status, 'researched');
  assert.equal(item.script, null);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM gates').get().n, 0);
  db.close();
});

// ============================================================================
// FULL PIPELINE — end to end
// ============================================================================

test('pipeline: end-to-end from fresh ideas to scripted', () => {
  const db = freshDb();
  db.prepare(
    "INSERT INTO playbook_rules (rule, dimension, dimension_value, effect, magnitude, status) " +
    "VALUES ('q hooks', 'hook_style', 'question', 'up', 2.5, 'active')"
  ).run();
  const engine = new ContentEngine(db);

  // The agent generates fresh ideas each cycle and registers them
  const d = engine.addIdeas([
    { title: 'DeepSeek pricing breakdown', source: 'trend', pillar: 'ai-tools' },
    { title: 'AI agent comparison', source: 'question' },
  ]);
  assert.equal(d.processed, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM content_items WHERE status = 'idea'").get().n, 2);

  const ev = engine.evaluate();
  assert.equal(ev.processed, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM content_items WHERE status = 'evaluated'").get().n, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM gates WHERE status = 'pending'").get().n, 2);

  approveGateSync(db, 'idea_approval', 1);
  approveGateSync(db, 'idea_approval', 2);

  const pl = engine.plan();
  assert.equal(pl.processed, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM content_items WHERE status = 'planned'").get().n, 2);

  // The agent (brain) writes research notes — the engine never writes content
  db.prepare("UPDATE content_items SET research_notes = 'Facts: verified pricing data. Sources: vendor docs.' WHERE id IN (1, 2)").run();

  const re = engine.research();
  assert.equal(re.processed, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM content_items WHERE status = 'researched'").get().n, 2);

  // The agent (brain) writes the finished scripts — the engine only finalizes
  db.prepare(
    "UPDATE content_items SET script = 'Hook: real hook\\n\\nPoint 1: real point\\nCTA: follow' WHERE id IN (1, 2)"
  ).run();

  const sc = engine.script();
  assert.equal(sc.processed, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM content_items WHERE status = 'scripted'").get().n, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM gates WHERE gate_type = 'script_review' AND status = 'pending'").get().n, 2);

  const items = db.prepare('SELECT script FROM content_items ORDER BY id').all();
  for (const item of items) {
    assert.match(item.script, /Hook:/);
    assert.match(item.script, /CTA:/);
  }

  const h1 = db.prepare('SELECT COUNT(*) AS n FROM content_item_history WHERE content_item_id = 1').get();
  assert.ok(h1.n >= 4, `item 1 should have >= 4 history entries, got ${h1.n}`);

  db.close();
});

test('pipeline: handles empty database gracefully', () => {
  const db = freshDb();
  const engine = new ContentEngine(db);
  const result = engine.pipeline();
  assert.equal(result.discover.processed, 0);
  assert.equal(result.evaluate.processed, 0);
  assert.equal(result.plan.processed, 0);
  assert.equal(result.research.processed, 0);
  assert.equal(result.script.processed, 0);
  db.close();
});

test('pipeline: respects targetId to process a single item', () => {
  const db = freshDb();
  db.prepare("INSERT INTO content_items (title, source) VALUES ('Item A', 'trend')").run();
  db.prepare("INSERT INTO content_items (title, source) VALUES ('Item B', 'trend')").run();
  const engine = new ContentEngine(db);
  const ev = engine.evaluate({ targetId: 1 });
  assert.equal(ev.processed, 1);
  assert.equal(db.prepare('SELECT status FROM content_items WHERE id = 1').get().status, 'evaluated');
  assert.equal(db.prepare('SELECT status FROM content_items WHERE id = 2').get().status, 'idea');
  db.close();
});

// ============================================================================
// PLAYBOOK INTEGRATION
// ============================================================================

test('playbook rules influence scoring: pillar match boosts score', () => {
  const db = freshDb();
  db.prepare(
    "INSERT INTO content_items (title, pillar, source) VALUES ('Match', 'ai-tools', 'trend')"
  ).run();
  db.prepare(
    "INSERT INTO content_items (title, source) VALUES ('No match', 'trend')"
  ).run();
  db.prepare(
    "INSERT INTO playbook_rules (rule, dimension, dimension_value, effect, magnitude, status) " +
    "VALUES ('ai-tools works', 'pillar', 'ai-tools', 'up', 1.5, 'active')"
  ).run();
  const engine = new ContentEngine(db);
  const result = engine.evaluate();
  assert.equal(result.items.length, 2);
  assert.ok(result.items[0].score > result.items[1].score,
    `match (${result.items[0].score}) should score higher than no-match (${result.items[1].score})`);
  db.close();
});

test('playbook rules influence planning: hook_style from rule', () => {
  const db = freshDb();
  db.prepare(
    "INSERT INTO content_items (title, status) VALUES ('Plan me', 'evaluated')"
  ).run();
  approveGateSync(db, 'idea_approval', 1);
  db.prepare(
    "INSERT INTO playbook_rules (rule, dimension, dimension_value, effect, magnitude, status) " +
    "VALUES ('stat works', 'hook_style', 'stat', 'up', 1.0, 'active')"
  ).run();
  db.prepare(
    "INSERT INTO playbook_rules (rule, dimension, dimension_value, effect, magnitude, status) " +
    "VALUES ('question works better', 'hook_style', 'question', 'up', 3.0, 'active')"
  ).run();
  const engine = new ContentEngine(db);
  engine.plan();
  const item = db.prepare('SELECT hook_style FROM content_items WHERE id = 1').get();
  assert.equal(item.hook_style, 'question');
  db.close();
});

// ============================================================================
// IDEMPOTENCY
// ============================================================================

test('pipeline: running twice does not double-process', () => {
  const db = freshDb();
  const engine = new ContentEngine(db);
  engine.addIdeas(['Idempotent test']);
  engine.pipeline();
  const result = engine.pipeline();
  assert.equal(result.discover.processed, 0);
  assert.equal(result.evaluate.processed, 0);
  assert.equal(result.plan.processed, 0);
  assert.equal(result.research.processed, 0);
  assert.equal(result.script.processed, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM content_items').get().n, 1);
  db.close();
});

// ============================================================================
// ERROR HANDLING
// ============================================================================

test('run: throws on unknown action', () => {
  const db = freshDb();
  const engine = new ContentEngine(db);
  assert.throws(() => engine.run({ action: 'bogus' }), /unknown content action/);
  db.close();
});
