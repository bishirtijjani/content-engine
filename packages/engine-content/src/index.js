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
import { BaseEngine, contentItem, playbookRule, transition, requestGate } from '@content-os/core';

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
// Content Engine
// ---------------------------------------------------------------------------
export class ContentEngine extends BaseEngine {
  static NAME = 'content';
  static OWNED_STATES = ['idea', 'evaluated', 'planned', 'researched', 'scripted', 'ready_to_shoot'];
  static ACTIONS = ['discover', 'evaluate', 'plan', 'research', 'script'];

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
   * Full pipeline: discover → evaluate → plan → research → script.
   */
  pipeline({ targetId = null, dryRun = false } = {}) {
    const results = {};
    results.discover = this.discover({ targetId, dryRun });
    results.evaluate = this.evaluate({ targetId, dryRun });
    results.plan = this.plan({ targetId, dryRun });
    results.research = this.research({ targetId, dryRun });
    results.script = this.script({ targetId, dryRun });

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
    const evaluated = [];

    for (const raw of items) {
      const item = contentItem(raw);
      const score = this._scoreItem(item, weights, rules);

      if (dryRun) {
        evaluated.push({ id: item.id, score });
        continue;
      }

      transition(this.db, item.id, 'evaluated', {
        actor: `engine:${this.name}`,
        reason: `evaluated ${score}/100`,
      });

      requestGate(this.db, 'idea_approval', 'content_item', item.id, {
        requestedBy: `engine:${this.name}`,
        note: `score ${score}/100 — auto-evaluated by Content Engine`,
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

  _isGateApproved(gateType, itemId) {
    const row = this.db.prepare(
      "SELECT status FROM gates WHERE gate_type = ? AND target_type = 'content_item' " +
      'AND target_id = ? ORDER BY id DESC LIMIT 1'
    ).get(gateType, itemId);
    return row !== undefined && row.status === 'approved';
  }

  _scoreItem(item, weights, rules) {
    let score = 0;
    const knownPillars = rules.filter((r) => r.dimension === 'pillar').map((r) => r.dimension_value);
    if (item.pillar && knownPillars.includes(item.pillar)) {
      score += weights.pillarRelevance;
    } else if (item.pillar) {
      score += weights.pillarRelevance * 0.5;
    }
    const srcScore = SOURCE_SCORES[item.source] ?? 50;
    score += (srcScore / 100) * weights.audienceInterest;
    const trendingTopics = rules.filter((r) => r.dimension === 'topic').map((r) => r.dimension_value);
    const itemTags = item.tags ?? [];
    const trendHits = itemTags.filter((t) => trendingTopics.includes(t)).length;
    score += Math.min(1, trendHits / 3) * weights.trendPotential;
    const authorityPillars = rules.filter((r) => r.dimension === 'pillar' && r.effect === 'up').map((r) => r.dimension_value);
    if (item.pillar && authorityPillars.includes(item.pillar)) score += weights.authorityFit;
    const engagingHooks = rules.filter((r) => r.dimension === 'hook_style' && r.effect === 'up').map((r) => r.dimension_value);
    if (item.hook_style && engagingHooks.includes(item.hook_style)) score += weights.engagementPotential;
    const prioScores = { high: 1.0, medium: 0.6, low: 0.3 };
    score += (prioScores[item.priority] ?? 0.5) * weights.businessValue;
    const sourceCount = this.db.prepare('SELECT COUNT(*) AS n FROM content_items WHERE source = ?').get(item.source)?.n ?? 0;
    score += Math.max(0, 1 - sourceCount / 10) * weights.novelty;
    return Math.round(Math.min(100, Math.max(0, score)));
  }

  _buildPlan(item, rules, settings) {
    const plan = {};
    const hookRules = rules.filter((r) => r.dimension === 'hook_style' && r.effect === 'up')
      .sort((a, b) => (b.magnitude ?? 1) - (a.magnitude ?? 1));
    plan.hook_style = item.hook_style ?? hookRules[0]?.dimension_value ?? 'question';
    const formatRules = rules.filter((r) => r.dimension === 'format' && r.effect === 'up')
      .sort((a, b) => (b.magnitude ?? 1) - (a.magnitude ?? 1));
    plan.format = item.format ?? formatRules[0]?.dimension_value ?? 'talking_head';
    const pillarRules = rules.filter((r) => r.dimension === 'pillar');
    plan.pillar = item.pillar ?? pillarRules[0]?.dimension_value ?? 'general';
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
