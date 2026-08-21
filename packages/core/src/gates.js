// Human decision gates — the three non-negotiable checkpoints.
//
// 1. idea_approval  — "yes, I'll spend my face-time on this" (before planning)
// 2. asset_review   — "the finished video is good enough to ship" (before scheduling)
// 3. escalation     — money, reputation, angry customers (in engagement)
//
// Gates are records in the `gates` table. Engines request them; humans decide.
// The state machine (state.js) refuses transitions whose gate is not approved.

/** Create a pending gate. Returns the gate id. */
export function requestGate(db, gateType, targetType, targetId, { requestedBy = 'engine', note = null } = {}) {
  const res = db.prepare(
    'INSERT INTO gates (gate_type, target_type, target_id, requested_by, requested_note) ' +
    'VALUES (?, ?, ?, ?, ?)'
  ).run(gateType, targetType, targetId, requestedBy, note);
  return Number(res.lastInsertRowid);
}

/** Approve or reject a pending gate. Returns the gate row. */
export function decideGate(db, gateId, decision, { decidedBy = 'human', notes = null } = {}) {
  if (!['approved', 'rejected'].includes(decision)) {
    throw new Error(`invalid decision: ${decision} (use 'approved' or 'rejected')`);
  }
  const row = db.prepare('SELECT * FROM gates WHERE id = ?').get(gateId);
  if (!row) throw new Error(`gate ${gateId} not found`);
  if (row.status !== 'pending') throw new Error(`gate ${gateId} is already ${row.status}`);
  db.prepare(
    "UPDATE gates SET status = ?, decided_by = ?, decision_notes = ?, " +
    "decided_at = datetime('now') WHERE id = ?"
  ).run(decision, decidedBy, notes, gateId);
  return row;
}

/** The most recent pending gate for a target, or undefined. */
export function latestPending(db, gateType, targetType, targetId) {
  return db.prepare(
    "SELECT * FROM gates WHERE gate_type = ? AND target_type = ? " +
    "AND target_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1"
  ).get(gateType, targetType, targetId);
}

export function listGates(db, status = null) {
  if (status) {
    return db.prepare('SELECT * FROM gates WHERE status = ? ORDER BY id DESC').all(status);
  }
  return db.prepare('SELECT * FROM gates ORDER BY id DESC').all();
}