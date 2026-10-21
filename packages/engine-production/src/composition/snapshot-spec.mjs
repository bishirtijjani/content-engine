// composition/snapshot-spec.mjs — the SEGMENT plan schema.
//
// The engine's model: Video -> Segments -> Beats.
//   - The video is an ordered list of SEGMENTS. A segment is either FOOTAGE (you
//     talking — the face, no visuals) or a SNAPSHOT (a whole b-roll section shown
//     on the orange backdrop, ONE completed composition, built by its beats).
//   - A BEAT is a visual action that builds toward the snapshot's completed
//     composition (introduce, reveal, move, ...), with its own motion. A beat's
//     `action.target` names the SLOTS of the composition it acts on.
//
// Footage and b-roll are separated: the face shows only in footage segments; a
// snapshot is always on the brand backdrop. A narration beat is covered by the
// segment it falls in.
//
// This module is the shape + the vocabulary + the gates. It does not render.
import { resolveCueTime, slotValue, cueFor } from './sync.mjs';
import { validateSceneGraph, nodeSlots } from './scene-graph.mjs';

// What a beat can do to the composition.
export const ACTION_OPS = [
  'introduce', 'reveal', 'move', 'resize', 'restyle', 'retext', 'replace', 'highlight', 'draw', 'pulse', 'hold',
];

// Ops that land a slot on a narration word (the rest ignore cues).
const CUE_OPS = new Set(['introduce', 'reveal', 'move', 'resize', 'restyle', 'retext', 'replace', 'draw', 'pulse']);

// A segment is footage (the face) or a snapshot (a b-roll composition).
export const SEGMENT_KINDS = ['footage', 'snapshot'];

// The snapshot recipes (each draws a completed composition).
export const SNAPSHOT_CONCEPTS = [
  'title-steps', 'equation', 'keypoint', 'worksheet', 'decision', 'bars', 'quote', 'cta',
];

// How the speaker is treated; kept for back-compat, snapshots are always full-frame.
export const FRAMES = ['overlay', 'split-left', 'split-right', 'full'];

// How a segment hands off to the next (part of the exit).
export const TRANSITIONS = ['cut-the-curve', 'zoom-through', 'blur-crossfade', 'crossfade', 'push-slide', 'none'];

export const MIN_BEAT_SECONDS = 0.4;

const isNum = (n) => typeof n === 'number' && Number.isFinite(n);

/**
 * The addressable parts (slots) of a concept's completed composition, derived
 * from the actual composition so the list matches what the recipe renders.
 * A beat's `action.target` must name slots from this list, and EVERY slot must be
 * introduced by some beat (nothing is on screen before its narration).
 */
export function slotsFor(concept, composition = {}) {
  const c = composition ?? {};
  switch (concept) {
    case 'title-steps':
      return ['head', ...(c.headline ? ['headline'] : []), ...(c.steps ?? []).map((_, i) => `step-${i}`)];
    case 'equation':
      return ['head', ...(c.terms ?? []).map((_, i) => `term-${i}`), ...(c.result ? ['result'] : []), ...(c.note ? ['note'] : [])];
    case 'keypoint':
      return ['head', 'text', ...(c.chips ?? []).map((_, i) => `chip-${i}`)];
    case 'worksheet':
      return ['head', ...(c.headline ? ['headline'] : []), 'header', ...Array.from({ length: c.rows ?? 0 }, (_, i) => `row-${i}`)];
    case 'decision':
      return ['head', 'question', ...(c.branches ?? []).map((_, i) => `branch-${i}`)];
    case 'bars':
      return ['head', ...(c.headline ? ['headline'] : []), ...(c.bars ?? []).map((_, i) => `bar-${i}`)];
    case 'quote':
      return ['head', ...(c.struck ? ['struck'] : []), 'text'];
    case 'cta':
      return ['head', 'text', ...(c.handle ? ['handle'] : []), ...(c.sub ? ['sub'] : [])];
    default:
      return [];
  }
}

/** A beat target as a list of slot ids (string | string[] | undefined). */
export function targetList(target) {
  if (Array.isArray(target)) return target.filter((t) => typeof t === 'string' && t.trim());
  if (typeof target === 'string' && target.trim()) return [target];
  return [];
}

/** Fill defaults so downstream code (and validation) can assume the shape. */
export function normalizeSnapshotPlan(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  // `snapshots` is accepted as a legacy alias for a list of snapshot segments.
  const list = Array.isArray(p.segments) ? p.segments
    : Array.isArray(p.snapshots) ? p.snapshots.map((s) => ({ ...s, kind: s?.kind ?? 'snapshot' }))
      : [];
  const segments = list.map((s) => ({
    ...s,
    kind: s?.kind === 'footage' ? 'footage' : 'snapshot',
    sceneGraph: s?.sceneGraph || undefined,
    composition: s?.composition ?? {},
    beats: Array.isArray(s?.beats) ? s.beats.map((b) => ({ ...b, action: b?.action ?? { op: 'introduce' } })) : [],
    transitionOut: s?.transitionOut ?? { technique: 'crossfade' },
  }));
  return { video: p.video ?? {}, segments };
}

/**
 * Validate a segment plan. Returns a list of problems (empty = good to build).
 * @param {object} raw
 * @param {object} [opts]
 * @param {Array}  [opts.beats] - narration beats (from beats.mjs); enables coverage checks
 * @param {Array}  [opts.words] - narration word stream; enables cue-supported checks
 */
export function validateSnapshotPlan(raw, { beats = null, words = null } = {}) {
  const problems = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ['plan must be an object'];
  const plan = normalizeSnapshotPlan(raw);
  const hasList = Array.isArray(raw.segments) || Array.isArray(raw.snapshots);
  if (!hasList || plan.segments.length === 0) {
    problems.push('plan needs a non-empty "segments" list');
    return problems;
  }
  if (plan.video?.duration !== undefined && !isNum(plan.video.duration)) problems.push('video.duration must be a number');

  const usedIds = new Set();
  let prevEnd = -Infinity;
  let snapshotCount = 0;

  plan.segments.forEach((s, i) => {
    const at = `segments[${i}]`;
    if (typeof s.id !== 'string' || !s.id.trim()) problems.push(`${at} needs an id`);
    else if (usedIds.has(s.id)) problems.push(`${at}.id "${s.id}" is used twice`);
    else usedIds.add(s.id);

    if (!SEGMENT_KINDS.includes(s.kind)) problems.push(`${at}.kind must be one of ${SEGMENT_KINDS.join(', ')}`);
    if (s.frame !== undefined && !FRAMES.includes(s.frame)) problems.push(`${at}.frame must be one of ${FRAMES.join(', ')}`);
    if (s.transitionOut?.technique !== undefined && !TRANSITIONS.includes(s.transitionOut.technique)) {
      problems.push(`${at}.transitionOut.technique must be one of ${TRANSITIONS.join(', ')}`);
    }

    if (!isNum(s.start) || !isNum(s.end) || s.end <= s.start) {
      problems.push(`${at} needs a valid start/end`);
    } else {
      if (s.start < prevEnd - 0.001) problems.push(`${at} overlaps the previous segment or is out of order`);
      prevEnd = s.end;
      if (plan.video?.duration && s.end > plan.video.duration + 0.001) problems.push(`${at}.end is past the video end`);
    }
    if (typeof s.section !== 'string' && s.section !== undefined) problems.push(`${at}.section must be a string`);

    if (s.kind === 'footage') return; // the face; no composition, beats optional

    snapshotCount++;
    if (s.sceneGraph) {
      const sgp = validateSceneGraph(s.sceneGraph);
      sgp.forEach((p) => problems.push(`${at}.sceneGraph: ${p}`));
    } else {
      if (!SNAPSHOT_CONCEPTS.includes(s.concept)) {
        problems.push(`${at}.concept "${s.concept}" is not a snapshot concept (${SNAPSHOT_CONCEPTS.join(', ')})`);
      }
      const comp = s.composition ?? {};
      if (Object.keys(comp).length === 0) problems.push(`${at} has an empty composition — a snapshot must define its completed visual`);
    }

    if (!Array.isArray(s.beats) || s.beats.length === 0) {
      problems.push(`${at} has no beats — a snapshot is built by its beats`);
      return;
    }

    const beatIds = new Set();
    const introduced = new Set();
    s.beats.forEach((b, j) => {
      const bat = `${at}.beats[${j}]`;
      if (typeof b.id !== 'string' || !b.id.trim()) problems.push(`${bat} needs an id`);
      else if (beatIds.has(b.id)) problems.push(`${bat}.id "${b.id}" is used twice`);
      else beatIds.add(b.id);
      if (typeof b.spoken !== 'string' || !b.spoken.trim()) problems.push(`${bat} needs "spoken" (the narration it rides)`);
      if (!isNum(b.start) || !isNum(b.end) || b.end <= b.start) problems.push(`${bat} needs a valid start/end`);
      else {
        if (b.end - b.start < MIN_BEAT_SECONDS) problems.push(`${bat} is shorter than ${MIN_BEAT_SECONDS}s`);
        // A beat may lead in from the footage before its scene (its narration can
        // start before the composition appears); it must not run past the scene.
        if (isNum(s.end) && b.end > s.end + 0.3) problems.push(`${bat} ends after its segment window (${s.end}s)`);
      }
      const op = b.action?.op;
      if (!ACTION_OPS.includes(op)) problems.push(`${bat}.action.op "${op}" must be one of ${ACTION_OPS.join(', ')}`);
      const targets = targetList(b.action?.target);
      if (op !== 'hold' && targets.length === 0) {
        problems.push(`${bat}.action.target is required for op "${op}" (name the slot(s) it acts on)`);
      }
      let validSlots;
      if (s.sceneGraph) {
        validSlots = new Set(nodeSlots(s.sceneGraph));
      } else {
        validSlots = new Set(slotsFor(s.concept, s.composition ?? {}));
      }
      for (const tgt of targets) {
        if (!validSlots.has(tgt)) {
          const label = s.sceneGraph ? 'is not a valid target for this segment' : `is not a slot of ${s.concept}`;
          problems.push(`${bat}.action.target "${tgt}" ${label} (${[...validSlots].join(', ')})`);
        }
        introduced.add(tgt);
        // A reveal must land on the beat's own narration: the slot's cue (an
        // explicit phrase, or the figure it shows) has to be spoken inside this
        // beat's window. Otherwise the element would pop in on unrelated
        // narration — an unsupported visual.
        if (words && CUE_OPS.has(op)) {
          const cue = cueFor(b, tgt) ?? slotValue(s, tgt);
          if (cue != null) {
            const hit = resolveCueTime(cue, words, { min: b.start - 0.3, max: b.end + 0.3 });
            if (hit == null) problems.push(`${bat}.action.target "${tgt}" is cued on "${cue}", which is not spoken in this beat [${b.start}–${b.end}s]`);
          }
        }
      }
    });

    // Every slot must be introduced by a beat — nothing shows before its narration.
    const allSlots = (s.sceneGraph ? nodeSlots(s.sceneGraph) : slotsFor(s.concept, s.composition ?? {}))
      .filter((slot) => slot !== 'root'); // the scene container is always on screen
    for (const slot of allSlots) {
      if (!introduced.has(slot)) problems.push(`${at} slot "${slot}" is introduced by no beat — it would show before its narration`);
    }
  });

  if (snapshotCount === 0) problems.push('plan has no snapshot segments — a video needs at least one');

  // Coverage: every narration beat must live inside some segment window.
  if (Array.isArray(beats) && beats.length) {
    beats.forEach((d, i) => {
      const mid = (d.start + d.end) / 2;
      const inside = plan.segments.some((s) => isNum(s.start) && isNum(s.end) && mid >= s.start - 0.35 && mid <= s.end + 0.35);
      if (!inside) problems.push(`narration beat ${i + 1} [${d.start}–${d.end}s] "${d.text}" is not covered by any segment`);
    });
  }

  return problems;
}

/** Counts for logs and the plan summary. */
export function summarizeSnapshotPlan(raw) {
  const plan = normalizeSnapshotPlan(raw);
  const snapshots = plan.segments.filter((s) => s.kind === 'snapshot');
  const beats = snapshots.reduce((n, s) => n + s.beats.length, 0);
  return { segments: plan.segments.length, snapshots: snapshots.length, beats };
}
