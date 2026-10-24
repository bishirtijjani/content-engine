// Production Engine — "turn a cleaned recording into a finished video."
//
// Pipeline:
//   process_footage -> save_snapshot_plan -> plan_snapshots
//     -> [human: snapshot_plan_review] -> edit -> request_review
//     -> [human: asset_review] -> schedule
//
// Owned states: shot, editing
//
// The engine never writes content. The agent writes a SEGMENT PLAN
// (Video -> Segments -> Beats): FOOTAGE (the face) and SNAPSHOT segments (one
// completed b-roll composition each, built by its beats). The engine derives the
// word-timed footage, validates the plan, renders one still per snapshot plus a
// contact sheet, and STOPS for the human (snapshot_plan_review). On approval it
// builds one composition, renders it, lays sound under the voice, and asks the
// human to review.
//
// State transitions:
//   ready_to_shoot -> shot     (no gate — footage attached)
//   shot -> editing            (no gate — the edit is built)
//   editing -> scheduled       (requires asset_review gate — human approves)
//
// Actions:
//   process_footage        attach the cleaned file, move to shot
//   list_footage           list the video files waiting in data/
//   save_snapshot_plan     store the agent-written segment plan
//   plan_snapshots         derive beats, validate, render the plan, stop for approval
//   approve_snapshot_plan  the human approves the plan (in chat)
//   preview                build + render a low-res preview
//   edit                   build + render the final video
//   request_review         ask the human to watch the edit
//   resubmit               ask again after the human rejected it
//   schedule               move forward after the human approved
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  BaseEngine,
  PROJECT_ROOT,
  transition,
  requestGate,
  decideGate,
  latestPending,
  contentItem,
  makePaths,
  pruneRenderScratch,
  linkOrCopy,
} from '@content-os/core';
import { mixSfx } from './mix.mjs';
import { buildMenu } from './menu.mjs';
import { buildScriptWords } from './script-captions.mjs';
import { planVideo, deriveNarrationBeats, buildWords } from './composition/snapshot-plan.mjs';
import { buildSnapshotComposition } from './composition/timeline.mjs';
import { validateSnapshotPlan, summarizeSnapshotPlan } from './composition/snapshot-spec.mjs';
import { loadStyle, LEXICON_PATH, PACKAGE_ROOT } from './style.mjs';

// Resolve the hyperframes CLI path relative to this package's location.
// On Windows, node_modules/.bin entries are shell scripts, so we use the
// direct .mjs entry point instead.
const HYPERFRAMES_BIN = path.join(PROJECT_ROOT, 'node_modules', 'hyperframes', 'bin', 'hyperframes.mjs');

const DATA_DIR = path.join(PROJECT_ROOT, 'data');

const TRANSCRIBE_PY = path.join(PACKAGE_ROOT, 'tools', 'transcribe.py');

const VIDEO_EXT = new Set(['.mp4', '.mov', '.webm', '.mkv', '.m4v']);

export class ProductionEngine extends BaseEngine {
  static NAME = 'production';
  static OWNED_STATES = ['shot', 'editing'];
  static ACTIONS = ['process_footage', 'list_footage', 'menu', 'save_snapshot_plan', 'plan_snapshots', 'approve_snapshot_plan', 'preview', 'edit', 'request_review', 'resubmit', 'schedule'];

  static ACTION_METHODS = {
    process_footage: 'processFootage',
    list_footage: 'listFootage',
    menu: 'menu',
    save_snapshot_plan: 'saveSnapshotPlan',
    plan_snapshots: 'planSnapshots',
    approve_snapshot_plan: 'approveSnapshotPlan',
    preview: 'preview',
    edit: 'edit',
    request_review: 'requestReview',
    resubmit: 'resubmit',
    schedule: 'schedule',
  };

  /**
   * @param {object} db
   * @param {object} [opts]
   * @param {string} [opts.dataDir] - the data root (defaults to <repo>/data). Set
   *   in tests so composition/render writes never touch the real project data.
   */
  constructor(db, { dataDir = null } = {}) {
    super(db);
    this.dataDir = dataDir ? path.resolve(dataDir) : DATA_DIR;
    // Every path this engine writes comes from here — one layout, one owner,
    // legacy-aware so an item mid-review never has to move (core/paths.js).
    this.paths = makePaths(this.dataDir);
  }

  /** Finished videos + detached render logs. */
  get rendersDir() {
    return this.paths.rendersDir();
  }

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
    let adopted = null;
    if (filePath) {
      resolved = this._resolveFootagePath(filePath);
      if (!resolved) {
        throw new Error(`footage not found: ${filePath} (looked in data/ and the repo root)`);
      }
      // Give the file a home in data/item-<id>/ BEFORE it becomes the item's
      // recording, so recordings.file_path can never point at a hand-typed
      // folder again (see _adoptFootage).
      adopted = this._adoptFootage(item, resolved, dryRun);
    }

    if (dryRun) {
      this.log('process_footage', {
        targetType: 'content_item', targetId: item.id,
        message: `would attach ${adopted ?? `${recordingIds.length} recording(s)`} and move to 'shot' (dry run)`,
      });
      return { processed: 1, skipped: 0, path: adopted ?? undefined };
    }

    let recordingId = null;
    if (adopted) {
      recordingId = this._attachFootage(item, adopted);
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
        reason: adopted ? 'cleaned footage attached' : `${recordingIds.length} recording(s) linked`,
      });
    }

    this.log('process_footage', {
      targetType: 'content_item', targetId: item.id,
      message: adopted
        ? (resolved === adopted
            ? `attached ${path.basename(adopted)}`
            : `attached ${path.basename(resolved)} → ${this.paths.relative(adopted)}`)
        : `attached ${recordingId ?? 'footage'}, moved to 'shot'`,
    });
    return { processed: 1, skipped: 0, recordingId: recordingId ?? undefined, path: adopted ?? undefined };
  }

  /**
   * Put the footage in the item's own folder before it is recorded as the
   * item's recording: `data/item-<id>/source<ext>` (hardlinked, so the file the
   * human dropped elsewhere costs no extra bytes and is never touched).
   *
   * Refuses renders (a finished video is not footage), never renames over a
   * different file, and leaves a pre-migration item's legacy tree alone so an
   * item under human review does not move mid-flight.
   *
   * @param {object} item
   * @param {string} videoPath absolute path of the file to adopt
   * @param {boolean} [dryRun] plan the destination without writing it
   * @returns {string} the path to record as the footage
   */
  _adoptFootage(item, videoPath, dryRun = false) {
    const itemDir = this.paths.resolveItemDir(item.id);
    if (this.paths.isInside(itemDir, videoPath)) return videoPath;
    if (this.paths.isLegacyDir(itemDir)) {
      // Still in the old tree (its item is mid-review) — don't create the new
      // folder from underneath it; migration moves this item as a whole later.
      return videoPath;
    }
    if (this.paths.isInside(this.paths.rendersDir(), videoPath)) {
      throw new Error(`refusing to attach a render as footage: ${videoPath} — attach the cleaned recording, not a finished video`);
    }

    const ext = path.extname(videoPath);
    const preferred = path.join(itemDir, `source${ext}`);
    const name = existsSync(preferred) ? path.basename(videoPath) : `source${ext}`;
    if (dryRun) return path.join(itemDir, name);
    return this.paths.adopt(videoPath, item.id, { name }).path;
  }

  /** List the video files waiting in data/ so the agent can offer them. */
  listFootage() {
    const root = this.paths.data;
    if (!existsSync(root)) return { files: [] };
    const files = [];
    const walk = (dir, depth = 0) => {
      if (depth > 2) return;
      for (const entry of this._readdir(dir)) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          // compositions = pre-migration work (its footage is already attached),
          // renders = finished videos, tmp = scratch, production = the item's own
          // build folder (its source.mp4 is a hardlink, not another drop).
          if (['compositions', 'renders', 'tmp', 'production'].includes(entry.name)) continue;
          walk(full, depth + 1);
        } else if (VIDEO_EXT.has(path.extname(entry.name).toLowerCase())) {
          files.push({ name: entry.name, path: path.relative(PROJECT_ROOT, full).split(path.sep).join('/') });
        }
      }
    };
    walk(root);
    return { files: files.sort((a, b) => a.name.localeCompare(b.name)) };
  }

  // =========================================================================
  // MENU — the model reads the menu, then writes a segment plan
  // =========================================================================

  /**
   * The menu the model reads before writing a segment plan: the brand doctrine,
   * the snapshot concepts + their slots, the beat actions/transitions, the cue
   * rule, and the icon vocabulary. Orientation follows the footage.
   * @param {Object} [opts]
   * @param {number} [opts.targetId] - orient the menu to that item's footage
   */
  menu({ targetId = null } = {}) {
    if (!targetId) return buildMenu();
    const item = this._item(targetId);
    const footage = this._primaryFootage(item.id);
    if (!footage) return buildMenu();
    const videoPath = path.resolve(PROJECT_ROOT, footage.file_path);
    const orientation = this._resolveOrientation(null, this._probe(videoPath));
    return buildMenu({ orientation });
  }

  // =========================================================================
  // SEGMENT PLAN — the mandatory front half of production.
  //
  // Model: Video -> Segments -> Beats. Every video must produce a segment plan
  // — the narration beats grouped into segments (FOOTAGE + SNAPSHOT), each
  // snapshot ONE completed composition — rendered to a still per snapshot plus a
  // contact sheet, with a beats table. It must be approved before the video can
  // be built.
  // =========================================================================

  /**
   * The on-disk folder for an item's production work: `data/item-<id>/production`
   * in the new tree, or the pre-migration `data/compositions/item-<id>` until that
   * item is moved. The item's id decides the name — never a free-text plan id.
   */
  _compositionDir(itemId) {
    return this.paths.resolveProductionDir(itemId);
  }

  /** Where the agent-written snapshot plan input lives for an item. */
  _snapshotPlanInput(itemId) {
    return path.join(this._compositionDir(itemId), 'snapshots.plan.json');
  }

  /** The saved snapshot plan for an item, or null when none is written. */
  _readSnapshotPlan(itemId) {
    const abs = this._snapshotPlanInput(itemId);
    if (!existsSync(abs)) return null;
    try { return JSON.parse(readFileSync(abs, 'utf8')); } catch { return null; }
  }

  /**
   * Build the runtime composition from a snapshot plan. The a-roll + words are
   * assembled here; the scenes/timeline come from composition/timeline.mjs.
   */
  _buildSnapshots(item, footage, snapshotPlan, { videoPath, probe, duration, style, compositionDir, mode = 'final', orientation = 'portrait', fit = 'cover' }) {
    const mediaSrc = this._sourceInto(compositionDir, videoPath);
    const asrWords = this._transcriptFor(compositionDir, videoPath);
    const clock = this._captionClock(compositionDir, videoPath, asrWords);
    const scriptText = this._scriptText(item);
    const words = scriptText ? buildScriptWords(scriptText, clock.words) : clock.words;
    const dims = this._renderDims(style, mode, probe, orientation);
    const { html, scenes, beats } = buildSnapshotComposition({
      plan: snapshotPlan,
      words,
      videoSrc: mediaSrc,
      width: dims.width,
      height: dims.height,
      duration,
      style,
      orientation,
      fit,
      fps: dims.fps,
      resolveClip: (clip) => this._clipInto(compositionDir, clip),
    });
    return { html, scenes, beats };
  }

  /**
   * Save the agent-written snapshot plan input. Shape-only here; the full gates
   * run in planSnapshots() (which hard-fails on anything off-model).
   */
  saveSnapshotPlan({ targetId = null, plan = null } = {}) {
    if (!targetId) throw new Error('save_snapshot_plan requires { targetId }');
    const item = this._item(targetId);
    const raw = typeof plan?.toJSON === 'function' ? plan.toJSON() : plan;
    if (!raw || !(Array.isArray(raw.segments) || Array.isArray(raw.snapshots))) {
      throw new Error('save_snapshot_plan requires { plan } with a segments list');
    }
    mkdirSync(this._compositionDir(item.id), { recursive: true });
    const abs = this._snapshotPlanInput(item.id);
    // Stamp the item's id into the plan: where this plan's stills and renders
    // land is decided by content_items.id, never by a free-text video.id (which
    // is how data/compositions/{video,sg-smoke,agent-loop,...} got minted).
    const stamped = { ...raw, video: { ...(raw.video ?? {}), item: item.id } };
    writeFileSync(abs, `${JSON.stringify(stamped, null, 2)}\n`, 'utf8');
    this.log('save_snapshot_plan', { targetType: 'content_item', targetId: item.id, message: 'snapshot plan saved' });
    return { saved: true, path: abs };
  }

  /**
   * The mandatory plan step. Derives the narration beats, validates the snapshot
   * plan, renders one still per snapshot + the snapshot grid, writes the beats
   * table, then opens the snapshot_plan_review gate and STOPS for the human.
   * HARD-FAILS without narration or a valid plan.
   */
  async planSnapshots({ targetId = null } = {}) {
    if (!targetId) throw new Error('plan_snapshots requires { targetId }');
    const item = this._item(targetId);
    const footage = this._primaryFootage(item.id);
    if (!footage) throw new Error('no footage attached — nothing to plan');
    const videoPath = path.resolve(PROJECT_ROOT, footage.file_path);
    const probe = this._probe(videoPath);
    const style = loadStyle();
    const orientation = this._resolveOrientation(null, probe);
    const compositionDir = this._compositionDir(item.id);
    mkdirSync(compositionDir, { recursive: true });

    const asrWords = this._transcriptFor(compositionDir, videoPath);
    const clock = this._captionClock(compositionDir, videoPath, asrWords);
    const scriptText = this._scriptText(item);

    const input = this._snapshotPlanInput(item.id);
    if (!existsSync(input)) throw new Error(`no snapshot plan written — expected ${input}`);
    const plan = JSON.parse(readFileSync(input, 'utf8'));
    const mediaProblems = this._clipMediaProblems(plan);
    if (mediaProblems.length) {
      throw new Error(`snapshot plan is invalid:\n - ${mediaProblems.join('\n - ')}`);
    }

    const dims = this._renderDims(style, 'final', probe, orientation);
    const outDir = path.join(compositionDir, 'plan');
    const result = await planVideo({
      plan, style, outDir, htmlDir: path.join(outDir, 'html'),
      scriptText, transcriptJson: clock.words,
      width: dims.width, height: dims.height, orientation,
    });

    requestGate(this.db, 'snapshot_plan_review', 'content_item', item.id, {
      requestedBy: `engine:${this.name}`,
      note: 'snapshot plan ready — review the stills + beats table',
    });
    this.log('plan_snapshots', {
      targetType: 'content_item', targetId: item.id,
      message: `snapshot plan: ${result.summary.segments} segments (${result.summary.snapshots} snapshots, ${result.summary.clips} clips), ${result.summary.beats} beats`,
    });
    return { processed: 1, skipped: 0, ...result };
  }

  /** Approve the snapshot plan (the human says yes in chat). */
  approveSnapshotPlan({ targetId = null } = {}) {
    if (!targetId) throw new Error('approve_snapshot_plan requires { targetId }');
    const item = this._item(targetId);
    const pending = latestPending(this.db, 'snapshot_plan_review', 'content_item', item.id);
    if (!pending) throw new Error('no snapshot plan waiting for approval');
    decideGate(this.db, pending.id, 'approved', { decidedBy: 'human' });
    this.log('approve_snapshot_plan', { targetType: 'content_item', targetId: item.id, message: 'snapshot plan approved' });
    return { approved: true };
  }

  /** True when the latest snapshot_plan_review gate for the item is approved. */
  snapshotPlanApproved(itemId) {
    const row = this.db.prepare(
      "SELECT status FROM gates WHERE gate_type = 'snapshot_plan_review' AND target_type = 'content_item' " +
      'AND target_id = ? ORDER BY id DESC LIMIT 1'
    ).get(itemId);
    return row !== undefined && row.status === 'approved';
  }

  // =========================================================================
  // PREVIEW — a fast, low-res render while the agent iterates
  // =========================================================================

  /**
   * Build and render the plan at the low-res preview canvas.
   * No asset, no gate, no state change — the agent can run it as often as it
   * wants while the cut is being worked out. edit() is the locked, full-res
   * render that creates the asset and asks the human to review.
   *
   * @returns {{ processed, skipped, path? }}
   */
  preview({ targetId = null, dryRun = false } = {}) {
    if (!targetId) throw new Error('preview requires { targetId }');
    const item = this._item(targetId);

    const footage = this._primaryFootage(item.id);
    if (!footage) {
      this.log('preview', { targetType: 'content_item', targetId: item.id, status: 'skipped', message: 'no footage attached yet' });
      return { processed: 0, skipped: 1 };
    }

    const snapshotPlan = this._readSnapshotPlan(item.id);
    if (snapshotPlan === null) {
      this.log('preview', { targetType: 'content_item', targetId: item.id, status: 'skipped', message: 'no snapshot plan written yet' });
      return { processed: 0, skipped: 1, needsSnapshotPlan: true };
    }

    const style = loadStyle();
    const videoPath = path.resolve(PROJECT_ROOT, footage.file_path);
    const probe = this._probe(videoPath);
    const duration = probe.duration ?? item.desired_length_seconds ?? 60;
    const orientation = this._resolveOrientation(null, probe);
    const fit = this._fitFor(orientation, probe);
    const compositionDir = this._compositionDir(item.id);

    // Re-run the full gates (narration cue/coverage included) at build time.
    const narration = this._narrationFor(item, compositionDir, videoPath);
    const problems = validateSnapshotPlan(snapshotPlan, narration ?? {});
    problems.push(...this._clipMediaProblems(snapshotPlan));
    if (problems.length) {
      this.log('preview', { targetType: 'content_item', targetId: item.id, status: 'skipped', message: `snapshot plan is invalid: ${problems.join(' | ')}` });
      return { processed: 0, skipped: 1, problems };
    }

    if (!this.snapshotPlanApproved(item.id)) {
      this.log('preview', {
        targetType: 'content_item', targetId: item.id, status: 'skipped',
        message: 'snapshot plan not approved yet — show the plan in chat and approve it before rendering',
      });
      return { processed: 0, skipped: 1, needsSnapshotPlan: true };
    }

    const dims = this._renderDims(style, 'preview', probe, orientation);
    const summary = summarizeSnapshotPlan(snapshotPlan);
    if (dryRun) {
      this.log('preview', { targetType: 'content_item', targetId: item.id, message: `would render a ${dims.width}x${dims.height} preview: ${summary.snapshots} snapshot(s), ${summary.beats} beat(s) (dry run)` });
      return { processed: 1, skipped: 0 };
    }

    mkdirSync(compositionDir, { recursive: true });

    const { html } = this._buildSnapshots(item, footage, snapshotPlan, { videoPath, probe, duration, style, compositionDir, mode: 'preview', orientation, fit });
    writeFileSync(path.join(compositionDir, 'index.html'), html, 'utf8');

    mkdirSync(this.rendersDir, { recursive: true });
    const outputPath = this.paths.renderPath(item.id, 'preview');
    const render = this._renderComposition(compositionDir, outputPath, style, 'preview', orientation);
    if (!render.success) {
      this.log('preview', { targetType: 'content_item', targetId: item.id, status: 'error', message: `render failed: ${render.error}` });
      return { processed: 0, skipped: 1 };
    }

    this.log('preview', { targetType: 'content_item', targetId: item.id, message: `rendered a ${dims.width}x${dims.height} preview to ${outputPath}` });
    return { processed: 1, skipped: 0, path: outputPath };
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

    const snapshotPlan = this._readSnapshotPlan(item.id);
    if (snapshotPlan === null) {
      this.log('edit', {
        targetType: 'content_item', targetId: item.id, status: 'skipped',
        message: 'no snapshot plan written yet — plan the video before building it',
      });
      return { processed: 0, skipped: 1, assets: 0, needsSnapshotPlan: true };
    }

    const style = loadStyle();
    const videoPath = path.resolve(PROJECT_ROOT, footage.file_path);
    const probe = this._probe(videoPath);
    const duration = probe.duration ?? item.desired_length_seconds ?? 60;
    const orientation = this._resolveOrientation(null, probe);
    const fit = this._fitFor(orientation, probe);
    const dims = this._renderDims(style, 'final', probe, orientation);
    const compositionDir = this._compositionDir(item.id);

    // Re-run the full gates (narration cue/coverage included) at build time.
    const narration = this._narrationFor(item, compositionDir, videoPath);
    const problems = validateSnapshotPlan(snapshotPlan, narration ?? {});
    problems.push(...this._clipMediaProblems(snapshotPlan));
    if (problems.length) {
      this.log('edit', {
        targetType: 'content_item', targetId: item.id, status: 'skipped',
        message: `snapshot plan is invalid: ${problems.join(' | ')}`,
      });
      return { processed: 0, skipped: 1, assets: 0, problems };
    }

    if (!this.snapshotPlanApproved(item.id)) {
      this.log('edit', {
        targetType: 'content_item', targetId: item.id, status: 'skipped',
        message: 'snapshot plan not approved yet — show the plan in chat and approve it before building',
      });
      return { processed: 0, skipped: 1, assets: 0, needsSnapshotPlan: true };
    }

    const summary = summarizeSnapshotPlan(snapshotPlan);
    if (dryRun) {
      this.log('edit', {
        targetType: 'content_item', targetId: item.id,
        message: `would build the video: ${summary.snapshots} snapshot(s), ${summary.beats} beat(s) (dry run)`,
      });
      return { processed: 1, skipped: 0, assets: 0 };
    }

    mkdirSync(compositionDir, { recursive: true });

    const { html, scenes } = this._buildSnapshots(item, footage, snapshotPlan, { videoPath, probe, duration, style, compositionDir, mode: 'final', orientation, fit });
    writeFileSync(path.join(compositionDir, 'index.html'), html, 'utf8');

    mkdirSync(this.rendersDir, { recursive: true });
    const picturePath = this.paths.renderPath(item.id, 'final');
    const render = this._renderComposition(compositionDir, picturePath, style, 'final', orientation);
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
      outputPath: this.paths.renderPath(item.id, 'mixed'),
      sfx: [],
      style,
      resolveSfx: () => null,
    });
    if (mix.mixed) finalPath = this.paths.renderPath(item.id, 'mixed');
    else if (mix.error) {
      this.log('edit', {
        targetType: 'content_item', targetId: item.id, status: 'error',
        message: `sfx mix failed, keeping the plain picture: ${mix.error}`,
      });
    }

    this.db.prepare(
      'INSERT INTO assets (content_item_id, platform, file_path, status, duration_seconds, width, height, orientation) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(item.id, 'original', finalPath, 'review', duration, dims.width, dims.height, orientation);

    transition(this.db, item.id, 'editing', {
      actor: `engine:${this.name}`,
      reason: `video built (${scenes} scene(s)) and rendered`,
    });

    this.log('edit', {
      targetType: 'content_item', targetId: item.id,
      message: `rendered ${finalPath}, created asset, moved to 'editing'`,
    });
    return { processed: 1, skipped: 0, assets: 1 };
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
          path.resolve(this.paths.data, filePath),
          path.resolve(process.cwd(), filePath),
        ];
    return candidates.find((p) => existsSync(p)) ?? null;
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

  /**
   * Put the source next to the composition as `source.<ext>` — HARDLINKED when
   * the filesystem allows, so the a-roll costs zero extra bytes instead of the
   * full duplicate this used to copy (116MB and 63MB, twice on disk).
   * Returns the name the composition HTML references, relative to its folder.
   */
  _sourceInto(compositionDir, videoPath) {
    const name = `source${path.extname(videoPath)}`;
    const dest = path.join(compositionDir, name);
    if (path.resolve(videoPath) !== path.resolve(dest) && !existsSync(dest)) {
      linkOrCopy(videoPath, dest);
    }
    return name;
  }

  /**
   * Put a clip next to the composition as `clip-<id><ext>` (hardlinked when the
   * filesystem allows) and return the name the composition references. The clip
   * must sit in the composition folder so the renderer can serve it.
   */
  _clipInto(compositionDir, clip) {
    if (!clip?.src) return null;
    const resolved = this._resolveFootagePath(clip.src);
    if (!resolved) return null;
    const name = `clip-${clip.id}${path.extname(resolved)}`;
    const dest = path.join(compositionDir, name);
    if (path.resolve(resolved) !== path.resolve(dest) && !existsSync(dest)) {
      linkOrCopy(resolved, dest);
    }
    return name;
  }

  /**
   * Refuse clips the renderer cannot play: a file that is not on disk, or a
   * source window past the end of the clip. Structural checks (1x length, src,
   * why) live in validateSnapshotPlan; this resolves real files.
   */
  _clipMediaProblems(plan) {
    const problems = [];
    const segments = Array.isArray(plan?.segments) ? plan.segments : [];
    segments.forEach((seg, i) => {
      if (seg?.kind !== 'clip') return;
      const at = `segments[${i}]`;
      const resolved = seg.src ? this._resolveFootagePath(seg.src) : null;
      if (!resolved) {
        problems.push(`${at} (clip) source not found: ${seg.src || '(missing src)'}`);
        return;
      }
      if (!VIDEO_EXT.has(path.extname(resolved).toLowerCase())) {
        problems.push(`${at} (clip) is not a video: ${path.basename(resolved)}`);
        return;
      }
      const probe = this._probe(resolved);
      const total = probe.duration;
      const srcIn = Number.isFinite(seg.sourceIn) ? seg.sourceIn : 0;
      const onScreen = Number.isFinite(seg.start) && Number.isFinite(seg.end) ? seg.end - seg.start : 0;
      const srcOut = Number.isFinite(seg.sourceOut) ? seg.sourceOut : srcIn + onScreen;
      if (!Number.isFinite(total) || total <= 0) return;
      if (srcIn >= total) {
        problems.push(`${at} (clip) sourceIn ${srcIn}s is past the clip end (${total.toFixed(2)}s)`);
      } else if (srcOut > total + 0.05) {
        problems.push(`${at} (clip) needs ${srcOut.toFixed(2)}s of source but the clip is ${total.toFixed(2)}s`);
      }
    });
    return problems;
  }

  /**
   * The transcript for this footage — ONE file, always the sibling of the video
   * it describes (`<video>.transcript.json`), never a copy in the composition
   * folder. A legacy composition that already carries its own `transcript.json`
   * keeps reading it, so an item under review never has to move.
   */
  _transcriptFor(compositionDir, videoPath) {
    const legacyLocal = path.join(compositionDir, 'transcript.json');
    const sibling = this.paths.transcriptFor(videoPath);
    if (existsSync(legacyLocal)) return JSON.parse(readFileSync(legacyLocal, 'utf8'));

    const fresh = existsSync(videoPath) && existsSync(sibling)
      && statSync(sibling).size > 0
      && statSync(sibling).mtimeMs >= statSync(videoPath).mtimeMs;
    if (!fresh) {
      const res = spawnSync('python', [
        TRANSCRIBE_PY, videoPath, '--model', 'base.en', '--out', sibling, '--lexicon', LEXICON_PATH,
      ], { encoding: 'utf8', timeout: 300000 });
      if (res.status !== 0) throw new Error(`transcription failed: ${res.stderr}`);
    }
    return JSON.parse(readFileSync(sibling, 'utf8'));
  }

  /**
   * The narration (words + beats) for a plan's build-time gates, when a script
   * and transcript already exist. Never transcribes — returns null when the
   * narration is not yet available, so a build can still be attempted before the
   * plan-time gates have run (they remain the source of truth).
   */
  _narrationFor(item, compositionDir, videoPath) {
    const scriptText = this._scriptText(item);
    if (!scriptText) return null;
    const local = path.join(compositionDir, 'transcript.json');
    const sibling = videoPath.replace(/\.[^.]+$/, '.transcript.json');
    const file = existsSync(local) ? local : (existsSync(sibling) ? sibling : null);
    if (!file) return null;
    try {
      const transcriptJson = JSON.parse(readFileSync(file, 'utf8'));
      return { words: buildWords(scriptText, transcriptJson), beats: deriveNarrationBeats({ scriptText, transcriptJson }) };
    } catch {
      return null;
    }
  }

  /**
   * Resolve the output orientation. Default is the footage's own orientation:
   * portrait footage makes a portrait master, landscape makes landscape. A plan
   * may override it explicitly with `plan.output.orientation`.
   */
  _resolveOrientation(plan, probe) {
    const explicit = plan?.output?.orientation;
    if (explicit === 'portrait' || explicit === 'landscape') return explicit;
    const w = probe?.width;
    const h = probe?.height;
    if (w && h) return h > w ? 'portrait' : 'landscape';
    return 'landscape';
  }

  /**
   * How the a-roll fills the canvas. Same orientation -> `cover` (fill the
   * frame, minimal edge crop). Different orientation -> `contain` (show the
   * whole video, the backdrop in the empty space) so a portrait recording is
   * never cropped into a landscape frame.
   */
  _fitFor(orientation, probe) {
    const w = probe?.width;
    const h = probe?.height;
    if (!w || !h) return 'cover';
    const source = h > w ? 'portrait' : 'landscape';
    return source === orientation ? 'cover' : 'contain';
  }

  /** The canvas size for an orientation + render mode, from the locked style. */
  _renderDims(style, mode, probe, orientation = 'landscape') {
    const r = style?.render ?? {};
    const byOrientation = r[orientation] ?? {};
    // Fall back to a legacy flat preview/final config for older style files.
    const cfg = byOrientation[mode] ?? r[mode] ?? r.final ?? {};
    const width = cfg.width ?? probe?.width ?? 1920;
    const aspect = probe?.width && probe?.height ? probe.height / probe.width : 9 / 16;
    const height = cfg.height ?? Math.round(width * aspect);
    return { width, height, fps: cfg.fps ?? 30, orientation };
  }

  /**
   * The caption clock for a video. Prefer the cleaner's alignment sidecar
   * (`<name>.align.json`, produced from the aligned audio) when it exists and is
   * healthy; otherwise use the transcript the cleaner wrote. Both come from the
   * same aligned audio, so the sidecar is a guarantee of provenance, not a
   * different clock. Returns { words, source }.
   */
  _captionClock(compositionDir, videoPath, asrWords) {
    const alignPath = videoPath.replace(/\.[^.]+$/, '.align.json');
    if (existsSync(alignPath) && statSync(alignPath).size > 0) {
      try {
        const a = JSON.parse(readFileSync(alignPath, 'utf8'));
        // ok + tiny drift means the alignment is trustworthy; the word timings in
        // the transcript already live on this clock.
        if (a && a.ok) return { words: asrWords, source: `align:${path.basename(alignPath)}` };
      } catch {
        // unreadable sidecar — fall through to the transcript
      }
    }
    return { words: asrWords, source: 'transcript' };
  }

  /** The final spoken script text for captions, or null when there is none. */
  _scriptText(item) {
    const raw = item?.script;
    if (typeof raw !== 'string' || !raw.trim()) return null;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.script === 'string' && parsed.script.trim()) return parsed.script;
      if (typeof parsed === 'string' && parsed.trim()) return parsed;
    } catch {
      // not JSON — treat as plain text below
      return raw;
    }
    return null;
  }

  /** Render a HyperFrames composition to MP4 at the locked output quality. */
  _renderComposition(compositionDir, outputPath, style = null, mode = 'final', orientation = 'landscape') {
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

    // The engine owns the render settings (config/style.json -> render), so
    // HyperFrames never guesses. Passing -w explicitly overrides its low-memory
    // pin and its auto worker sizing; --no-low-memory-mode keeps hardware GPU
    // capture, which low-memory mode would force to software. fps comes from the
    // mode (preview | final). --experimental-fast-capture is deliberately unused:
    // drawElement self-verification fails on this composition.
    const s = style ?? loadStyle();
    const r = s?.render ?? {};
    const crf = s?.output?.crf;
    const canvas = r[orientation]?.[mode] ?? r[mode] ?? {};
    const fps = canvas.fps ?? r.fps;

    const args = [
      '--disable-warning=ExperimentalWarning', HYPERFRAMES_BIN, 'render', compositionDir, '-o', outputPath,
    ];
    if (crf != null) args.push('--crf', String(crf));
    if (r.workers != null) args.push('-w', String(r.workers));
    if (fps != null) args.push('-f', String(fps));
    if (r.quality) args.push('-q', String(r.quality));
    args.push(r.browserGpu === false ? '--no-browser-gpu' : '--browser-gpu');
    if (r.lowMemoryMode === false) args.push('--no-low-memory-mode');
    else if (r.lowMemoryMode === true) args.push('--low-memory-mode');
    if (r.protocolTimeoutMs != null) args.push('--protocol-timeout', String(r.protocolTimeoutMs));

    // Let a render survive a machine sleep (S3 freezes and resumes processes; the
    // kill comes from timeouts firing on wake, not from the sleep). Raise the
    // browser-side timeouts too so probe/calibration sessions do not expire.
    if (r.protocolTimeoutMs != null) {
      env.PRODUCER_PUPPETEER_PROTOCOL_TIMEOUT_MS = String(r.protocolTimeoutMs);
      env.PRODUCER_PAGE_NAVIGATION_TIMEOUT_MS = String(r.protocolTimeoutMs);
      env.PRODUCER_PLAYER_READY_TIMEOUT_MS = String(r.protocolTimeoutMs);
    }

    const result = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: r.timeoutMs ?? 1800000, env });

    if (result.error) return { success: false, error: result.error.message };
    if (result.status !== 0) return { success: false, error: `exit code ${result.status}: ${result.stderr?.slice(0, 500)}` };
    // HyperFrames drops its scratch (work-*, *.hf-transaction-*) inside the
    // project dir. It is not part of this item, so clear it while we know no
    // render is running — otherwise it piles up (one smoke run left 228 frames).
    pruneRenderScratch(compositionDir);
    return { success: true };
  }
}
