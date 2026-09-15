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

// Agent-written content satisfying the structured script contract:
// ~161 spoken words — inside 120-180 for a default 60s item (2.5 w/s ±20%).
function validScriptJson(overrides = {}) {
  const sentence = 'This is a spoken sentence that walks through the actual build step by step so the narration lands in the right length window.';
  const narration = Array.from({ length: 7 }, () => sentence).join(' ');
  return JSON.stringify({
    hook: 'My client was spending 8 hours a week on invoices until we fixed this.',
    script: narration,
    points: [{ title: 'The problem', detail: 'Manual invoice work eats the week' }],
    cta: 'Follow for the full build breakdown.',
    shot_notes: 'Screen recording of the automation running, cut on sentence boundaries.',
    ...overrides,
  });
}

const RESEARCH_NOTES =
  'Facts: Manual invoicing costs small businesses about 8 hours weekly. ' +
  'Source: client time-tracking audit, July. Claims to verify: hours saved after automation.';

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

test('evaluate: persists evaluation_score and evaluation_reason on the item', () => {
  const db = freshDb();
  db.prepare(
    "INSERT INTO content_items (title, source, priority) VALUES ('Scored', 'question', 'high')"
  ).run();
  const engine = new ContentEngine(db);
  engine.evaluate();
  const item = db.prepare('SELECT evaluation_score, evaluation_reason FROM content_items WHERE id = 1').get();
  assert.ok(Number.isInteger(item.evaluation_score), `expected integer score, got ${item.evaluation_score}`);
  assert.ok(item.evaluation_score > 0 && item.evaluation_score <= 100);
  assert.match(item.evaluation_reason, /audience source question/);
  assert.match(item.evaluation_reason, /priority high/);
  db.close();
});

test('evaluate: settings.pillars drive pillar relevance on a fresh DB (no playbook)', () => {
  const db = freshDb();
  db.prepare("INSERT INTO settings (key, value) VALUES ('pillars', ?)")
    .run(JSON.stringify(['workflow-automation']));
  db.prepare(
    "INSERT INTO content_items (title, source, pillar, priority) VALUES ('Known pillar', 'other', 'workflow-automation', 'medium')"
  ).run();
  db.prepare(
    "INSERT INTO content_items (title, source, priority) VALUES ('Unknown pillar', 'other', 'medium')"
  ).run();
  const engine = new ContentEngine(db);
  const result = engine.evaluate();
  assert.equal(result.items.length, 2);
  assert.ok(result.items[0].score > result.items[1].score,
    `known pillar (${result.items[0].score}) should outscore unknown (${result.items[1].score})`);
  const known = db.prepare('SELECT evaluation_reason FROM content_items WHERE id = 1').get();
  assert.match(known.evaluation_reason, /pillar workflow-automation/);
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

test('plan: matches pillar from item tags against settings.pillars', () => {
  const db = freshDb();
  db.prepare("INSERT INTO settings (key, value) VALUES ('pillars', ?)")
    .run(JSON.stringify(['custom-software', 'ai-implementation']));
  db.prepare(
    "INSERT INTO content_items (title, status, tags) VALUES ('Tagged idea', 'evaluated', ?)"
  ).run(JSON.stringify(['crm', 'ai-implementation']));
  approveGateSync(db, 'idea_approval', 1);
  const engine = new ContentEngine(db);
  engine.plan();
  const item = db.prepare('SELECT pillar FROM content_items WHERE id = 1').get();
  assert.equal(item.pillar, 'ai-implementation');
  db.close();
});

test('plan: falls back to hooks_preferred and first configured pillar, never invented values', () => {
  const db = freshDb();
  db.prepare("INSERT INTO settings (key, value) VALUES ('pillars', ?)")
    .run(JSON.stringify(['business-operations']));
  db.prepare("INSERT INTO settings (key, value) VALUES ('hooks_preferred', ?)")
    .run(JSON.stringify(['problem_statement', 'contrarian']));
  db.prepare("INSERT INTO content_items (title, status) VALUES ('Untagged idea', 'evaluated')").run();
  approveGateSync(db, 'idea_approval', 1);
  const engine = new ContentEngine(db);
  engine.plan();
  const item = db.prepare('SELECT pillar, hook_style FROM content_items WHERE id = 1').get();
  assert.equal(item.pillar, 'business-operations');
  assert.notEqual(item.pillar, 'general');
  assert.equal(item.hook_style, 'problem_statement');
  db.close();
});

// ============================================================================
// READY — final transition into the shoot-ready queue
// ============================================================================

test('ready: moves gate-approved scripted items to ready_to_shoot', () => {
  const db = freshDb();
  db.prepare(
    "INSERT INTO content_items (title, status, script) VALUES ('Approved script', 'scripted', '{\"hook\":\"h\"}')"
  ).run();
  approveGateSync(db, 'script_review', 1);
  db.prepare(
    "INSERT INTO content_items (title, status, script) VALUES ('Pending script', 'scripted', '{}')"
  ).run(); // no approved gate — must be skipped
  const engine = new ContentEngine(db);
  const result = engine.ready();
  assert.equal(result.processed, 1);
  assert.equal(result.skipped, 1);
  assert.equal(db.prepare('SELECT status FROM content_items WHERE id = 1').get().status, 'ready_to_shoot');
  assert.equal(db.prepare('SELECT status FROM content_items WHERE id = 2').get().status, 'scripted');
  db.close();
});

test('ready: dry-run does not move items', () => {
  const db = freshDb();
  db.prepare(
    "INSERT INTO content_items (title, status, script) VALUES ('Approved script', 'scripted', '{}')"
  ).run();
  approveGateSync(db, 'script_review', 1);
  const engine = new ContentEngine(db);
  const result = engine.ready({ dryRun: true });
  assert.equal(result.processed, 1);
  assert.equal(db.prepare('SELECT status FROM content_items WHERE id = 1').get().status, 'scripted');
  db.close();
});

// ============================================================================
// RESUBMIT — revision loop after a rejected script review
// ============================================================================

function rejectGateSync(db, gateType, itemId) {
  return db.prepare(
    "INSERT INTO gates (gate_type, target_type, target_id, requested_by, status, decided_by, decided_at) " +
    "VALUES (?, 'content_item', ?, 'test', 'rejected', 'human', datetime('now'))"
  ).run(gateType, itemId);
}

test('resubmit: requests a fresh script_review gate after rejection', () => {
  const db = freshDb();
  db.prepare(
    "INSERT INTO content_items (title, status, script) VALUES ('Rejected script', 'scripted', '{\"hook\":\"x\"}')"
  ).run();
  rejectGateSync(db, 'script_review', 1);
  const engine = new ContentEngine(db);
  const result = engine.resubmit({ targetId: 1 });
  assert.equal(result.processed, 1);
  const gates = db.prepare("SELECT status FROM gates WHERE target_id = 1 ORDER BY id").all();
  assert.equal(gates.length, 2);
  assert.equal(gates[0].status, 'rejected');   // history preserved
  assert.equal(gates[1].status, 'pending');    // fresh review requested
  // Item stays scripted until the new gate is decided.
  assert.equal(db.prepare('SELECT status FROM content_items WHERE id = 1').get().status, 'scripted');
  db.close();
});

test('resubmit: refuses missing target, unknown item, wrong status, or no rejection', () => {
  const db = freshDb();
  db.prepare("INSERT INTO content_items (title, status) VALUES ('Still an idea', 'idea')").run();
  db.prepare(
    "INSERT INTO content_items (title, status, script) VALUES ('Scripted clean', 'scripted', '{}')"
  ).run(); // scripted but never rejected
  const engine = new ContentEngine(db);
  assert.throws(() => engine.resubmit(), /targetId/);
  assert.throws(() => engine.resubmit({ targetId: 99 }), /not found/);
  assert.throws(() => engine.resubmit({ targetId: 1 }), /expected 'scripted'/);
  assert.throws(() => engine.resubmit({ targetId: 2 }), /no rejected script_review/);
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

test('research: rejects thin research notes on real runs', () => {
  const db = freshDb();
  db.prepare(
    "INSERT INTO content_items (title, status, research_notes) VALUES ('Thin notes', 'planned', 'some quick thoughts')"
  ).run();
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
    "VALUES ('Script test', 'question', 'ai-tools', 'follow for more', ?, ?)"
  ).run(RESEARCH_NOTES, validScriptJson());
  db.prepare("UPDATE content_items SET status = 'researched' WHERE id = 1").run();
  const engine = new ContentEngine(db);
  const result = engine.script();
  assert.equal(result.processed, 1);
  assert.equal(result.skipped, 0);
  const item = db.prepare('SELECT * FROM content_items WHERE id = 1').get();
  assert.equal(item.status, 'scripted');
  // The engine must NOT touch agent-written content
  const stored = JSON.parse(item.script);
  assert.match(stored.hook, /invoices processed themselves|8 hours/);
  const gate = db.prepare("SELECT gate_type, status FROM gates WHERE target_id = 1").get();
  assert.equal(gate.gate_type, 'script_review');
  assert.equal(gate.status, 'pending');
  db.close();
});

test('script: rejects plain-text scripts — the contract is structured JSON', () => {
  const db = freshDb();
  db.prepare(
    "INSERT INTO content_items (title, status, script) VALUES ('Plain text', 'researched', " +
    "'Hook: What if invoices processed themselves?\\n\\nPoint 1: The problem\\nCTA: follow')"
  ).run();
  const engine = new ContentEngine(db);
  const result = engine.script();
  assert.equal(result.processed, 0);
  assert.equal(result.skipped, 1);
  assert.equal(db.prepare('SELECT status FROM content_items WHERE id = 1').get().status, 'researched');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM gates').get().n, 0);
  db.close();
});

test('script: rejects scripts missing required fields', () => {
  const db = freshDb();
  db.prepare(
    "INSERT INTO content_items (title, status, script) VALUES ('No CTA', 'researched', ?)"
  ).run(validScriptJson({ cta: '' }));
  const engine = new ContentEngine(db);
  const result = engine.script();
  assert.equal(result.processed, 0);
  assert.equal(result.skipped, 1);
  assert.equal(db.prepare('SELECT status FROM content_items WHERE id = 1').get().status, 'researched');
  db.close();
});

test('script: rejects narration far off the target length', () => {
  const db = freshDb();
  db.prepare(
    "INSERT INTO content_items (title, status, script) VALUES ('Too short', 'researched', ?)"
  ).run(validScriptJson({ script: 'This narration is much too short for a sixty second video.' }));
  const engine = new ContentEngine(db);
  const result = engine.script();
  assert.equal(result.processed, 0);
  assert.equal(result.skipped, 1);
  assert.equal(db.prepare('SELECT status FROM content_items WHERE id = 1').get().status, 'researched');
  db.close();
});

test('script: rejects placeholder-filled scripts', () => {
  const db = freshDb();
  db.prepare(
    "INSERT INTO content_items (title, status, script) VALUES ('Has TBD', 'researched', ?)"
  ).run(validScriptJson({ hook: 'TBD — think of a hook later' }));
  const engine = new ContentEngine(db);
  const result = engine.script();
  assert.equal(result.processed, 0);
  assert.equal(result.skipped, 1);
  assert.equal(db.prepare('SELECT status FROM content_items WHERE id = 1').get().status, 'researched');
  db.close();
});

test('script: length thresholds come from settings.script_framework when present', () => {
  const db = freshDb();
  db.prepare("INSERT INTO settings (key, value) VALUES ('script_framework', ?)").run(JSON.stringify({
    version: 1,
    length_math: { spoken_words_per_second: 2.5, tolerance: '+/-20%' },
  }));
  db.prepare(
    "INSERT INTO content_items (title, status, script) VALUES ('Framework check', 'researched', ?)"
  ).run(validScriptJson());
  const engine = new ContentEngine(db);
  const result = engine.script();
  assert.equal(result.processed, 1); // parses the real framework format and passes
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
  db.prepare("UPDATE content_items SET research_notes = ? WHERE id IN (1, 2)").run(RESEARCH_NOTES);

  const re = engine.research();
  assert.equal(re.processed, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM content_items WHERE status = 'researched'").get().n, 2);

  // The agent (brain) writes the finished scripts — the engine only finalizes
  db.prepare("UPDATE content_items SET script = ? WHERE id IN (1, 2)").run(validScriptJson());

  const sc = engine.script();
  assert.equal(sc.processed, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM content_items WHERE status = 'scripted'").get().n, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM gates WHERE gate_type = 'script_review' AND status = 'pending'").get().n, 2);

  const items = db.prepare('SELECT script FROM content_items ORDER BY id').all();
  for (const item of items) {
    const s = JSON.parse(item.script);
    assert.ok(s.hook.length > 0);
    assert.ok(s.cta.length > 0);
    assert.ok(s.points.length >= 1);
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
