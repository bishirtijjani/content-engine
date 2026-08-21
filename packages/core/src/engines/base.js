// Base class for the five engines.
//
// Each engine is a worker that picks up records in the states it owns and
// moves them forward. The base class provides the execution log and a survey
// helper; each engine declares its contract (ACTIONS) and implements run().
//
// Engines log every execution to `engine_logs` so the whole system is auditable.

export class BaseEngine {
  static NAME = '';          // content | production | distribution | engagement | analytics
  static OWNED_STATES = [];  // content_item statuses this engine moves items out of
  static ACTIONS = [];       // capability contract — what this engine will do when implemented

  constructor(db) {
    this.db = db;
  }

  get name() {
    return this.constructor.NAME;
  }

  /** Append a row to the engine execution log. */
  log(action, { status = 'success', targetType = null, targetId = null, message = null } = {}) {
    this.db.prepare(
      'INSERT INTO engine_logs (engine, action, target_type, target_id, status, message) ' +
      'VALUES (?, ?, ?, ?, ?, ?)'
    ).run(this.name, action, targetType, targetId, status, message);
  }

  /** Count content items sitting in this engine's owned states. */
  surveyItems() {
    const states = this.constructor.OWNED_STATES;
    if (!states.length) return {};
    const placeholders = states.map(() => '?').join(',');
    const rows = this.db.prepare(
      `SELECT status, COUNT(*) AS n FROM content_items WHERE status IN (${placeholders}) GROUP BY status`
    ).all(...states);
    return Object.fromEntries(rows.map((r) => [r.status, r.n]));
  }

  /**
   * Default run: survey owned states and log what would be processed.
   * Real automation overrides this. The survey proves the pick-up pattern:
   * each engine knows exactly which items are waiting on it.
   */
  run({ targetId = null, options = {} } = {}) {
    const counts = this.surveyItems();
    const summary = Object.entries(counts)
      .map(([s, n]) => `${s}: ${n}`)
      .join(', ') || 'none';
    this.log('survey', {
      message: `found items in owned states — ${summary} (automation not yet implemented)`,
    });
    return counts;
  }
}