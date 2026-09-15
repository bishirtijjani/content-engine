// Production Engine — "How do we turn our recording into finished content?"
//
// Pipeline: Raw footage -> process -> edit -> captions -> visuals -> platform versions
// Output:   FINISHED ASSETS (content item in status `editing`, assets in `review`)
//
// Owned states: shot, editing
//
// This engine uses HyperFrames as the rendering engine. It does NOT extend
// BaseEngine — instead it orchestrates state transitions, gate management, and
// DB writes around HyperFrames CLI invocations. The engine never writes content
// (scripts, narration); it only finalizes agent-written content and manages
// the production state machine.
//
// State transitions:
//   ready_to_shoot -> shot     (no gate — footage captured)
//   shot -> editing            (no gate — editing complete)
//   editing -> scheduled       (requires asset_review gate — human approves)
//
// Usage:
//   engine.processFootage({ targetId })  — mark item as shot, link recordings
//   engine.edit({ targetId })            — generate composition, render, create assets
//   engine.requestReview({ targetId })   — request asset_review gate after editing
//   engine.resubmit({ targetId })        — revision loop after rejected asset review
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  transition,
  requestGate,
  latestPending,
  decideGate,
  contentItem,
} from '@content-os/core';
import { generateComposition } from './composition.js';
import { buildCaptionsComposition } from './build-captions.mjs';

// Resolve the hyperframes CLI path relative to this package's location.
// On Windows, node_modules/.bin entries are shell scripts, so we use the
// direct .mjs entry point instead.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HYPERFRAMES_BIN = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'node_modules',
  'hyperframes',
  'bin',
  'hyperframes.mjs',
);

/**
 * Production Engine — orchestrates the post-shoot pipeline using HyperFrames
 * for rendering. Manages the `shot` and `editing` states and the `asset_review`
 * gate.
 */
export class ProductionEngine {
  static NAME = 'production';
  static OWNED_STATES = ['shot', 'editing'];
  static ACTIONS = ['process_footage', 'edit', 'request_review', 'resubmit'];

  // Map action names (snake_case) to method names (camelCase)
  static ACTION_METHODS = {
    process_footage: 'processFootage',
    edit: 'edit',
    request_review: 'requestReview',
    resubmit: 'resubmit',
  };

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

  // =========================================================================
  // PROCESS FOOTAGE — mark item as shot, link recordings
  // -------------------------------------------------------------------------
  // Transitions: ready_to_shoot -> shot
  // No gate required. The item has been recorded; we link the recording(s)
  // and move it into the `shot` state so the edit step can pick it up.
  // =========================================================================

  /**
   * Mark a content item as shot and optionally link recordings.
   * @param {Object} opts
   * @param {number} opts.targetId - The content item ID
   * @param {Array<number>} [opts.recordingIds] - Recording IDs to link
   * @param {boolean} [opts.dryRun] - Preview without changes
   * @returns {{ processed: number, skipped: number }}
   */
  processFootage({ targetId = null, recordingIds = [], dryRun = false } = {}) {
    if (!targetId) {
      throw new Error('process_footage requires { targetId }');
    }

    const raw = this.db.prepare('SELECT * FROM content_items WHERE id = ?').get(targetId);
    if (!raw) {
      throw new Error(`content item ${targetId} not found`);
    }
    const item = contentItem(raw);

    if (item.status !== 'ready_to_shoot') {
      this.log('process_footage', {
        targetType: 'content_item', targetId: item.id, status: 'skipped',
        message: `item is '${item.status}', expected 'ready_to_shoot'`,
      });
      return { processed: 0, skipped: 1 };
    }

    if (dryRun) {
      this.log('process_footage', {
        targetType: 'content_item', targetId: item.id,
        message: `would transition to 'shot' and link ${recordingIds.length} recording(s) (dry run)`,
      });
      return { processed: 1, skipped: 0 };
    }

    // Link recordings if provided
    for (const recId of recordingIds) {
      this.db.prepare(
        'INSERT OR IGNORE INTO content_item_recordings (content_item_id, recording_id, role) VALUES (?, ?, ?)'
      ).run(item.id, recId, 'primary');
    }

    transition(this.db, item.id, 'shot', {
      actor: `engine:${this.name}`,
      reason: `footage captured, ${recordingIds.length} recording(s) linked`,
    });

    this.log('process_footage', {
      targetType: 'content_item', targetId: item.id,
      message: `moved to 'shot', linked ${recordingIds.length} recording(s)`,
    });
    return { processed: 1, skipped: 0 };
  }

  // =========================================================================
  // EDIT — generate composition, render, create assets
  // -------------------------------------------------------------------------
  // Transitions: shot -> editing
  // No gate required. The engine handles two workflows:
  //
  // 1. Footage workflow: item has recordings (linked via content_item_recordings).
  //    Transcribe the footage, build captions, generate a HyperFrames composition
  //    with embedded captions, and render.
  //
  // 2. Script workflow: item has an agent-written script (JSON with hook, script,
  //    points, cta, shot_notes). Generate a composition from the script and render.
  //
  // The engine never writes content. It only finalizes agent-written content
  // (scripts) and processes footage (transcription, captioning, rendering).
  // =========================================================================

  /**
   * Edit a shot content item: generate composition, render, create assets.
   * @param {Object} opts
   * @param {number} opts.targetId - The content item ID
   * @param {boolean} [opts.dryRun] - Preview without changes
   * @returns {{ processed: number, skipped: number, assets: number }}
   */
  edit({ targetId = null, dryRun = false, emphasis = null } = {}) {
    if (!targetId) {
      throw new Error('edit requires { targetId }');
    }

    const raw = this.db.prepare('SELECT * FROM content_items WHERE id = ?').get(targetId);
    if (!raw) {
      throw new Error(`content item ${targetId} not found`);
    }
    const item = contentItem(raw);

    if (item.status !== 'shot') {
      this.log('edit', {
        targetType: 'content_item', targetId: item.id, status: 'skipped',
        message: `item is '${item.status}', expected 'shot'`,
      });
      return { processed: 0, skipped: 1, assets: 0 };
    }

    // Check for footage (recordings linked to this item)
    const recordings = this.db.prepare(
      'SELECT r.* FROM recordings r ' +
      'JOIN content_item_recordings cir ON r.id = cir.recording_id ' +
      'WHERE cir.content_item_id = ? ORDER BY r.id'
    ).all(item.id);

    const hasFootage = recordings.length > 0 && recordings.some(r => r.file_path);
    const hasScript = item.script;

    if (!hasFootage && !hasScript) {
      this.log('edit', {
        targetType: 'content_item', targetId: item.id, status: 'skipped',
        message: 'waiting for footage or agent-written script — the engine never writes content',
      });
      return { processed: 0, skipped: 1, assets: 0 };
    }

    if (dryRun) {
      const mode = hasFootage ? 'footage+captions' : 'script';
      this.log('edit', {
        targetType: 'content_item', targetId: item.id,
        message: `would generate composition (${mode}), render, and create assets (dry run)`,
      });
      return { processed: 1, skipped: 0, assets: 0 };
    }

    // Generate the HyperFrames composition
    const compositionDir = path.join(
      process.cwd(),
      'data',
      'compositions',
      `item-${item.id}`,
    );
    if (!existsSync(compositionDir)) {
      mkdirSync(compositionDir, { recursive: true });
    }

    let compositionHtml;
    let compositionType;

    if (hasFootage) {
      // Footage workflow: transcribe, build captions, generate composition
      compositionHtml = this._buildFootageComposition(item, recordings, compositionDir, { emphasis });
      compositionType = 'footage';
    } else {
      // Script workflow: parse script JSON and generate composition
      let script;
      try {
        script = JSON.parse(item.script);
      } catch {
        this.log('edit', {
          targetType: 'content_item', targetId: item.id, status: 'skipped',
          message: 'script is not valid JSON — cannot generate composition',
        });
        return { processed: 0, skipped: 1, assets: 0 };
      }
      compositionHtml = generateComposition(script, item);
      compositionType = 'script';
    }

    const compositionPath = path.join(compositionDir, 'index.html');
    writeFileSync(compositionPath, compositionHtml, 'utf8');

    this.log('edit', {
      targetType: 'content_item', targetId: item.id,
      message: `composition generated (${compositionType}) at ${compositionPath}`,
    });

    // Render the composition using HyperFrames CLI
    const outputPath = path.join(
      process.cwd(),
      'data',
      'renders',
      `item-${item.id}.mp4`,
    );
    if (!existsSync(path.join(process.cwd(), 'data', 'renders'))) {
      mkdirSync(path.join(process.cwd(), 'data', 'renders'), { recursive: true });
    }

    const renderResult = this._renderComposition(compositionDir, outputPath);

    if (!renderResult.success) {
      this.log('edit', {
        targetType: 'content_item', targetId: item.id, status: 'error',
        message: `render failed: ${renderResult.error}`,
      });
      return { processed: 0, skipped: 1, assets: 0 };
    }

    // Create the original asset row
    this.db.prepare(
      'INSERT INTO assets (content_item_id, platform, file_path, status, duration_seconds) ' +
      'VALUES (?, ?, ?, ?, ?)'
    ).run(item.id, 'original', outputPath, 'review', item.desired_length_seconds ?? 60);

    // Transition to editing
    transition(this.db, item.id, 'editing', {
      actor: `engine:${this.name}`,
      reason: `composition rendered (${compositionType}), asset created`,
    });

    this.log('edit', {
      targetType: 'content_item', targetId: item.id,
      message: `rendered to ${outputPath}, created original asset, moved to 'editing'`,
    });
    return { processed: 1, skipped: 0, assets: 1 };
  }

  // =========================================================================
  // REQUEST REVIEW — request asset_review gate after editing
  // -------------------------------------------------------------------------
  // After editing is complete, the engine requests the asset_review gate.
  // The human watches the finished video and approves or sends it back.
  // =========================================================================

  /**
   * Request the asset_review gate for an editing content item.
   * @param {Object} opts
   * @param {number} opts.targetId - The content item ID
   * @param {boolean} [opts.dryRun] - Preview without changes
   * @returns {{ processed: number, skipped: number }}
   */
  requestReview({ targetId = null, dryRun = false } = {}) {
    if (!targetId) {
      throw new Error('request_review requires { targetId }');
    }

    const raw = this.db.prepare('SELECT * FROM content_items WHERE id = ?').get(targetId);
    if (!raw) {
      throw new Error(`content item ${targetId} not found`);
    }
    const item = contentItem(raw);

    if (item.status !== 'editing') {
      this.log('request_review', {
        targetType: 'content_item', targetId: item.id, status: 'skipped',
        message: `item is '${item.status}', expected 'editing'`,
      });
      return { processed: 0, skipped: 1 };
    }

    // Check if there's already a pending asset_review gate
    const pending = latestPending(this.db, 'asset_review', 'content_item', item.id);
    if (pending) {
      this.log('request_review', {
        targetType: 'content_item', targetId: item.id, status: 'skipped',
        message: `asset_review gate already pending (id ${pending.id})`,
      });
      return { processed: 0, skipped: 1 };
    }

    if (dryRun) {
      this.log('request_review', {
        targetType: 'content_item', targetId: item.id,
        message: 'would request asset_review gate (dry run)',
      });
      return { processed: 1, skipped: 0 };
    }

    requestGate(this.db, 'asset_review', 'content_item', item.id, {
      requestedBy: `engine:${this.name}`,
      note: 'edited video ready for review',
    });

    this.log('request_review', {
      targetType: 'content_item', targetId: item.id,
      message: 'asset_review gate requested',
    });
    return { processed: 1, skipped: 0 };
  }

  // =========================================================================
  // RESUBMIT — revision loop after a rejected asset review
  // -------------------------------------------------------------------------
  // When a human rejects the asset_review gate, the item stays `editing`
  // with a rejected gate. The agent edits the script (directly in the DB),
  // then calls this action to request a fresh review. Rejected gates remain
  // as history; each resubmit creates a new pending gate.
  //
  // Requires an explicit targetId: blanket-resubmitting every rejected item
  // would re-request reviews for videos nobody actually revised.
  // =========================================================================

  /**
   * Request a fresh asset_review gate after rejection.
   * @param {Object} opts
   * @param {number} opts.targetId - The content item ID
   * @param {boolean} [opts.dryRun] - Preview without changes
   * @returns {{ processed: number }}
   */
  resubmit({ targetId = null, dryRun = false } = {}) {
    if (!targetId) {
      throw new Error('resubmit requires { targetId } — name the item whose revised edit should be re-reviewed');
    }

    const raw = this.db.prepare('SELECT * FROM content_items WHERE id = ?').get(targetId);
    if (!raw) {
      throw new Error(`content item ${targetId} not found`);
    }
    const item = contentItem(raw);

    if (item.status !== 'editing') {
      throw new Error(`item ${item.id} is '${item.status}', expected 'editing'`);
    }

    const latestGate = this.db.prepare(
      "SELECT status FROM gates WHERE gate_type = 'asset_review' AND target_type = 'content_item' " +
      'AND target_id = ? ORDER BY id DESC LIMIT 1'
    ).get(item.id);

    if (!latestGate) {
      throw new Error(`item ${item.id} has no asset_review gate to resubmit`);
    }
    if (latestGate.status !== 'rejected') {
      throw new Error(`item ${item.id} has no rejected asset_review to resubmit (latest is '${latestGate.status}')`);
    }

    if (dryRun) {
      this.log('resubmit', {
        targetType: 'content_item', targetId: item.id,
        message: 'would re-request asset_review gate (dry run)',
      });
      return { processed: 1 };
    }

    requestGate(this.db, 'asset_review', 'content_item', item.id, {
      requestedBy: `engine:${this.name}`,
      note: 'revised edit — re-requesting review after rejection',
    });

    this.log('resubmit', {
      targetType: 'content_item', targetId: item.id,
      message: 'fresh asset_review gate requested',
    });
    return { processed: 1 };
  }

  // =========================================================================
  // RUN — dispatch to a specific action or run the full production pipeline
  // -------------------------------------------------------------------------
  // Unlike the content engine, this does NOT use the BaseEngine.run() pattern.
  // The production engine has its own dispatch because it integrates with
  // HyperFrames CLI and has different state semantics.
  // =========================================================================

  /**
   * Run the production engine.
   * @param {Object} opts
   * @param {number} [opts.targetId] - Process a specific item only
   * @param {string} [opts.action]   - Run a specific action
   * @param {boolean} [opts.dryRun]  - Preview without changes
   */
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

  /**
   * Full production pipeline: process_footage -> edit -> request_review.
   * When targetId is provided, processes that single item through all stages.
   * When targetId is null, surveys owned states and processes all items.
   */
  pipeline({ targetId = null, dryRun = false } = {}) {
    const results = {};

    if (targetId) {
      // Single-item pipeline
      results.process_footage = this.processFootage({ targetId, dryRun });
      results.edit = this.edit({ targetId, dryRun });
      results.request_review = this.requestReview({ targetId, dryRun });
    } else {
      // Batch: process all items in owned states
      const shotItems = this.db.prepare(
        "SELECT id FROM content_items WHERE status = 'ready_to_shoot' ORDER BY id"
      ).all();
      const editingItems = this.db.prepare(
        "SELECT id FROM content_items WHERE status = 'shot' ORDER BY id"
      ).all();
      const reviewItems = this.db.prepare(
        "SELECT id FROM content_items WHERE status = 'editing' ORDER BY id"
      ).all();

      let pfProcessed = 0, pfSkipped = 0;
      for (const row of shotItems) {
        const r = this.processFootage({ targetId: row.id, dryRun });
        pfProcessed += r.processed;
        pfSkipped += r.skipped;
      }
      results.process_footage = { processed: pfProcessed, skipped: pfSkipped };

      let eProcessed = 0, eSkipped = 0, eAssets = 0;
      for (const row of editingItems) {
        const r = this.edit({ targetId: row.id, dryRun });
        eProcessed += r.processed;
        eSkipped += r.skipped;
        eAssets += r.assets ?? 0;
      }
      results.edit = { processed: eProcessed, skipped: eSkipped, assets: eAssets };

      let rrProcessed = 0, rrSkipped = 0;
      for (const row of reviewItems) {
        const r = this.requestReview({ targetId: row.id, dryRun });
        rrProcessed += r.processed;
        rrSkipped += r.skipped;
      }
      results.request_review = { processed: rrProcessed, skipped: rrSkipped };
    }

    const total = Object.values(results).reduce((s, r) => s + (r.processed ?? 0), 0);
    this.log('pipeline', {
      message: `full production pipeline: ${total} item(s) processed — ` +
        Object.entries(results).map(([k, v]) => `${k}:${v.processed ?? 0}`).join(' '),
    });
    return results;
  }

  // =========================================================================
  // HELPERS
  // =========================================================================

  /**
   * Build a HyperFrames composition from footage + transcript.
   * Transcribes the footage (if not already transcribed), builds captions,
   * and generates the composition HTML.
   * @param {Object} item - Content item row
   * @param {Array} recordings - Recording rows linked to this item
   * @param {string} compositionDir - Output directory for the composition
   * @returns {string} HTML composition string
   */
  _buildFootageComposition(item, recordings, compositionDir, { emphasis = null } = {}) {
    const primaryRecording = recordings.find(r => r.role === 'primary') || recordings[0];
    const videoPath = path.resolve(primaryRecording.file_path);

    // Probe video dimensions. Audio-only sources (e.g. a WAV voiceover) have
    // no video stream, so ffprobe returns an empty `streams` array. In that
    // case we fall back to the default 9:16 portrait canvas (1080x1920) and
    // let the captions composition carry the visuals.
    const probeResult = spawnSync('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height', '-show_entries', 'format=duration',
      '-of', 'json', videoPath,
    ], { encoding: 'utf8' });

    if (probeResult.status !== 0) {
      throw new Error(`ffprobe failed: ${probeResult.stderr}`);
    }

    const probe = JSON.parse(probeResult.stdout);
    const videoStream = probe.streams && probe.streams[0];
    const audioOnly = !videoStream;
    const width = videoStream?.width ?? 1080;
    const height = videoStream?.height ?? 1920;
    const duration = Number(probe.format.duration);

    // Copy the source media into the composition project directory so the
    // composition references it with a root-relative path. HyperFrames
    // requires assets to live inside the project root — paths like
    // "../../audio1.wav" are rejected by the renderer.
    const mediaExt = path.extname(videoPath);
    const mediaName = `source${mediaExt}`;
    const mediaDest = path.join(compositionDir, mediaName);
    if (!existsSync(mediaDest)) {
      copyFileSync(videoPath, mediaDest);
    }
    const mediaSrc = mediaName; // root-relative within the composition project

    // Transcribe if not already done
    const transcriptPath = path.join(compositionDir, 'transcript.json');
    if (!existsSync(transcriptPath)) {
      const lexiconPath = path.join(process.cwd(), 'packages', 'engine-production', 'brand', 'lexicon.json');
      const configPath = path.join(process.cwd(), 'packages', 'engine-production', 'config', 'videoer.config.json');
      const pythonResult = spawnSync('python', [
        path.join(process.cwd(), 'packages', 'engine-production', 'tools', 'transcribe.py'),
        videoPath,
        '--model', 'base.en',
        '--out', transcriptPath,
        '--lexicon', lexiconPath,
      ], { encoding: 'utf8', timeout: 300000 });

      if (pythonResult.status !== 0) {
        throw new Error(`transcription failed: ${pythonResult.stderr}`);
      }
    }

    // Build captions composition
    const words = JSON.parse(readFileSync(transcriptPath, 'utf8'));
    const configPath = path.join(process.cwd(), 'packages', 'engine-production', 'config', 'videoer.config.json');
    const lexiconPath = path.join(process.cwd(), 'packages', 'engine-production', 'brand', 'lexicon.json');

    const { html } = buildCaptionsComposition({
      words,
      videoSrc: mediaSrc,
      width,
      height,
      title: item.title,
      configPath,
      lexiconPath,
      duration,
      audioOnly,
      emphasis,
    });

    return html;
  }

  /**
   * Render a HyperFrames composition to MP4 using the CLI.
   * @param {string} compositionDir - Path to the composition project directory
   * @param {string} outputPath - Output file path
   * @returns {{ success: boolean, error?: string }}
   */
  _renderComposition(compositionDir, outputPath) {
    // On Windows, the pinned chrome-headless-shell may crash. Fall back to
    // the system-installed Chrome if available.
    const env = { ...process.env };
    if (!env.HYPERFRAMES_BROWSER_PATH) {
      const chromePaths = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      ];
      for (const p of chromePaths) {
        if (existsSync(p)) {
          env.HYPERFRAMES_BROWSER_PATH = p;
          break;
        }
      }
    }

    const result = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', HYPERFRAMES_BIN, 'render', compositionDir, '-o', outputPath, '--no-browser-gpu'], {
      encoding: 'utf8',
      timeout: 300000, // 5 minute timeout
      env,
    });

    if (result.error) {
      return { success: false, error: result.error.message };
    }
    if (result.status !== 0) {
      return { success: false, error: `exit code ${result.status}: ${result.stderr?.slice(0, 500)}` };
    }
    return { success: true };
  }
}
