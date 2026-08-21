// The content state machine — the single source of truth for how a piece of
// content moves through the system.
//
// Every content item is one record in `content_items` whose `status` field is
// its current state. The five engines are just workers that pick up items in
// the states they own and move them forward. This module enforces that no one
// (engine or human) can jump states illegally.
//
// States:
//   idea -> evaluated -> planned -> researched -> scripted -> ready_to_shoot
//        -> shot -> editing -> scheduled -> published -> measured -> archived
//
//   failed is a side state reachable from any production/distribution state;
//   from failed you may retry back into the pipeline.
//
// Fast-track: content stages may be compressed (breaking news) — but only
// content stages, never production stages, and every gated edge on the
// crossed path must still have an approved gate. Skipped states are recorded
// in the audit trail. Fast-track compresses WORK, never VALIDATION.

export const STATUSES = [
  'idea', 'evaluated', 'planned', 'researched', 'scripted',
  'ready_to_shoot', 'shot', 'editing', 'scheduled', 'published',
  'measured', 'archived', 'failed',
];

// Human decision gates required for specific transitions.
// key = "from->to", value = gate_type
export const GATE_REQUIREMENTS = {
  'evaluated->planned': 'idea_approval',       // "I'll spend my face-time on this"
  'scripted->ready_to_shoot': 'script_review', // "this script is worth recording"
  'editing->scheduled': 'asset_review',        // "the finished video is good enough to ship"
};

// Allowed transitions. Anything not listed here is illegal.
export const TRANSITIONS = {
  idea:           new Set(['evaluated', 'archived']),
  evaluated:      new Set(['planned', 'archived']),
  planned:        new Set(['researched', 'archived']),
  researched:     new Set(['scripted', 'archived']),
  scripted:       new Set(['ready_to_shoot', 'archived']),
  ready_to_shoot: new Set(['shot', 'archived']),
  shot:           new Set(['editing', 'failed']),
  editing:        new Set(['scheduled', 'archived', 'failed']),
  scheduled:      new Set(['published', 'failed', 'archived']),
  published:      new Set(['measured', 'archived', 'failed']),
  measured:       new Set(['archived']),
  archived:       new Set(),
  failed:         new Set([
    'idea', 'evaluated', 'planned', 'researched', 'scripted',
    'ready_to_shoot', 'shot', 'editing', 'scheduled', 'published',
  ]),
};

// Fast-track may only land on content stages — never past shooting/editing.
// A video that wasn't shot cannot be published.
export const FAST_TRACK_TARGETS = new Set([
  'evaluated', 'planned', 'researched', 'scripted', 'ready_to_shoot',
]);

export class StateError extends Error {}

export function canTransition(fromStatus, toStatus) {
  const allowed = TRANSITIONS[fromStatus];
  return allowed ? allowed.has(toStatus) : false;
}

/** Return the gate_type required for this transition, or null. */
export function gateRequired(fromStatus, toStatus) {
  return GATE_REQUIREMENTS[`${fromStatus}->${toStatus}`] ?? null;
}

/**
 * Move a content item between states.
 * Enforces the transition table and any required human gate, updates the
 * item, and appends to the audit history. Returns { from, to }.
 */
export function transition(db, itemId, toStatus, { actor = 'engine', reason = null } = {}) {
  const row = db.prepare('SELECT id, status FROM content_items WHERE id = ?').get(itemId);
  if (!row) throw new StateError(`content item ${itemId} not found`);
  const fromStatus = row.status;

  if (!canTransition(fromStatus, toStatus)) {
    throw new StateError(`invalid transition: ${fromStatus} -> ${toStatus}`);
  }

  const gate = gateRequired(fromStatus, toStatus);
  if (gate && !gateApproved(db, gate, itemId)) {
    throw new StateError(
      `transition ${fromStatus} -> ${toStatus} requires an approved ` +
      `'${gate}' gate for content item ${itemId} — approve it first`
    );
  }

  db.prepare(
    "UPDATE content_items SET status = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(toStatus, itemId);
  db.prepare(
    'INSERT INTO content_item_history (content_item_id, from_status, to_status, actor, reason) ' +
    'VALUES (?, ?, ?, ?, ?)'
  ).run(itemId, fromStatus, toStatus, actor, reason);
  return { from: fromStatus, to: toStatus };
}

/**
 * Fast-track: jump forward across content stages (breaking news, urgent
 * topics). Safety rules:
 *   - target must be a content stage (never past shooting/editing)
 *   - a reason is mandatory and recorded
 *   - every gated edge on the crossed path must have an approved gate
 *   - skipped states are recorded in the audit trail
 */
export function fastTrack(db, itemId, toStatus, { actor = 'engine', reason = null } = {}) {
  if (!reason) {
    throw new StateError('fast-track requires a reason (e.g. "breaking news")');
  }
  if (!FAST_TRACK_TARGETS.has(toStatus)) {
    throw new StateError(
      `fast-track target '${toStatus}' is not a content stage — ` +
      'fast-track may only compress thinking stages, never production'
    );
  }
  const row = db.prepare('SELECT id, status FROM content_items WHERE id = ?').get(itemId);
  if (!row) throw new StateError(`content item ${itemId} not found`);
  const fromStatus = row.status;

  if (fromStatus === toStatus) {
    throw new StateError(`fast-track: item is already '${toStatus}'`);
  }

  const path = findPath(fromStatus, toStatus);
  if (!path) {
    throw new StateError(`no path from '${fromStatus}' to '${toStatus}'`);
  }

  // Every gated edge on the path must have an approved gate — fast-track
  // compresses work, never validation.
  for (let i = 0; i < path.length - 1; i++) {
    const gate = gateRequired(path[i], path[i + 1]);
    if (gate && !gateApproved(db, gate, itemId)) {
      throw new StateError(
        `fast-track ${fromStatus} -> ${toStatus} crosses '${gate}' gate ` +
        `(${path[i]} -> ${path[i + 1]}) which is not approved — approve it first`
      );
    }
  }

  const skipped = path.slice(1, -1); // intermediate states the item never entered
  db.prepare(
    "UPDATE content_items SET status = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(toStatus, itemId);
  db.prepare(
    'INSERT INTO content_item_history (content_item_id, from_status, to_status, actor, reason, skipped_states) ' +
    'VALUES (?, ?, ?, ?, ?, ?)'
  ).run(itemId, fromStatus, toStatus, actor, reason, JSON.stringify(skipped));
  return { from: fromStatus, to: toStatus, skipped };
}

/** BFS over the normal transition graph. Returns the state path or null. */
function findPath(fromStatus, toStatus) {
  if (fromStatus === toStatus) return [fromStatus];
  const queue = [[fromStatus]];
  const visited = new Set([fromStatus]);
  while (queue.length) {
    const path = queue.shift();
    const last = path[path.length - 1];
    for (const next of TRANSITIONS[last] ?? []) {
      if (visited.has(next)) continue;
      const newPath = [...path, next];
      if (next === toStatus) return newPath;
      visited.add(next);
      queue.push(newPath);
    }
  }
  return null;
}

function gateApproved(db, gateType, itemId) {
  const row = db.prepare(
    "SELECT status FROM gates WHERE gate_type = ? AND target_type = 'content_item' " +
    'AND target_id = ? ORDER BY id DESC LIMIT 1'
  ).get(gateType, itemId);
  return row !== undefined && row.status === 'approved';
}