// Production Engine — "turn a cleaned recording into a finished video."
//
// Pipeline:
//   process_footage -> edit -> request_review -> [human: asset_review] -> schedule
//
// Owned states: shot, editing
//
// The engine is the single home for production. It never writes content: the
// agent writes a PLAN (structured JSON, stored in content_items.video_plan),
// and this engine checks it against the locked style, builds one composition
// (untouched footage + captions + overlays + zooms), renders it, lays sound
// effects under the voice, and asks the human to review.
//
// State transitions:
//   ready_to_shoot -> shot     (no gate — footage attached)
//   shot -> editing            (no gate — the edit is built)
//   editing -> scheduled       (requires asset_review gate — human approves)
//
// Actions:
//   process_footage  attach the cleaned file, move to shot
//   list_footage     list the video files waiting in data/
//   edit             build + render the long video from the agent's plan
//   make_short       package a start/end range as a vertical short
//   request_review   ask the human to watch the edit
//   resubmit         ask again after the human rejected it
//   schedule         move forward after the human approved
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync, copyFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  BaseEngine,
  PROJECT_ROOT,
  transition,
  requestGate,
  latestPending,
  contentItem,
} from '@content-os/core';
import { buildComposition } from './assemble.mjs';
import { mixSfx } from './mix.mjs';
import { validatePlan, parsePlan, summarizePlan } from './plan.mjs';
import { buildMenu } from './menu.mjs';
import { newPlan as makePlan } from './plan-builder.mjs';
import { loadStyle, LEXICON_PATH, PACKAGE_ROOT } from './style.mjs';
import {
  loadCatalog,
  resolveVisualPath,
  resolveSfxPath,
  validationCatalog,
} from './library.mjs';

// Resolve the hyperframes CLI path relative to this package's location.
// On Windows, node_modules/.bin entries are shell scripts, so we use the
// direct .mjs entry point instead.
const HYPERFRAMES_BIN = path.join(PROJECT_ROOT, 'node_modules', 'hyperframes', 'bin', 'hyperframes.mjs');

const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const COMPOSITIONS_DIR = path.join(DATA_DIR, 'compositions');
const RENDERS_DIR = path.join(DATA_DIR, 'renders');
const TRANSCRIBE_PY = path.join(PACKAGE_ROOT, 'tools', 'transcribe.py');

const VIDEO_EXT = new Set(['.mp4', '.mov', '.webm', '.mkv', '.m4v']);

export class ProductionEngine extends BaseEngine {
  static NAME = 'production';
  static OWNED_STATES = ['shot', 'editing'];
  static ACTIONS = ['process_footage', 'list_footage', 'menu', 'save_plan', 'edit', 'make_short', 'request_review', 'resubmit', 'schedule'];

  static ACTION_METHODS = {
    process_footage: 'processFootage',
    list_footage: 'listFootage',
    menu: 'menu',
    save_plan: 'savePlan',
    edit: 'edit',
    make_short: 'makeShort',
    request_review: 'requestReview',
    resubmit: 'resubmit',
    schedule: 'schedule',
  };

  // =========================================================================
  // PROCESS FOOTAGE — attach the cleaned file, move to shot
  // =========================================================================

  /**
   * Attach a cleaned video to a content item and move it to `shot`.
   * Pass either a `filePath` (the cleaned file the human pointed at) or
   * explicit `recordingIds`. With a filePath, the engine creates the recording
   * session + recording rows for you.
   *
   * @param {Object} opts
   * @param {number} opts.targetId
   * @param {string} [opts.filePath]
   * @param {Array<number>} [opts.recordingIds]
   * @param {boolean} [opts.dryRun]
   * @returns {{ processed, skipped, recordingId?, path? }}
   */
  processFootage({ targetId = null, filePath = null, recordingIds = [], dryRun = false } = {}) {
    if (!targetId) throw new Error('process_footage requires { targetId }');

    const item = this._item(targetId);
    if (item.status !== 'ready_to_shoot' && item.status !== 'shot') {
      this.log('process_footage', {
        targetType: 'content_item', targetId: item.id, status: 'skipped',
        message: `item is '${item.status}', expected 'ready_to_shoot'`,
      });
      return { processed: 0, skipped: 1 };
    }

    let resolved = null;
    if (filePath) {
      resolved = this._resolveFootagePath(filePath);
      if (!resolved) {
        throw new Error(`footage not found: ${filePath} (looked in data/ and the repo root)`);
      }
    }

    if (dryRun) {
      this.log('process_footage', {
        targetType: 'content_item', targetId: item.id,
        message: `would attach ${resolved ?? `${recordingIds.length} recording(s)`} and move to 'shot' (dry run)`,
      });
      return { processed: 1, skipped: 0, path: resolved ?? undefined };
    }

    let recordingId = null;
    let visualsDir = null;
    if (resolved) {
      recordingId = this._attachFootage(item, resolved);
      visualsDir = this._visualsDir(resolved);
      mkdirSync(visualsDir, { recursive: true });
    } else {
      for (const recId of recordingIds) {
        this.db.prepare(
          'INSERT OR IGNORE INTO content_item_recordings (content_item_id, recording_id, role) VALUES (?, ?, ?)'
        ).run(item.id, recId, 'primary');
      }
    }

    if (item.status !== 'shot') {
      transition(this.db, item.id, 'shot', {
        actor: `engine:${this.name}`,
        reason: resolved ? 'cleaned footage attached' : `${recordingIds.length} recording(s) linked`,
      });
    }

    this.log('process_footage', {
      targetType: 'content_item', targetId: item.id,
      message: resolved
        ? `attached ${path.basename(resolved)}; drop this video's pictures in ${path.relative(PROJECT_ROOT, visualsDir).split(path.sep).join('/')}`
        : `attached ${recordingId ?? 'footage'}, moved to 'shot'`,
    });
    return { processed: 1, skipped: 0, recordingId: recordingId ?? undefined, path: resolved ?? undefined, visualsDir: visualsDir ?? undefined };
  }

  /** List the video files waiting in data/ so the agent can offer them. */
  listFootage() {
    if (!existsSync(DATA_DIR)) return { files: [] };
    const files = [];
    const walk = (dir, depth = 0) => {
      if (depth > 2) return;
      for (const entry of this._readdir(dir)) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'compositions' || entry.name === 'renders') continue;
          walk(full, depth + 1);
        } else if (VIDEO_EXT.has(path.extname(entry.name).toLowerCase())) {
          files.push({ name: entry.name, path: path.relative(PROJECT_ROOT, full).split(path.sep).join('/') });
        }
      }
    };
    walk(DATA_DIR);
    return { files: files.sort((a, b) => a.name.localeCompare(b.name)) };
  }

  // =========================================================================
  // MENU / PLAN — the model reads the menu, then writes a plan
  // =========================================================================

  /**
   * The menu the model reads before writing a plan: frames, templates (with
   * their fields and frame), the visuals for this video, and the sound cues.
   * @param {Object} [opts]
   * @param {number} [opts.targetId] - include that item's .visuals/ folder
   */
  menu({ targetId = null } = {}) {
    const base = buildMenu();
    if (!targetId) return base;

    const item = this._item(targetId);
    const footage = this._primaryFootage(item.id);
    if (!footage) return base;

    const dir = this._visualsDir(path.resolve(PROJECT_ROOT, footage.file_path));
    if (!existsSync(dir)) return base;

    const visuals = readdirSync(dir)
      .filter((f) => !f.startsWith('.') && !f.toLowerCase().endsWith('.txt'))
      .map((f) => ({
        file: path.relative(PROJECT_ROOT, path.join(dir, f)).split(path.sep).join('/'),
        what: f.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '),
      }));
    return { ...base, visuals };
  }

  /** Start a new plan. The model calls the returned builder's methods. */
  newPlan() {
    return makePlan();
  }

  /**
   * Save an agent-written plan. Validates against the menu first; refuses
   * anything off-style. The engine never writes the plan — it only finalizes it.
   * @param {Object} opts
   * @param {number} opts.targetId
   * @param {Object} opts.plan - a builder or a plain plan object
   */
  savePlan({ targetId = null, plan = null } = {}) {
    if (!targetId) throw new Error('save_plan requires { targetId }');
    const item = this._item(targetId);
    const raw = typeof plan?.toJSON === 'function' ? plan.toJSON() : plan;
    if (!raw) throw new Error('save_plan requires { plan }');

    const style = loadStyle();
    const catalog = loadCatalog();
    const footage = this._primaryFootage(item.id);
    const duration = footage ? this._probe(path.resolve(PROJECT_ROOT, footage.file_path)).duration : null;

    const problems = validatePlan(raw, { duration, style, catalog: validationCatalog(catalog) });
    if (problems.length) {
      this.log('save_plan', {
        targetType: 'content_item', targetId: item.id, status: 'skipped',
        message: `plan refused: ${problems.join(' | ')}`,
      });
      return { saved: false, problems };
    }

    this.db.prepare(
      "UPDATE content_items SET video_plan = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(JSON.stringify(raw), item.id);

    this.log('save_plan', {
      targetType: 'content_item', targetId: item.id,
      message: `plan saved (${summarizePlan(raw).overlays} overlay(s))`,
    });
    return { saved: true, plan: raw };
  }

  // =========================================================================
  // EDIT — build + render the long video from the agent's plan
  // =========================================================================

  /**
   * Build and render the long video for a shot item.
   * Requires footage and an agent-written plan. If the plan is missing or
   * off-style, the engine skips and logs why — it never writes content.
   *
   * @returns {{ processed, skipped, assets, problems? }}
   */
  edit({ targetId = null, dryRun = false } = {}) {
    if (!targetId) throw new Error('edit requires { targetId }');
    const item = this._item(targetId);

    if (item.status !== 'shot') {
      this.log('edit', {
        targetType: 'content_item', targetId: item.id, status: 'skipped',
        message: `item is '${item.status}', expected 'shot'`,
      });
      return { processed: 0, skipped: 1, assets: 0 };
    }

    const footage = this._primaryFootage(item.id);
    if (!footage) {
      this.log('edit', {
        targetType: 'content_item', targetId: item.id, status: 'skipped',
        message: 'no footage attached yet',
      });
      return { processed: 0, skipped: 1, assets: 0 };
    }

    const plan = parsePlan(item.video_plan);
    if (plan === null) {
      this.log('edit', {
        targetType: 'content_item', targetId: item.id, status: 'skipped',
        message: 'no plan written yet — the agent writes the plan, the engine builds it',
      });
      return { processed: 0, skipped: 1, assets: 0 };
    }

    const style = loadStyle();
    const catalog = loadCatalog();
    const videoPath = path.resolve(PROJECT_ROOT, footage.file_path);
    const probe = this._probe(videoPath);
    const duration = probe.duration ?? item.desired_length_seconds ?? 60;

    const problems = validatePlan(plan, { duration, style, catalog: validationCatalog(catalog) });
    if (problems.length) {
      this.log('edit', {
        targetType: 'content_item', targetId: item.id, status: 'skipped',
        message: `plan failed the style check: ${problems.join(' | ')}`,
      });
      return { processed: 0, skipped: 1, assets: 0, problems };
    }

    const summary = summarizePlan(plan);
    if (dryRun) {
      this.log('edit', {
        targetType: 'content_item', targetId: item.id,
        message: `would build the video: ${summary.overlays} overlay(s), ${summary.zooms} zoom(s), ${summary.sfx} sound(s) (dry run)`,
      });
      return { processed: 1, skipped: 0, assets: 0 };
    }

    const compositionDir = path.join(COMPOSITIONS_DIR, `item-${item.id}`);
    mkdirSync(compositionDir, { recursive: true });

    const { html, overlayCount } = this._buildLong(item, footage, plan, { videoPath, probe, duration, style, catalog, compositionDir });
    writeFileSync(path.join(compositionDir, 'index.html'), html, 'utf8');

    mkdirSync(RENDERS_DIR, { recursive: true });
    const picturePath = path.join(RENDERS_DIR, `item-${item.id}.mp4`);
    const render = this._renderComposition(compositionDir, picturePath, style);
    if (!render.success) {
      this.log('edit', {
        targetType: 'content_item', targetId: item.id, status: 'error',
        message: `render failed: ${render.error}`,
      });
      return { processed: 0, skipped: 1, assets: 0 };
    }

    // Lay sound effects under the voice (no music).
    let finalPath = picturePath;
    const mix = mixSfx({
      videoPath: picturePath,
      outputPath: path.join(RENDERS_DIR, `item-${item.id}.mixed.mp4`),
      sfx: plan.sfx ?? [],
      style,
      resolveSfx: (id) => resolveSfxPath(id, catalog),
    });
    if (mix.mixed) finalPath = path.join(RENDERS_DIR, `item-${item.id}.mixed.mp4`);
    else if (mix.error) {
      this.log('edit', {
        targetType: 'content_item', targetId: item.id, status: 'error',
        message: `sfx mix failed, keeping the plain picture: ${mix.error}`,
      });
    }

    this.db.prepare(
      'INSERT INTO assets (content_item_id, platform, file_path, status, duration_seconds) VALUES (?, ?, ?, ?, ?)'
    ).run(item.id, 'original', finalPath, 'review', duration);

    transition(this.db, item.id, 'editing', {
      actor: `engine:${this.name}`,
      reason: `video built (${overlayCount} overlay(s)) and rendered`,
    });

    this.log('edit', {
      targetType: 'content_item', targetId: item.id,
      message: `rendered ${finalPath}, created asset, moved to 'editing'`,
    });
    return { processed: 1, skipped: 0, assets: 1 };
  }

  // =========================================================================
  // MAKE SHORT — package a start/end range as a vertical short
  // =========================================================================

  /**
   * Package a range of the footage as a 9:16 short.
   * @param {Object} opts
   * @param {number} opts.targetId
   * @param {number} opts.start - seconds
   * @param {number} opts.end   - seconds
   * @param {boolean} [opts.dryRun]
   */
  makeShort({ targetId = null, start = null, end = null, dryRun = false } = {}) {
    if (!targetId) throw new Error('make_short requires { targetId, start, end }');
    if (typeof start !== 'number' || typeof end !== 'number' || end <= start) {
      throw new Error('make_short requires numeric { start, end } with end after start');
    }
    const item = this._item(targetId);

    const footage = this._primaryFootage(item.id);
    if (!footage) {
      this.log('make_short', {
        targetType: 'content_item', targetId: item.id, status: 'skipped', message: 'no footage attached yet',
      });
      return { processed: 0, skipped: 1, assets: 0 };
    }

    const videoPath = path.resolve(PROJECT_ROOT, footage.file_path);
    const probe = this._probe(videoPath);
    if (probe.duration && end > probe.duration + 0.001) {
      throw new Error(`short ends at ${end}s but the footage is only ${Math.round(probe.duration)}s long`);
    }

    if (dryRun) {
      this.log('make_short', {
        targetType: 'content_item', targetId: item.id,
        message: `would cut ${start}s–${end}s into a 9:16 short (dry run)`,
      });
      return { processed: 1, skipped: 0, assets: 0 };
    }

    const style = loadStyle();
    const catalog = loadCatalog();
    const dir = path.join(COMPOSITIONS_DIR, `item-${item.id}-short-${Math.round(start)}`);
    mkdirSync(dir, { recursive: true });

    // Trim the segment (re-encode so the cut is frame-accurate and start is 0).
    const segment = path.join(dir, `segment${path.extname(videoPath)}`);
    const trim = this._trim(videoPath, start, end, segment);
    if (!trim.success) {
      this.log('make_short', {
        targetType: 'content_item', targetId: item.id, status: 'error', message: `trim failed: ${trim.error}`,
      });
      return { processed: 0, skipped: 1, assets: 0 };
    }

    const plan = parsePlan(item.video_plan) ?? { captions: {}, overlays: [], zooms: [], sfx: [] };
    const shifted = this._shiftPlan(plan, start, end);
    const words = this._transcriptFor(dir, segment).filter((w) => w.start >= start && w.end <= end)
      .map((w) => ({ ...w, start: w.start - start, end: w.end - start }));
    const shortDuration = end - start;

    const { html } = buildComposition({
      words,
      videoSrc: path.basename(segment),
      width: 1080,
      height: 1920,
      duration: shortDuration,
      style,
      lexiconPath: LEXICON_PATH,
      plan: shifted,
      resolveVisual: this._copyVisuals(shifted.overlays, dir, catalog),
    });
    writeFileSync(path.join(dir, 'index.html'), html, 'utf8');

    mkdirSync(RENDERS_DIR, { recursive: true });
    const picture = path.join(RENDERS_DIR, `item-${item.id}-short-${Math.round(start)}.mp4`);
    const render = this._renderComposition(dir, picture, style);
    if (!render.success) {
      this.log('make_short', {
        targetType: 'content_item', targetId: item.id, status: 'error', message: `render failed: ${render.error}`,
      });
      return { processed: 0, skipped: 1, assets: 0 };
    }

    const mix = mixSfx({
      videoPath: picture,
      outputPath: path.join(RENDERS_DIR, `item-${item.id}-short-${Math.round(start)}.mixed.mp4`),
      sfx: shifted.sfx ?? [],
      style,
      resolveSfx: (id) => resolveSfxPath(id, catalog),
    });
    const finalPath = mix.mixed ? path.join(RENDERS_DIR, `item-${item.id}-short-${Math.round(start)}.mixed.mp4`) : picture;

    this.db.prepare(
      'INSERT INTO assets (content_item_id, platform, file_path, status, duration_seconds, notes) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(item.id, 'other', finalPath, 'review', shortDuration, `short ${start}s-${end}s`);

    this.log('make_short', {
      targetType: 'content_item', targetId: item.id,
      message: `rendered short ${start}s-${end}s to ${finalPath}`,
    });
    return { processed: 1, skipped: 0, assets: 1, path: finalPath };
  }

  // =========================================================================
  // REQUEST REVIEW / RESUBMIT / SCHEDULE
  // =========================================================================

  requestReview({ targetId = null, dryRun = false } = {}) {
    if (!targetId) throw new Error('request_review requires { targetId }');
    const item = this._item(targetId);

    if (item.status !== 'editing') {
      this.log('request_review', {
        targetType: 'content_item', targetId: item.id, status: 'skipped',
        message: `item is '${item.status}', expected 'editing'`,
      });
      return { processed: 0, skipped: 1 };
    }

    const pending = latestPending(this.db, 'asset_review', 'content_item', item.id);
    if (pending) {
      this.log('request_review', {
        targetType: 'content_item', targetId: item.id, status: 'skipped',
        message: `asset_review already waiting on the human (id ${pending.id})`,
      });
      return { processed: 0, skipped: 1 };
    }

    if (dryRun) {
      this.log('request_review', {
        targetType: 'content_item', targetId: item.id,
        message: 'would ask the human to review (dry run)',
      });
      return { processed: 1, skipped: 0 };
    }

    requestGate(this.db, 'asset_review', 'content_item', item.id, {
      requestedBy: `engine:${this.name}`,
      note: 'video ready to watch',
    });
    this.log('request_review', {
      targetType: 'content_item', targetId: item.id, message: 'asked the human to review',
    });
    return { processed: 1, skipped: 0 };
  }

  resubmit({ targetId = null, dryRun = false } = {}) {
    if (!targetId) {
      throw new Error('resubmit requires { targetId } — name the item whose revised edit should be re-reviewed');
    }
    const item = this._item(targetId);
    if (item.status !== 'editing') {
      throw new Error(`item ${item.id} is '${item.status}', expected 'editing'`);
    }

    const latestGate = this.db.prepare(
      "SELECT status FROM gates WHERE gate_type = 'asset_review' AND target_type = 'content_item' " +
      'AND target_id = ? ORDER BY id DESC LIMIT 1'
    ).get(item.id);
    if (!latestGate) throw new Error(`item ${item.id} has no asset_review gate to resubmit`);
    if (latestGate.status !== 'rejected') {
      throw new Error(`item ${item.id} has no rejected asset_review to resubmit (latest is '${latestGate.status}')`);
    }

    if (dryRun) {
      this.log('resubmit', {
        targetType: 'content_item', targetId: item.id,
        message: 'would ask the human to look again (dry run)',
      });
      return { processed: 1 };
    }

    requestGate(this.db, 'asset_review', 'content_item', item.id, {
      requestedBy: `engine:${this.name}`,
      note: 'revised edit — asking again after the rejection',
    });
    this.log('resubmit', {
      targetType: 'content_item', targetId: item.id, message: 'asked the human to look again',
    });
    return { processed: 1 };
  }

  schedule({ targetId = null, dryRun = false } = {}) {
    if (!targetId) throw new Error('schedule requires { targetId }');
    const item = this._item(targetId);

    if (item.status !== 'editing') {
      this.log('schedule', {
        targetType: 'content_item', targetId: item.id, status: 'skipped',
        message: `item is '${item.status}', expected 'editing'`,
      });
      return { processed: 0, skipped: 1 };
    }

    if (dryRun) {
      this.log('schedule', {
        targetType: 'content_item', targetId: item.id,
        message: 'would move to scheduled after the human approves (dry run)',
      });
      return { processed: 1, skipped: 0 };
    }

    // transition() refuses without an approved asset_review gate.
    transition(this.db, item.id, 'scheduled', {
      actor: `engine:${this.name}`,
      reason: 'human approved the finished video',
    });
    this.db.prepare(
      "UPDATE assets SET status = 'approved', updated_at = datetime('now') " +
      "WHERE content_item_id = ? AND status = 'review'"
    ).run(item.id);

    this.log('schedule', {
      targetType: 'content_item', targetId: item.id, message: "approved and moved to 'scheduled'",
    });
    return { processed: 1, skipped: 0 };
  }

  // =========================================================================
  // RUN — dispatch to a specific action, or run the whole pipeline
  // =========================================================================

  run({ targetId = null, action = null, dryRun = false } = {}) {
    if (action) {
      if (!this.constructor.ACTIONS.includes(action)) {
        throw new Error(`unknown production action '${action}' — available: ${this.constructor.ACTIONS.join(', ')}`);
      }
      const method = this.constructor.ACTION_METHODS[action];
      return this[method]({ targetId, dryRun });
    }
    return this.pipeline({ targetId, dryRun });
  }

  /** process_footage -> edit -> request_review, for one item or everything waiting. */
  pipeline({ targetId = null, dryRun = false } = {}) {
    const results = {};

    if (targetId) {
      results.process_footage = this.processFootage({ targetId, dryRun });
      results.edit = this.edit({ targetId, dryRun });
      results.request_review = this.requestReview({ targetId, dryRun });
    } else {
      const batch = (status, fn) => {
        const rows = this.db.prepare('SELECT id FROM content_items WHERE status = ? ORDER BY id').all(status);
        let processed = 0, skipped = 0, assets = 0;
        for (const row of rows) {
          const r = fn({ targetId: row.id, dryRun });
          processed += r.processed ?? 0;
          skipped += r.skipped ?? 0;
          assets += r.assets ?? 0;
        }
        return { processed, skipped, assets };
      };
      results.process_footage = batch('ready_to_shoot', (o) => this.processFootage(o));
      results.edit = batch('shot', (o) => this.edit(o));
      results.request_review = batch('editing', (o) => this.requestReview(o));
    }

    const total = Object.values(results).reduce((s, r) => s + (r.processed ?? 0), 0);
    this.log('pipeline', {
      message: `pipeline: ${total} item(s) moved — ` +
        Object.entries(results).map(([k, v]) => `${k}:${v.processed ?? 0}`).join(' '),
    });
    return results;
  }

  // =========================================================================
  // HELPERS
  // =========================================================================

  _item(id) {
    const raw = this.db.prepare('SELECT * FROM content_items WHERE id = ?').get(id);
    if (!raw) throw new Error(`content item ${id} not found`);
    return contentItem(raw);
  }

  _readdir(dir) {
    try {
      return readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
  }

  /** The primary recording's row, or null. */
  _primaryFootage(itemId) {
    return this.db.prepare(
      'SELECT r.* FROM recordings r ' +
      'JOIN content_item_recordings cir ON r.id = cir.recording_id ' +
      'WHERE cir.content_item_id = ? AND r.file_path IS NOT NULL ' +
      "ORDER BY (cir.role = 'primary') DESC, r.id LIMIT 1"
    ).get(itemId) ?? null;
  }

  /** Find a footage path: absolute, or relative to the repo root or data/. */
  _resolveFootagePath(filePath) {
    const candidates = path.isAbsolute(filePath)
      ? [filePath]
      : [
          path.resolve(PROJECT_ROOT, filePath),
          path.resolve(DATA_DIR, filePath),
          path.resolve(process.cwd(), filePath),
        ];
    return candidates.find((p) => existsSync(p)) ?? null;
  }

  /** Find a visual path: absolute, or relative to the repo root or data/. */
  _resolveVisualFile(filePath) {
    const candidates = path.isAbsolute(filePath)
      ? [filePath]
      : [
          path.resolve(PROJECT_ROOT, filePath),
          path.resolve(DATA_DIR, filePath),
          path.resolve(process.cwd(), filePath),
        ];
    return candidates.find((p) => existsSync(p)) ?? null;
  }

  /** The folder a video's pictures belong in: next to the video, <name>.visuals/. */
  _visualsDir(videoPath) {
    const base = path.basename(videoPath, path.extname(videoPath));
    return path.join(path.dirname(videoPath), `${base}.visuals`);
  }

  /** Create the session + recording rows and link them to the item. */
  _attachFootage(item, videoPath) {
    const probe = this._probe(videoPath);

    let sessionId = item.session_id;
    if (!sessionId) {
      const res = this.db.prepare(
        "INSERT INTO recording_sessions (title, status) VALUES (?, 'recorded')"
      ).run(`Shoot for "${item.title}"`);
      sessionId = Number(res.lastInsertRowid);
    }

    const res = this.db.prepare(
      "INSERT INTO recordings (session_id, file_path, duration_seconds, status) VALUES (?, ?, ?, 'uploaded')"
    ).run(sessionId, videoPath, probe.duration ?? null);
    const recordingId = Number(res.lastInsertRowid);

    this.db.prepare(
      'INSERT OR IGNORE INTO content_item_recordings (content_item_id, recording_id, role) VALUES (?, ?, ?)'
    ).run(item.id, recordingId, 'primary');
    this.db.prepare(
      'UPDATE content_items SET session_id = ?, recording_id = ?, updated_at = datetime(\'now\') WHERE id = ?'
    ).run(sessionId, recordingId, item.id);

    return recordingId;
  }

  /** Probe a media file. Never throws; missing ffprobe gives empty values. */
  _probe(filePath) {
    const res = spawnSync('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height', '-show_entries', 'format=duration',
      '-of', 'json', filePath,
    ], { encoding: 'utf8' });
    if (res.status !== 0 || !res.stdout) return { width: 1920, height: 1080, duration: null, audioOnly: false };
    try {
      const probe = JSON.parse(res.stdout);
      const stream = probe.streams?.[0];
      return {
        width: stream?.width ?? 1920,
        height: stream?.height ?? 1080,
        duration: probe.format?.duration ? Number(probe.format.duration) : null,
        audioOnly: !stream,
      };
    } catch {
      return { width: 1920, height: 1080, duration: null, audioOnly: false };
    }
  }

  /** Copy the source into the composition project and transcribe it. */
  _sourceInto(compositionDir, videoPath) {
    const name = `source${path.extname(videoPath)}`;
    const dest = path.join(compositionDir, name);
    if (!existsSync(dest)) copyFileSync(videoPath, dest);
    return name;
  }

  _transcriptFor(compositionDir, videoPath) {
    const transcriptPath = path.join(compositionDir, 'transcript.json');
    if (!existsSync(transcriptPath)) {
      // Reuse a transcript the cleaner already made next to the video
      // (e.g. vid1.cleaned.transcript.json) instead of listening again.
      const sibling = videoPath.replace(/\.[^.]+$/, '.transcript.json');
      if (existsSync(sibling) && statSync(sibling).size > 0
          && statSync(sibling).mtimeMs >= statSync(videoPath).mtimeMs) {
        copyFileSync(sibling, transcriptPath);
      } else {
        const res = spawnSync('python', [
          TRANSCRIBE_PY, videoPath, '--model', 'base.en', '--out', transcriptPath, '--lexicon', LEXICON_PATH,
        ], { encoding: 'utf8', timeout: 300000 });
        if (res.status !== 0) throw new Error(`transcription failed: ${res.stderr}`);
      }
    }
    return JSON.parse(readFileSync(transcriptPath, 'utf8'));
  }

  /** Copy a video's visuals into the composition dir; return key -> in-project name. */
  _copyVisuals(overlays, compositionDir, catalog) {
    const map = {};
    let n = 0;
    for (const o of overlays ?? []) {
      if (o.kind !== 'visual') continue;
      const key = o.file || o.asset;
      const src = o.file ? this._resolveVisualFile(o.file) : resolveVisualPath(o.asset, catalog);
      if (!src) continue;
      const name = `visual-${++n}${path.extname(src)}`;
      const dest = path.join(compositionDir, name);
      if (!existsSync(dest)) copyFileSync(src, dest);
      map[key] = name;
    }
    return (id) => map[id] ?? null;
  }

  _buildLong(item, footage, plan, { videoPath, probe, duration, style, catalog, compositionDir }) {
    const mediaSrc = this._sourceInto(compositionDir, videoPath);
    const words = this._transcriptFor(compositionDir, videoPath);
    const { html, overlayCount } = buildComposition({
      words,
      videoSrc: mediaSrc,
      width: probe.width,
      height: probe.height,
      duration,
      style,
      lexiconPath: LEXICON_PATH,
      plan,
      resolveVisual: this._copyVisuals(plan.overlays, compositionDir, catalog),
      audioOnly: probe.audioOnly,
    });
    return { html, overlayCount };
  }

  /** Shift a plan's timings into a trimmed segment's timeline. */
  _shiftPlan(plan, start, end) {
    const inRange = (t) => typeof t === 'number' && t >= start && t <= end;
    return {
      captions: plan.captions ?? {},
      overlays: (plan.overlays ?? [])
        .filter((o) => inRange(o.start) && inRange(o.end))
        .map((o) => ({ ...o, start: o.start - start, end: o.end - start })),
      zooms: (plan.zooms ?? []).filter((z) => inRange(z.at)).map((z) => ({ ...z, at: z.at - start })),
      sfx: (plan.sfx ?? []).filter((s) => inRange(s.at)).map((s) => ({ ...s, at: s.at - start })),
    };
  }

  /** Trim a segment out of the footage with ffmpeg (frame-accurate re-encode). */
  _trim(videoPath, start, end, outPath) {
    const res = spawnSync('ffmpeg', [
      '-y', '-ss', String(start), '-to', String(end), '-i', videoPath,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
      '-c:a', 'aac', '-b:a', '192k', outPath,
    ], { encoding: 'utf8', timeout: 300000 });
    if (res.error) return { success: false, error: res.error.message };
    if (res.status !== 0) return { success: false, error: `ffmpeg exit ${res.status}: ${String(res.stderr).slice(0, 400)}` };
    return { success: true };
  }

  /** Render a HyperFrames composition to MP4 at the locked output quality. */
  _renderComposition(compositionDir, outputPath, style = null) {
    const env = { ...process.env };
    if (!env.HYPERFRAMES_BROWSER_PATH) {
      const chromePaths = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      ];
      for (const p of chromePaths) {
        if (existsSync(p)) { env.HYPERFRAMES_BROWSER_PATH = p; break; }
      }
    }

    const crf = (style ?? loadStyle())?.output?.crf;
    const args = [
      '--disable-warning=ExperimentalWarning', HYPERFRAMES_BIN, 'render', compositionDir, '-o', outputPath, '--no-browser-gpu',
    ];
    if (crf != null) args.push('--crf', String(crf));

    const result = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 300000, env });

    if (result.error) return { success: false, error: result.error.message };
    if (result.status !== 0) return { success: false, error: `exit code ${result.status}: ${result.stderr?.slice(0, 500)}` };
    return { success: true };
  }
}
