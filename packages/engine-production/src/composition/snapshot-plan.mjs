// composition/snapshot-plan.mjs — emit "the plan" for a video.
//
// Given a snapshot plan (model output), this:
//   1. validates it (snapshot-spec gates),
//   2. writes the plan JSON,
//   3. writes the beats table (markdown),
//   4. renders one still per snapshot's completed composition,
//   5. builds a contact sheet.
// It then reports back so the caller can STOP for approval.
import fs from 'node:fs';
import path from 'node:path';
import { validateSnapshotPlan, normalizeSnapshotPlan, summarizeSnapshotPlan } from './snapshot-spec.mjs';
import { deriveSegments } from './footage.mjs';
import { renderSnapshotStills, renderSnapshotGrid } from './snapshot-render.mjs';
import { buildScriptWords } from '../script-captions.mjs';
import { deriveBeats } from '../beats.mjs';
import { synthesizeDiagramBeats } from '../diagrams/beats.mjs';

const t = (n) => (Math.round(n * 10) / 10).toFixed(1);
const actionText = (a) => (a?.op === 'hold' ? 'hold' : a?.target ? `${a.op} · ${a.target}` : a.op);

/** The beats table, grouped by segment (markdown). */
export function snapshotPlanTable(raw) {
  const plan = normalizeSnapshotPlan(raw);
  const lines = ['| Segment | Beat | Time | Spoken | Action | Element |', '|---|---|---|---|---|---|'];
  plan.segments.forEach((s, i) => {
    const label = `**${i + 1} · ${s.section ?? s.concept ?? s.id}${s.kind === 'footage' ? ' · footage' : s.kind === 'clip' ? ' · clip' : ''}** (${t(s.start)}–${t(s.end)})`;
    if (s.kind === 'footage') {
      const text = (Array.isArray(s.lines) ? s.lines : []).map((l) => l.text).filter(Boolean).join('  ').replace(/\|/g, '\\|');
      lines.push(`| ${label} | — | ${t(s.start)}–${t(s.end)} | ${text} | face | you, talking to camera |`);
      return;
    }
    if (s.kind === 'clip') {
      const text = (Array.isArray(s.lines) ? s.lines : []).map((l) => l.text).filter(Boolean).join('  ').replace(/\|/g, '\\|');
      const file = String(s.src ?? '').split('/').pop();
      const from = Number.isFinite(s.sourceIn) ? `${t(s.sourceIn)}s` : '0.0s';
      lines.push(`| ${label} | — | ${t(s.start)}–${t(s.end)} | ${text} | screen recording · from ${from} | ${file} |`);
      return;
    }
    if (s.beats.length === 0) {
      lines.push(`| ${label} | — | ${t(s.start)}–${t(s.end)} | | — | — |`);
      return;
    }
    s.beats.forEach((b, j) => {
      const segCell = j === 0 ? label : '';
      lines.push(`| ${segCell} | ${b.id} | ${t(b.start)}–${t(b.end)} | ${(b.spoken ?? '').replace(/\|/g, '\\|')} | ${actionText(b.action)} | ${b.element ?? ''} |`);
    });
  });
  return lines.join('\n') + '\n';
}

/**
 * Emit the plan artifacts. Returns { ok, problems } or { ok, summary, table, stills, contact }.
 * @param {object} opts
 * @param {object} opts.plan
 * @param {object} opts.style
 * @param {string} opts.outDir - where artifacts are written (the item's plan folder)
 * @param {Array}  [opts.beats] - narration beats, enables coverage checks
 * @param {Array}  [opts.words] - the narration word stream, enables cue checks
 * @param {string} [opts.htmlDir] - keep rendered HTML here (optional)
 */
export async function emitSnapshotPlan({ plan, style, outDir, beats = null, words = null, htmlDir = null, width = 1080, height = 1920, orientation = 'portrait' }) {
  // A diagram segment without hand-authored beats gets its build order spread
  // across the narration it covers. Timing only; the words stay the speaker's.
  if (beats) plan = synthesizeDiagramBeats(plan, beats, { style });
  const problems = validateSnapshotPlan(plan, { beats, words });
  if (problems.length) return { ok: false, problems };

  const normalized = normalizeSnapshotPlan(plan);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'snapshots.json'), JSON.stringify(normalized, null, 2) + '\n', 'utf8');

  const table = snapshotPlanTable(normalized);
  fs.writeFileSync(path.join(outDir, 'beats.md'), table, 'utf8');

  const snapshots = normalized.segments.filter((s) => s.kind === 'snapshot');
  const stills = await renderSnapshotStills({
    snapshots, style, outDir: path.join(outDir, 'stills'), htmlDir, width, height, orientation,
  });
  const grid = await renderSnapshotGrid({ items: stills, outPath: path.join(outDir, 'snapshot-grid.png') });

  return { ok: true, summary: summarizeSnapshotPlan(normalized), table, stills, grid, dir: outDir };
}

/**
 * Derive narration beats from a video's script + transcript. Every video must be
 * narrated: a missing script/transcript, or no derivable beats, is a hard error.
 */
/** The script-aligned word stream (real punctuation + word timings). */
export function buildWords(scriptText, transcriptJson) {
  const asr = Object.values(transcriptJson).map((w) => ({ text: w.text, start: w.start, end: w.end }));
  return buildScriptWords(String(scriptText), asr);
}

export function deriveNarrationBeats({ scriptText, transcriptJson }) {
  if (!scriptText || !String(scriptText).trim()) throw new Error('video has no script — narration beats cannot be derived');
  if (!transcriptJson) throw new Error('video has no transcript — narration beats cannot be derived');
  const beats = deriveBeats(buildWords(scriptText, transcriptJson));
  if (!beats.length) throw new Error('no narration beats could be derived — refusing to plan a video without narration');
  return beats;
}

/**
 * The mandatory plan step for a video: derive beats, validate the snapshot plan,
 * emit the artifacts (plan JSON, beats table, stills, snapshot grid). HARD-FAILS
 * (throws) if the video has no narration or the plan is invalid — no video is
 * built without a valid snapshot plan.
 */
export async function planVideo({ plan, style, outDir, scriptText, transcriptJson, htmlDir = null, width = 1080, height = 1920, orientation = 'portrait' }) {
  const beats = deriveNarrationBeats({ scriptText, transcriptJson });
  const words = buildWords(scriptText, transcriptJson);
  plan = synthesizeDiagramBeats(plan, beats, { style });
  // Derive the visual timeline (footage + snapshots) from the words, so the plan
  // we emit shows exactly where the face plays.
  const derived = deriveSegments(plan, {
    words,
    narrationBeats: beats,
    minGapSeconds: style?.footage?.minGapSeconds ?? 3.0,
    minSnapshotSeconds: style?.footage?.minSnapshotSeconds ?? 2.0,
  });
  const result = await emitSnapshotPlan({ plan: derived, style, outDir, beats, words, htmlDir, width, height, orientation });
  if (!result.ok) throw new Error(`snapshot plan is invalid:\n - ${result.problems.join('\n - ')}`);
  return { ...result, beats };
}
