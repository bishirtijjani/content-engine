// Live smoke test: full Content Engine pipeline on the real DB.
// Uses the engine directly — no CLI.
import { connect, decideGate } from '@content-os/core';
import { ContentEngine } from '@content-os/engine-content';

const db = connect();
const engine = new ContentEngine(db);

console.log('=== content-os: Content Engine smoke test ===\n');

// 1. Check current state
const count = db.prepare('SELECT COUNT(*) as n FROM content_items').get();
console.log(`Items in DB: ${count.n}`);

const statuses = db.prepare('SELECT status, COUNT(*) as n FROM content_items GROUP BY status').all();
console.log('Status distribution:', statuses.map(s => `${s.status}: ${s.n}`).join(', '));

// 2. The agent generates fresh ideas for this cycle (never a static bank)
if (count.n === 0) {
  console.log('\nAgent generating fresh ideas...');
  engine.addIdeas([
    { title: 'Smoke test idea A — automation build walkthrough', source: 'experience', pillar: 'workflow-automation' },
    { title: 'Smoke test idea B — custom tool vs SaaS costs', source: 'trend', pillar: 'business-operations' },
  ]);
}

// 3. Run the full pipeline
console.log('\n--- Running content engine pipeline ---');
const result = engine.pipeline();
console.log(JSON.stringify(result, null, 2));

// 4. Approve all pending idea gates so items can advance
const pendingGates = db.prepare(
  "SELECT id, target_id FROM gates WHERE gate_type = 'idea_approval' AND status = 'pending'"
).all();
console.log(`\nApproving ${pendingGates.length} idea gate(s)...`);
for (const g of pendingGates) {
  decideGate(db, g.id, 'approved', { decidedBy: 'smoke-test' });
}

// 5. Run plan, then the agent writes content and the engine finalizes
console.log('\n--- Running plan ---');
engine.plan();

// The agent (the brain) writes the content — the engine never writes content
const planned = db.prepare("SELECT id, title FROM content_items WHERE status = 'planned'").all();
console.log(`\nAgent writing content for ${planned.length} planned item(s)...`);
for (const p of planned) {
  db.prepare(
    "UPDATE content_items SET research_notes = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(
    `Facts: verified during research.\nSources: primary documentation and vendor pages.\nClaims to verify: benchmark numbers before recording.`,
    p.id,
  );
  db.prepare(
    "UPDATE content_items SET script = ?, shot_instructions = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(
    `Hook: ${p.title}\n\nPoint 1: The problem\nPoint 2: The build\nPoint 3: The result\n\nCTA: follow for more`,
    'talking head + screen share',
    p.id,
  );
}

console.log('\n--- Running research + script (engine finalizes agent content) ---');
engine.research();
engine.script();

// 5. Check final state
const final = db.prepare('SELECT status, COUNT(*) as n FROM content_items GROUP BY status').all();
console.log('\nFinal status distribution:');
for (const s of final) {
  console.log(`  ${s.status}: ${s.n}`);
}

// 6. Show a scripted item
const scripted = db.prepare(
  "SELECT id, title, script, hook_style FROM content_items WHERE status = 'scripted' LIMIT 1"
).get();
if (scripted) {
  console.log(`\nScripted item #${scripted.id}: ${scripted.title}`);
  console.log(`Hook style: ${scripted.hook_style}`);
  console.log(`Script:\n${scripted.script}`);
}

// 7. Show gates
const gates = db.prepare('SELECT gate_type, status, COUNT(*) as n FROM gates GROUP BY gate_type, status').all();
console.log('\nGates:');
for (const g of gates) {
  console.log(`  ${g.gate_type}: ${g.status} (${g.n})`);
}

db.close();
console.log('\n=== smoke test complete ===');
