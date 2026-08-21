// Reset content items to the agent-ready state.
//
// The engine never writes content — the agent (the brain) writes research
// notes, scripts, and shot instructions. This script purges any placeholder
// content (template scripts, template research notes) and resets items so
// the agent can do real content work:
//
//   scripted -> researched, script/shot_instructions/research_notes cleared,
//   pending script_review gates deleted.
//
// Usage: node scripts/reset-content.mjs
import { connect } from '@content-os/core';

const db = connect();

// 1. Purge scripts + shot instructions
const purged = db.prepare(
  "UPDATE content_items SET script = NULL, shot_instructions = NULL, updated_at = datetime('now') " +
  'WHERE script IS NOT NULL OR shot_instructions IS NOT NULL'
).run();
console.log('purged scripts/shot_instructions:', purged.changes);

// 2. Reset scripted items back to researched (content work is the agent's job now)
const reset = db.prepare(
  "UPDATE content_items SET status = 'researched', updated_at = datetime('now') WHERE status = 'scripted'"
).run();
console.log('reset scripted -> researched:', reset.changes);

// 3. Delete pending script_review gates (they were requested for placeholder scripts)
const gates = db.prepare(
  "DELETE FROM gates WHERE gate_type = 'script_review' AND status = 'pending'"
).run();
console.log('deleted pending script_review gates:', gates.changes);

// 4. Also purge placeholder research notes (template echoes)
const notes = db.prepare(
  "UPDATE content_items SET research_notes = NULL, updated_at = datetime('now') WHERE research_notes LIKE 'Research for:%'"
).run();
console.log('purged placeholder research_notes:', notes.changes);

// Verify
const statuses = db.prepare('SELECT status, COUNT(*) AS n FROM content_items GROUP BY status').all();
console.log('\nStatus distribution:', statuses.map((s) => `${s.status}:${s.n}`).join(', '));
const withScript = db.prepare('SELECT COUNT(*) AS n FROM content_items WHERE script IS NOT NULL').get();
console.log('items with script:', withScript.n);
const pendingGates = db.prepare(
  "SELECT gate_type, COUNT(*) AS n FROM gates WHERE status = 'pending' GROUP BY gate_type"
).all();
console.log('pending gates:', pendingGates.length ? pendingGates.map((g) => `${g.gate_type}:${g.n}`).join(', ') : 'none');
db.close();