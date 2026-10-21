// Content Engine — "What should we create?"
//
// Pipeline: Discover → Evaluate → Plan → Research → Script
// Output:   READY TO SHOOT (content item in status `ready_to_shoot`)
//
// Owned states: idea, evaluated, planned, researched, scripted, ready_to_shoot
//
// The engine is the muscle. The AI agent is the brain.
// The engine processes items in the right status and moves them forward.
// The agent reads the DB, makes decisions, and writes them back.
//
// CONTENT CONTRACT: the engine never writes content. `research()` and
// `script()` only FINALIZE agent-written content — they move items forward
// and request gates, but they never generate research notes or scripts.
// The agent writes `research_notes`, `script`, and `shot_instructions`
// directly; items without them are skipped and logged. No placeholders.
//
// Usage:
//   engine.run()                           — full pipeline
//   engine.run({ action: 'evaluate' })     — specific action
//   engine.run({ targetId: 3 })            — process specific item
//   engine.run({ dryRun: true })           — preview without changes
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { BaseEngine, PROJECT_ROOT, contentItem, playbookRule, transition, requestGate, makePaths } from '@content-os/core';

// ---------------------------------------------------------------------------
// Scoring weights — configurable via settings.content_weights
// ---------------------------------------------------------------------------
const DEFAULT_WEIGHTS = {
  pillarRelevance: 25,
  audienceInterest: 20,
  trendPotential: 15,
  authorityFit: 15,
  engagementPotential: 10,
  businessValue: 10,
  novelty: 5,
};

const SOURCE_SCORES = {
  question: 90,
  past_success: 85,
  trend: 80,
  comment: 70,
  product: 70,
  forum: 60,
  experience: 60,
  competitor: 50,
  other: 50,
};

const FORMAT_LENGTHS = {
  short: 30,
  talking_head: 60,
  hybrid: 75,
  screen_recording: 90,
  long: 180,
};

// ---------------------------------------------------------------------------
// Structural quality floor — enforced by script()/research() before an item
// can move forward. Garbage never reaches the human review gates.
// ---------------------------------------------------------------------------
const PLACEHOLDER_PATTERNS = [
  { re: /^point \d+:/im, label: '"Point N:" template heading' },
  { re: /evidence and supporting/i, label: '"Evidence and supporting" template text' },
  { re: /lorem ipsum/i, label: 'lorem ipsum filler' },
  { re: /\btbd\b/i, label: 'TBD marker' },
  { re: /\[insert /i, label: '[insert ...] stub' },
  { re: /placeholder/i, label: 'placeholder marker' },
];
const MIN_RESEARCH_CHARS = 100;

// "+/-20%" | 0.2 | 20 → 0.2 ; anything else → null (caller applies default)
function parseTolerance(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value > 1 ? value / 100 : value;
  if (typeof value === 'string') {
    const m = value.match(/(\d+(?:\.\d+)?)\s*%/);
    if (m) return Number(m[1]) / 100;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Content Engine
// ---------------------------------------------------------------------------
export class ContentEngine extends BaseEngine {
  static NAME = 'content';
  static OWNED_STATES = ['idea', 'evaluated', 'planned', 'researched', 'scripted', 'ready_to_shoot'];
  static ACTIONS = ['discover', 'evaluate', 'plan', 'research', 'script', 'ready', 'resubmit'];

  /**
   * Run the content engine.
   * @param {Object} opts
   * @param {number} [opts.targetId] - Process a specific item only
   * @param {string} [opts.action]   - Run a specific action
   * @param {boolean} [opts.dryRun]  - Preview without changes
   */
  run({ targetId = null, action = null, dryRun = false } = {}) {
    if (action) {
      if (!this.constructor.ACTIONS.includes(action)) {
        throw new Error(`unknown content action '${action}' — available: ${this.constructor.ACTIONS.join(', ')}`);
      }
      return this[action]({ targetId, dryRun });
    }
    return this.pipeline({ targetId, dryRun });
  }

  /**
   * Full pipeline: discover → evaluate → plan → research → script → ready.
   */
  pipeline({ targetId = null, dryRun = false } = {}) {
    const results = {};
    results.discover = this.discover({ targetId, dryRun });
    results.evaluate = this.evaluate({ targetId, dryRun });
    results.plan = this.plan({ targetId, dryRun });
    results.research = this.research({ targetId, dryRun });
    results.script = this.script({ targetId, dryRun });
    results.ready = this.ready({ targetId, dryRun });

    const total = Object.values(results).reduce((s, r) => s + (r.processed ?? 0), 0);
    this.log('pipeline', {
      message: `full pipeline: ${total} item(s) processed — ` +
        Object.entries(results).map(([k, v]) => `${k}:${v.processed ?? 0}`).join(' '),
    });
    return results;
  }

  // =========================================================================
  // DISCOVER — register fresh ideas from live sources
  // -------------------------------------------------------------------------
  // Ideas are generated FRESH each cycle — never pulled from a static bank.
  // Two entry points:
  //   addIdeas([...])  — the agent (the brain) generates new ideas each run
  //                      from brand knowledge, trends, and what hasn't been
  //                      covered yet, then registers them here.
  //   discover()       — picks up audience ideas (engagement items classified
  //                      as 'idea') and moves them into the pipeline.
  // =========================================================================

  /**
   * Register fresh agent-generated ideas. Dedupes by title against ALL items
   * (any status) so the same topic is never registered twice.
   * @param {Array<Object>} ideas - [{ title, source?, pillar?, hook_style?, priority?, tags? }]
   * @returns {{ processed: number, duplicates: number }}
   */
  addIdeas(ideas = []) {
    if (!Array.isArray(ideas) || !ideas.length) {
      return { processed: 0, duplicates: 0 };
    }

    let created = 0;
    let duplicates = 0;

    for (const idea of ideas) {
      const title = typeof idea === 'string' ? idea : idea?.title;
      if (!title) continue;

      const existing = this.db.prepare(
        'SELECT id FROM content_items WHERE title = ?'
      ).get(title);
      if (existing) { duplicates++; continue; }

      const c = typeof idea === 'string' ? { title } : idea;
      this.db.prepare(
        'INSERT INTO content_items (title, source, source_url, pillar, format, hook_style, cta, priority, tags) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        c.title, c.source ?? 'other', c.source_url ?? null,
        c.pillar ?? null, c.format ?? null, c.hook_style ?? null,
        c.cta ?? null, c.priority ?? 'medium',
        c.tags ? JSON.stringify(c.tags) : null,
      );
      created++;
    }

    this.log('addIdeas', {
      message: `registered ${created} fresh idea(s), skipped ${duplicates} duplicate(s)`,
    });
    return { processed: created, duplicates };
  }

  discover({ targetId = null, dryRun = false } = {}) {
    const candidates = [];

    const engagementIdeas = this.db.prepare(
      "SELECT * FROM engagement_items WHERE classification = 'idea' AND status = 'new'"
    ).all();
    for (const e of engagementIdeas) {
      candidates.push({
        title: e.text.slice(0, 200),
        source: 'comment',
        _engagementId: e.id,
      });
    }

    if (!candidates.length) {
      this.log('discover', { message: 'no audience ideas to discover' });
      return { processed: 0 };
    }

    let created = 0;
    for (const c of candidates) {
      if (targetId) continue;

      const existing = this.db.prepare(
        'SELECT id FROM content_items WHERE title = ?'
      ).get(c.title);
      if (existing) continue;

      if (dryRun) { created++; continue; }

      const res = this.db.prepare(
        'INSERT INTO content_items (title, source, source_url, pillar, format, hook_style, cta, priority, tags) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        c.title, c.source ?? 'other', c.source_url ?? null,
        c.pillar ?? null, c.format ?? null, c.hook_style ?? null,
        c.cta ?? null, c.priority ?? 'medium',
        c.tags ? JSON.stringify(c.tags) : null,
      );

      if (c._engagementId) {
        this.db.prepare(
          "UPDATE engagement_items SET status = 'saved_as_idea', content_item_id = ? WHERE id = ?"
        ).run(Number(res.lastInsertRowid), c._engagementId);
      }
      created++;
    }

    this.log('discover', {
      message: dryRun ? `would discover ${created} idea(s) (dry run)` : `discovered ${created} audience idea(s)`,
    });
    return { processed: created };
  }

  // =========================================================================
  // EVALUATE — score ideas 0-100, move to evaluated, request idea gate
  // =========================================================================

  evaluate({ targetId = null, dryRun = false } = {}) {
    const where = targetId ? "WHERE id = ? AND status = 'idea'" : "WHERE status = 'idea'";
    const params = targetId ? [targetId] : [];
    const items = this.db.prepare(`SELECT * FROM content_items ${where} ORDER BY id`).all(...params);

    if (!items.length) {
      this.log('evaluate', { message: 'no ideas to evaluate' });
      return { processed: 0, items: [] };
    }

    const weights = this._loadWeights();
    const rules = this._loadPlaybookRules();
    const settings = this._loadSettings();
    const evaluated = [];

    for (const raw of items) {
      const item = contentItem(raw);
      const { score, reason } = this._scoreItem(item, weights, rules, settings);

      if (dryRun) {
        evaluated.push({ id: item.id, score });
        continue;
      }

      // Persist the evaluation so it is queryable (evaluation_score) and so
      // plan() can use the explanation as the video-angle fallback.
      this.db.prepare(
        "UPDATE content_items SET evaluation_score = ?, evaluation_reason = ?, updated_at = datetime('now') WHERE id = ?"
      ).run(score, reason, item.id);

      transition(this.db, item.id, 'evaluated', {
        actor: `engine:${this.name}`,
        reason: `evaluated ${score}/100`,
      });

      requestGate(this.db, 'idea_approval', 'content_item', item.id, {
        requestedBy: `engine:${this.name}`,
        note: `score ${score}/100 — ${reason}`,
      });

      this.log('evaluate', {
        targetType: 'content_item', targetId: item.id,
        message: `scored ${score}/100 — idea_approval gate requested`,
      });

      evaluated.push({ id: item.id, score });
    }

    this.log('evaluate', {
      message: dryRun
        ? `would evaluate ${evaluated.length} idea(s) (dry run)`
        : `evaluated ${evaluated.length} idea(s)`,
    });
    return { processed: evaluated.length, items: evaluated };
  }

  // =========================================================================
  // PLAN — after idea gate approved, fill plan fields
  // =========================================================================

  plan({ targetId = null, dryRun = false } = {}) {
    const where = targetId ? "WHERE id = ? AND status = 'evaluated'" : "WHERE status = 'evaluated'";
    const params = targetId ? [targetId] : [];
    const items = this.db.prepare(`SELECT * FROM content_items ${where} ORDER BY id`).all(...params);

    if (!items.length) {
      this.log('plan', { message: 'no evaluated items ready for planning' });
      return { processed: 0, skipped: 0 };
    }

    const rules = this._loadPlaybookRules();
    const settings = this._loadSettings();
    let processed = 0;
    let skipped = 0;

    for (const raw of items) {
      const item = contentItem(raw);

      if (!this._isGateApproved('idea_approval', item.id)) {
        this.log('plan', {
          targetType: 'content_item', targetId: item.id, status: 'skipped',
          message: 'waiting for idea_approval gate',
        });
        skipped++;
        continue;
      }

      if (dryRun) { processed++; continue; }

      const plan = this._buildPlan(item, rules, settings);

      // Ensure all values are SQLite-compatible (no undefined)
      for (const k of Object.keys(plan)) {
        if (plan[k] === undefined) plan[k] = null;
      }

      this.db.prepare(
        `UPDATE content_items SET
          pillar = COALESCE(?, pillar),
          format = COALESCE(?, format),
          angle = COALESCE(?, angle),
          target_audience = COALESCE(?, target_audience),
          hook_style = COALESCE(?, hook_style),
          cta = COALESCE(?, cta),
          desired_length_seconds = COALESCE(?, desired_length_seconds),
          series = COALESCE(?, series),
          updated_at = datetime('now')
        WHERE id = ?`
      ).run(
        plan.pillar, plan.format, plan.angle,
        plan.target_audience, plan.hook_style, plan.cta,
        plan.desired_length_seconds, plan.series,
        item.id,
      );

      transition(this.db, item.id, 'planned', {
        actor: `engine:${this.name}`,
        reason: `planned: ${plan.pillar}/${plan.format} hook=${plan.hook_style} ${plan.desired_length_seconds}s`,
      });

      processed++;
    }

    this.log('plan', {
      message: dryRun
        ? `would plan ${processed} item(s), skip ${skipped} (dry run)`
        : `planned ${processed} item(s), skipped ${skipped}`,
    });
    return { processed, skipped };
  }

  // =========================================================================
  // RESEARCH — finalize agent-written research, move to researched
  // -------------------------------------------------------------------------
  // The engine never writes content. The agent (the brain) researches the
  // topic and writes `research_notes` (facts, sources, claims to verify).
  // This action only finalizes: it moves items that already have research
  // notes to `researched`. Items without notes are skipped and logged.
  // =========================================================================

  research({ targetId = null, dryRun = false } = {}) {
    const where = targetId ? "WHERE id = ? AND status = 'planned'" : "WHERE status = 'planned'";
    const params = targetId ? [targetId] : [];
    const items = this.db.prepare(`SELECT * FROM content_items ${where} ORDER BY id`).all(...params);

    if (!items.length) {
      this.log('research', { message: 'no planned items ready for research' });
      return { processed: 0, skipped: 0 };
    }

    let processed = 0;
    let skipped = 0;
    for (const raw of items) {
      const item = contentItem(raw);

      if (!item.research_notes) {
        this.log('research', {
          targetType: 'content_item', targetId: item.id, status: 'skipped',
          message: 'waiting for agent-written research notes — the engine never writes content',
        });
        skipped++;
        continue;
      }

      if (dryRun) { processed++; continue; }

      // Quality floor: notes must carry real substance before the item moves.
      const check = this._checkResearchNotes(item.research_notes);
      if (!check.ok) {
        this.log('research', {
          targetType: 'content_item', targetId: item.id, status: 'skipped',
          message: `research notes rejected — ${check.error}`,
        });
        skipped++;
        continue;
      }

      transition(this.db, item.id, 'researched', {
        actor: `engine:${this.name}`,
        reason: 'research complete',
      });

      processed++;
    }

    this.log('research', {
      message: dryRun
        ? `would research ${processed} item(s), skip ${skipped} (dry run)`
        : `researched ${processed} item(s), skipped ${skipped}`,
    });
    return { processed, skipped };
  }

  // =========================================================================
  // SCRIPT — finalize agent-written script, request script gate
  // -------------------------------------------------------------------------
  // The engine never writes script content. The agent (the brain) writes the
  // finished shooting script into `script` (and `shot_instructions`). This
  // action only finalizes: it moves items that already have a script to
  // `scripted` and requests the `script_review` gate. Items without a script
  // are skipped and logged — no placeholders ever enter the database.
  // =========================================================================

  script({ targetId = null, dryRun = false } = {}) {
    const where = targetId ? "WHERE id = ? AND status = 'researched'" : "WHERE status = 'researched'";
    const params = targetId ? [targetId] : [];
    const items = this.db.prepare(`SELECT * FROM content_items ${where} ORDER BY id`).all(...params);

    if (!items.length) {
      this.log('script', { message: 'no researched items ready for scripting' });
      return { processed: 0, skipped: 0 };
    }

    let processed = 0;
    let skipped = 0;

    for (const raw of items) {
      const item = contentItem(raw);

      if (!item.script) {
        this.log('script', {
          targetType: 'content_item', targetId: item.id, status: 'skipped',
          message: 'waiting for agent-written script — the engine never writes script content',
        });
        skipped++;
        continue;
      }

      if (dryRun) { processed++; continue; }

      // Quality floor: refuse structurally invalid scripts BEFORE they can
      // reach the human review gate. The rejection reason is logged so the
      // agent knows exactly what to fix.
      const check = this._validateScript(this._parseScript(item.script), item);
      if (!check.ok) {
        this.log('script', {
          targetType: 'content_item', targetId: item.id, status: 'skipped',
          message: `script rejected by structural check — ${check.error}`,
        });
        skipped++;
        continue;
      }

      transition(this.db, item.id, 'scripted', {
        actor: `engine:${this.name}`,
        reason: 'script finalized',
      });

      requestGate(this.db, 'script_review', 'content_item', item.id, {
        requestedBy: `engine:${this.name}`,
        note: 'script ready for review',
      });

      processed++;
    }

    this.log('script', {
      message: dryRun
        ? `would script ${processed} item(s), skip ${skipped} (dry run)`
        : `scripted ${processed} item(s), skipped ${skipped}`,
    });
    return { processed, skipped };
  }

  // =========================================================================
  // READY — move gate-approved scripts into the shoot-ready queue
  // -------------------------------------------------------------------------
  // The engine's output is READY TO SHOOT. Items reach `scripted` when their
  // script is finalized; they become shoot-ready only after a human approves
  // the script_review gate. This action performs that final transition for
  // every scripted item whose latest gate verdict is `approved`.
  // =========================================================================

  ready({ targetId = null, dryRun = false } = {}) {
    const where = targetId ? "WHERE id = ? AND status = 'scripted'" : "WHERE status = 'scripted'";
    const params = targetId ? [targetId] : [];
    const items = this.db.prepare(`SELECT * FROM content_items ${where} ORDER BY id`).all(...params);

    if (!items.length) {
      this.log('ready', { message: 'no scripted items waiting to become shoot-ready' });
      return { processed: 0, skipped: 0 };
    }

    let processed = 0;
    let skipped = 0;
    for (const raw of items) {
      const item = contentItem(raw);

      if (this._latestGateStatus('script_review', item.id) !== 'approved') {
        this.log('ready', {
          targetType: 'content_item', targetId: item.id, status: 'skipped',
          message: 'script_review gate not approved yet',
        });
        skipped++;
        continue;
      }

      if (dryRun) { processed++; continue; }

      transition(this.db, item.id, 'ready_to_shoot', {
        actor: `engine:${this.name}`,
        reason: 'script approved — ready to shoot',
      });

      // The script is the spine of the clean. Freeze it into the item folder
      // the recording will be dropped into, so the file the human reads from IS
      // the script the cleaner aligns to. `data/item-<id>/script.txt`.
      const shoot = this._writeShootScript(item);

      this.log('ready', {
        targetType: 'content_item', targetId: item.id,
        message: shoot
          ? `moved to ready_to_shoot; record, then drop the video + audio in ${shoot.dir}`
          : 'moved to ready_to_shoot (no script.txt written — script missing or invalid)',
      });
      processed++;
    }

    this.log('ready', {
      message: dryRun
        ? `would move ${processed} item(s) to ready_to_shoot, skip ${skipped} (dry run)`
        : `${processed} item(s) ready to shoot, skipped ${skipped}`,
    });
    return { processed, skipped };
  }

  /**
   * Write the item's folder + `script.txt` for a ready item: the spoken lines,
   * one per line, from the approved script JSON (hook, then script, then cta).
   * Spoken words only — no point titles, no headers. Idempotent: it rewrites
   * script.txt and never touches any footage already in the folder.
   *
   * `data/item-<id>/` is the one folder this item owns (see core/paths.js):
   * script.txt for the human to read from, script.json as a mirror of
   * content_items.script so the folder is self-describing. The DB stays the
   * source of truth — both files are refreshed on every ready().
   *
   * @returns {{ dir: string, path: string } | null} null when there is no valid script
   */
  _writeShootScript(item) {
    const parsed = this._parseScript(item.script);
    if (!parsed) return null;
    const lines = [];
    for (const part of [parsed.hook, parsed.script, parsed.cta]) {
      if (typeof part !== 'string') continue;
      for (const chunk of part.split(/\r?\n/)) {
        for (const sentence of chunk.split(/(?<=[.!?])\s+/)) {
          const t = sentence.replace(/\s+/g, ' ').trim();
          if (t) lines.push(t);
        }
      }
    }
    if (!lines.length) return null;

    const p = makePaths(this._dataDir());
    const dir = p.itemDir(item.id);
    mkdirSync(dir, { recursive: true });
    const scriptPath = path.join(dir, 'script.txt');
    writeFileSync(scriptPath, `${lines.join('\n')}\n`, 'utf8');
    writeFileSync(p.scriptJson(item.id), `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
    return { dir: p.relative(dir), path: scriptPath };
  }

  /** Where the shoot folders live. Overridable so tests never touch the repo. */
  _dataDir() {
    return process.env.CONTENT_OS_DATA_DIR || path.join(PROJECT_ROOT, 'data');
  }

  // =========================================================================
  // RESUBMIT — revision loop after a rejected script review
  // -------------------------------------------------------------------------
  // When a human rejects the script_review gate, the item stays `scripted`
  // with a rejected gate. The agent edits the script (directly in the DB),
  // then calls this action to request a fresh review. Rejected gates remain
  // as history; each resubmit creates a new pending gate.
  //
  // Requires an explicit targetId: blanket-resubmitting every rejected item
  // would re-request reviews for scripts nobody actually revised.
  // =========================================================================

  resubmit({ targetId = null, dryRun = false } = {}) {
    if (!targetId) {
      throw new Error('resubmit requires { targetId } — name the item whose revised script should be re-reviewed');
    }
    const raw = this.db.prepare('SELECT * FROM content_items WHERE id = ?').get(targetId);
    if (!raw) throw new Error(`content item ${targetId} not found`);
    const item = contentItem(raw);

    if (item.status !== 'scripted') {
      throw new Error(`item ${item.id} is '${item.status}', expected 'scripted'`);
    }
    if (this._latestGateStatus('script_review', item.id) !== 'rejected') {
      throw new Error(`item ${item.id} has no rejected script_review to resubmit`);
    }
    if (!item.script) {
      throw new Error(`item ${item.id} has no script to resubmit`);
    }

    if (dryRun) {
      this.log('resubmit', { message: `would re-request script_review for item ${item.id} (dry run)` });
      return { processed: 1 };
    }

    requestGate(this.db, 'script_review', 'content_item', item.id, {
      requestedBy: `engine:${this.name}`,
      note: 'revised script — re-requesting review after rejection',
    });

    this.log('resubmit', {
      targetType: 'content_item', targetId: item.id,
      message: 'fresh script_review gate requested',
    });
    return { processed: 1 };
  }

  // =========================================================================
  // HELPERS
  // =========================================================================

  _loadWeights() {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = 'content_weights'").get();
    if (!row) return { ...DEFAULT_WEIGHTS };
    try { return { ...DEFAULT_WEIGHTS, ...JSON.parse(row.value) }; }
    catch { return { ...DEFAULT_WEIGHTS }; }
  }

  _loadPlaybookRules() {
    const rows = this.db.prepare("SELECT * FROM playbook_rules WHERE status = 'active'").all();
    return rows.map(playbookRule);
  }

  _loadSettings() {
    const result = {};
    const rows = this.db.prepare('SELECT key, value FROM settings').all();
    for (const r of rows) {
      try { result[r.key] = JSON.parse(r.value); }
      catch { result[r.key] = r.value; }
    }
    return result;
  }

  _loadScriptFramework() {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = 'script_framework'").get();
    if (!row) return null;
    try { return JSON.parse(row.value); }
    catch { return null; }
  }

  /**
   * Parse the stored script string. The content contract is structured JSON:
   * { hook, script, points[], cta, shot_notes }. Plain-text scripts are not
   * valid under the contract and are rejected with a clear error.
   */
  _parseScript(raw) {
    if (typeof raw !== 'string' || !raw.trim()) return null;
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  /**
   * Structural check for research notes: enough substance, no template junk.
   */
  _checkResearchNotes(notes) {
    const text = String(notes).trim();
    if (text.length < MIN_RESEARCH_CHARS) {
      return { ok: false, error: `notes too thin (${text.length} chars — need at least ${MIN_RESEARCH_CHARS})` };
    }
    for (const { re, label } of PLACEHOLDER_PATTERNS) {
      if (re.test(text)) return { ok: false, error: `placeholder content detected: ${label}` };
    }
    return { ok: true };
  }

  /**
   * Structural check for a parsed script object. Returns { ok, error }.
   *
   * Enforces the writing guide's shape requirements so the human review gate
   * only ever sees complete scripts:
   *   - required fields: hook, script, cta, shot_notes (non-empty strings)
   *   - points: non-empty array, every point titled
   *   - no placeholder/template markers
   *   - narration word count within tolerance of desired_length_seconds,
   *     using words-per-second + tolerance from settings.script_framework
   *     when present (defaults: 2.5 words/sec, ±20%)
   */
  _validateScript(parsed, item) {
    if (!parsed) {
      return { ok: false, error: 'script must be structured JSON: { hook, script, points[], cta, shot_notes }' };
    }

    for (const field of ['hook', 'script', 'cta', 'shot_notes']) {
      if (typeof parsed[field] !== 'string' || !parsed[field].trim()) {
        return { ok: false, error: `missing or empty '${field}'` };
      }
    }
    if (!Array.isArray(parsed.points) || parsed.points.length < 1) {
      return { ok: false, error: "'points' must be a non-empty array" };
    }
    for (let i = 0; i < parsed.points.length; i++) {
      const p = parsed.points[i];
      if (!p || typeof p !== 'object' || typeof p.title !== 'string' || !p.title.trim()) {
        return { ok: false, error: `points[${i}] needs a non-empty 'title'` };
      }
    }

    // Placeholder scan. Core fields get the full list; shot_notes skip the
    // literal word "placeholder" because notes may legitimately reference
    // placeholder media ("drop in placeholder screenshot").
    const coreText = [parsed.hook, parsed.script, parsed.cta,
      ...parsed.points.map((p) => `${p.title} ${p.detail ?? ''}`)].join('\n');
    for (const { re, label } of PLACEHOLDER_PATTERNS) {
      if (re.test(coreText)) return { ok: false, error: `placeholder content detected: ${label}` };
    }
    for (const { re, label } of PLACEHOLDER_PATTERNS.filter((p) => p.label !== 'placeholder marker')) {
      if (re.test(parsed.shot_notes)) return { ok: false, error: `placeholder content in shot_notes: ${label}` };
    }

    // Length math.
    const framework = this._loadScriptFramework();
    const lm = framework?.length_math ?? {};
    const wps = Number(lm.spoken_words_per_second) > 0 ? Number(lm.spoken_words_per_second) : 2.5;
    const tolerance = parseTolerance(lm.tolerance) ?? 0.2;
    const seconds = Number(item.desired_length_seconds) > 0 ? Number(item.desired_length_seconds) : 60;
    const words = parsed.script.trim().split(/\s+/).length;
    const target = seconds * wps;
    const min = Math.floor(target * (1 - tolerance));
    const max = Math.ceil(target * (1 + tolerance));
    if (words < min || words > max) {
      return {
        ok: false,
        error: `narration is ${words} spoken words — expected ${min}-${max} for a ${seconds}s item at ${wps} words/sec`,
      };
    }

    return { ok: true };
  }

  _latestGateStatus(gateType, itemId) {
    const row = this.db.prepare(
      "SELECT status FROM gates WHERE gate_type = ? AND target_type = 'content_item' " +
      'AND target_id = ? ORDER BY id DESC LIMIT 1'
    ).get(gateType, itemId);
    return row?.status ?? null;
  }

  _isGateApproved(gateType, itemId) {
    return this._latestGateStatus(gateType, itemId) === 'approved';
  }

  /**
   * Score an idea 0-100 and explain why. Returns { score, reason } where
   * `reason` lists every non-zero contribution — it is stored as
   * evaluation_reason and doubles as plan()'s angle fallback.
   */
  _scoreItem(item, weights, rules, settings = {}) {
    const parts = [];
    const add = (label, points) => {
      if (points > 0) parts.push(`${label} +${Math.round(points * 10) / 10}`);
      return points;
    };

    let score = 0;

    // Pillar relevance: known pillars come from settings.pillars (always
    // present on a seeded production DB) plus any playbook pillar rules.
    // Playbook rules alone would leave a fresh production DB with no
    // known pillars at all.
    const settingPillars = Array.isArray(settings.pillars) ? settings.pillars : [];
    const playbookPillars = rules.filter((r) => r.dimension === 'pillar').map((r) => r.dimension_value);
    const knownPillars = [...new Set([...settingPillars, ...playbookPillars])];
    if (item.pillar && knownPillars.includes(item.pillar)) {
      score += add(`pillar ${item.pillar}`, weights.pillarRelevance);
    } else if (item.pillar) {
      score += weights.pillarRelevance * 0.5; // unknown pillar — half credit
    }

    const srcScore = SOURCE_SCORES[item.source] ?? 50;
    score += add(`audience source ${item.source}`, (srcScore / 100) * weights.audienceInterest);

    const trendingTopics = rules.filter((r) => r.dimension === 'topic').map((r) => r.dimension_value);
    const itemTags = item.tags ?? [];
    const trendHits = itemTags.filter((t) => trendingTopics.includes(t)).length;
    score += add(`trend ${trendHits}/3 tags`, Math.min(1, trendHits / 3) * weights.trendPotential);

    const authorityPillars = rules.filter((r) => r.dimension === 'pillar' && r.effect === 'up').map((r) => r.dimension_value);
    if (item.pillar && authorityPillars.includes(item.pillar)) score += add('authority fit', weights.authorityFit);

    const engagingHooks = rules.filter((r) => r.dimension === 'hook_style' && r.effect === 'up').map((r) => r.dimension_value);
    if (item.hook_style && engagingHooks.includes(item.hook_style)) score += add(`hook ${item.hook_style}`, weights.engagementPotential);

    const prioScores = { high: 1.0, medium: 0.6, low: 0.3 };
    score += add(`priority ${item.priority ?? 'medium'}`, (prioScores[item.priority] ?? 0.5) * weights.businessValue);

    const sourceCount = this.db.prepare('SELECT COUNT(*) AS n FROM content_items WHERE source = ?').get(item.source)?.n ?? 0;
    score += add('novelty', Math.max(0, 1 - sourceCount / 10) * weights.novelty);

    return {
      score: Math.round(Math.min(100, Math.max(0, score))),
      reason: parts.length ? parts.join(' · ') : 'no scoring signals',
    };
  }

  _buildPlan(item, rules, settings) {
    const plan = {};
    const hookRules = rules.filter((r) => r.dimension === 'hook_style' && r.effect === 'up')
      .sort((a, b) => (b.magnitude ?? 1) - (a.magnitude ?? 1));
    const preferredHooks = Array.isArray(settings.hooks_preferred) ? settings.hooks_preferred : [];
    plan.hook_style = item.hook_style
      ?? hookRules[0]?.dimension_value      // learned from performance data
      ?? preferredHooks[0]                  // creator's stated preference order
      ?? 'question';
    const formatRules = rules.filter((r) => r.dimension === 'format' && r.effect === 'up')
      .sort((a, b) => (b.magnitude ?? 1) - (a.magnitude ?? 1));
    plan.format = item.format ?? formatRules[0]?.dimension_value ?? 'talking_head';
    // Pillar: keep what the item declares; else match its tags against the
    // configured pillars; else playbook default; else first configured pillar.
    // Never invent a pillar that is not one of the brand's real ones.
    const settingPillars = Array.isArray(settings.pillars) ? settings.pillars : [];
    const tagMatch = (item.tags ?? []).find((t) => settingPillars.includes(t));
    const pillarRules = rules.filter((r) => r.dimension === 'pillar');
    plan.pillar = item.pillar ?? tagMatch ?? pillarRules[0]?.dimension_value ?? settingPillars[0] ?? null;
    const lengthRules = rules.filter((r) => r.dimension === 'length' && r.effect === 'up');
    plan.desired_length_seconds = item.desired_length_seconds
      ?? (lengthRules[0] ? Number(lengthRules[0].dimension_value) : null)
      ?? FORMAT_LENGTHS[plan.format] ?? 60;
    plan.target_audience = (typeof settings.target_audience === 'object' && settings.target_audience !== null)
      ? (settings.target_audience.primary ?? JSON.stringify(settings.target_audience))
      : (settings.target_audience ?? 'tech-curious professionals');
    plan.angle = item.evaluation_reason ?? item.title;
    const ctaRules = rules.filter((r) => r.dimension === 'cta' && r.effect === 'up');
    plan.cta = item.cta ?? ctaRules[0]?.dimension_value ?? 'follow for more';
    const seriesRules = rules.filter((r) => r.dimension === 'series');
    plan.series = item.series ?? seriesRules[0]?.dimension_value ?? null;
    return plan;
  }
}
