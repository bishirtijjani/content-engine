// Live demo: the agent (the brain) drives the Content Engine (the muscle).
//
// Flow: approve idea gates → run deterministic stages → the agent writes the
// content (research notes + finished script) → the engine finalizes → review
// the script in the UI (ui/).
import { connect, decideGate } from '@content-os/core';
import { ContentEngine } from '@content-os/engine-content';

const db = connect();
const engine = new ContentEngine(db);

// Check state
const count = db.prepare('SELECT COUNT(*) as n FROM content_items').get();
console.log(`\nItems in DB: ${count.n}`);

// THE AGENT IS THE BRAIN — generate fresh ideas for this cycle.
// In production these come from brand knowledge, trend research, audience
// gaps, and what hasn't been covered yet. Never a static bank.
const existing = db.prepare('SELECT COUNT(*) as n FROM content_items').get().n;
if (existing === 0) {
  console.log('\nGenerating fresh ideas for this cycle...');
  engine.addIdeas([
    { title: 'Your CRM is a spreadsheet with extra steps — here is the fix', source: 'experience', pillar: 'customer-acquisition', hook_style: 'contrarian', priority: 'high' },
    { title: 'The invoice automation that gave my client 8 hours back every week', source: 'experience', pillar: 'workflow-automation', hook_style: 'story', priority: 'high' },
    { title: 'AI customer support that actually works — not a chatbot that says "I dont understand"', source: 'trend', pillar: 'ai-implementation', hook_style: 'problem_statement', priority: 'high' },
  ]);
}

// Approve all pending idea gates
const pending = db.prepare("SELECT id, target_id FROM gates WHERE gate_type = 'idea_approval' AND status = 'pending'").all();
console.log(`Approving ${pending.length} idea gate(s)...`);
for (const g of pending) {
  decideGate(db, g.id, 'approved', { decidedBy: 'demo', notes: 'approved for demo' });
}

// Run the deterministic stages (discover → evaluate → plan)
console.log('\n--- Running content engine pipeline (deterministic stages) ---');
const result = engine.pipeline();
console.log(JSON.stringify(result, null, 2));

// The agent is the brain: pick the highest-priority planned item and write
// the content. The engine never writes content — it only finalizes.
const candidate = db.prepare(
  "SELECT * FROM content_items WHERE status = 'planned' ORDER BY priority = 'high' DESC, id LIMIT 1"
).get();

if (candidate) {
  console.log(`\n--- Agent writing content for item #${candidate.id}: ${candidate.title} ---`);

  // Agent writes research notes
  db.prepare(
    "UPDATE content_items SET research_notes = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(
    `Facts: verified during research.\nSources: primary documentation and vendor pages.\nClaims to verify: benchmark numbers before recording.`,
    candidate.id,
  );
  engine.research({ targetId: candidate.id });

  // Agent writes the finished script + shot instructions
  db.prepare(
    "UPDATE content_items SET script = ?, shot_instructions = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(
    `Hook: ${candidate.title}\n\nPoint 1: The problem\nPoint 2: The build\nPoint 3: The result\n\nCTA: follow for more`,
    'talking head + screen share',
    candidate.id,
  );
  engine.script({ targetId: candidate.id });

  // Review the agent-written script in the UI (ui/)
  const item = db.prepare('SELECT * FROM content_items WHERE id = ?').get(candidate.id);
  console.log(`\n--- Script #${item.id} ready — review and edit it in the UI (ui/) ---`);
  db.close();
} else {
  console.log('\nNo planned items to script. Status distribution:');
  const statuses = db.prepare('SELECT status, COUNT(*) as n FROM content_items GROUP BY status').all();
  console.log(statuses);
  db.close();
}