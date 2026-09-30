// plan.mjs — the shape of the agent-written production plan, and the gate that
// refuses anything off-style.
//
// The engine never invents what happens in a video. The agent writes a plan:
// which words to stress, which visuals and graphics to show and when, where the
// camera pushes in, which sound effects fire. This module defines that shape
// and checks it against the locked style. If the plan fails, nothing renders.
//
// Doctrine (config/style.json): everything on screen must earn its place. Every
// overlay carries a one-line `why`; a missing or empty reason is refused.
//
// Plan shape (all fields optional — an empty plan is a plain captioned video):
//
//   {
//     "captions": { "emphasis": ["automated", "30 seconds"] },
//     "overlays": [
//       { "start": 12, "end": 18, "kind": "graphic", "name": "stat-callout",
//         "why": "show the hours saved", "fields": { "value": "8 hrs", "label": "saved per week" } },
//       { "start": 30, "end": 36, "kind": "visual", "file": "data/visuals/demo/dashboard.png",
//         "why": "show the real dashboard" }
//     ],
//     "zooms": [ { "at": 12, "scale": 1.15 } ],
//     "sfx":   [ { "at": 12, "sound": "sfx/whoosh" } ] }
//   }
//
// A `visual` points at a file you drop in for that video (`file`), so each video
// carries its own pictures. A reusable id from the library (`asset`) still works.
import { loadStyle } from './style.mjs';
import { getLayout } from './diagrams/registry.mjs';
import { validateDiagram } from './diagrams/render.mjs';

// Three kinds: a `visual` is a file you supply (screenshot, screen recording,
// your own video); a `graphic` is a template we draw (card); a `diagram` is a
// composed SVG layout (flow, ...).
export const OVERLAY_KINDS = ['visual', 'graphic', 'diagram'];
export const MIN_OVERLAY_SECONDS = 0.6;

// The four slots every overlay snaps into. A visual picks one; a graphic gets
// its frame from the template.
export const FRAMES = ['full', 'center', 'left', 'right'];
export const DEFAULT_VISUAL_FRAME = 'full';

// Reasons that mean nothing — refuse them.
const WHY_FILLER = new Set([
  'looks nice', 'nice', 'cool', 'aesthetic', 'decoration', 'decorative', 'filler',
  'to look good', 'vibes', 'for fun', 'for no reason', 'n/a', 'none', 'just because',
]);

/** A plan with nothing in it — a plain captioned video. */
export function emptyPlan() {
  return { captions: { emphasis: [] }, overlays: [], zooms: [], sfx: [] };
}

/** Parse a stored plan. Throws a plain error if the text is not JSON. */
export function parsePlan(text) {
  if (text === null || text === undefined || text === '') return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`plan is not valid JSON: ${e.message}`);
  }
}

/** Fill in missing fields so the rest of the engine can assume the shape. */
export function normalizePlan(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const emphasis = Array.isArray(p.captions?.emphasis)
    ? p.captions.emphasis.filter((s) => typeof s === 'string' && s.trim())
    : [];
  return {
    captions: { emphasis },
    overlays: Array.isArray(p.overlays) ? p.overlays : [],
    zooms: Array.isArray(p.zooms) ? p.zooms : [],
    sfx: Array.isArray(p.sfx) ? p.sfx : [],
  };
}

/** Counts for logs and plain-talk summaries. */
export function summarizePlan(plan) {
  const p = normalizePlan(plan);
  return {
    emphasis: p.captions.emphasis.length,
    overlays: p.overlays.length,
    zooms: p.zooms.length,
    sfx: p.sfx.length,
  };
}

const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
const has = (list, id) => {
  if (!list) return true; // no catalog supplied — skip existence checks
  const arr = Array.isArray(list) ? list : [...list];
  return arr.includes(id);
};

/**
 * Check a plan against the locked style and the media library.
 *
 * @param {Object} rawPlan - the agent-written plan
 * @param {Object} [opts]
 * @param {number} [opts.duration] - total video length in seconds (enables timing checks)
 * @param {Object} [opts.style] - the locked style (defaults to config/style.json)
 * @param {Object} [opts.catalog] - { templates, visuals, sfx } ids available to reference
 * @returns {string[]} problems — empty means the plan is good to build
 */
export function validatePlan(rawPlan, { duration = null, style = null, catalog = null, hookSeconds = null } = {}) {
  const problems = [];
  const s = style ?? loadStyle();
  const hookKeep = isNum(hookSeconds) ? hookSeconds : (s?.doctrine?.hook?.keepFaceSeconds ?? 0);

  if (!rawPlan || typeof rawPlan !== 'object' || Array.isArray(rawPlan)) {
    return ['plan must be an object'];
  }

  const plan = normalizePlan(rawPlan);
  const hasDuration = isNum(duration) && duration > 0;
  const frameNames = Object.keys(s?.frames ?? {});
  const validFrames = frameNames.length ? frameNames : FRAMES;

  // ---- captions.emphasis ---------------------------------------------------
  if (rawPlan.captions && rawPlan.captions.emphasis !== undefined && !Array.isArray(rawPlan.captions.emphasis)) {
    problems.push('captions.emphasis must be a list of words');
  }
  plan.captions.emphasis.forEach((w, i) => {
    if (typeof w !== 'string' || !w.trim()) {
      problems.push(`captions.emphasis[${i}] must be a non-empty word`);
    }
  });

  // ---- overlays ------------------------------------------------------------
  const placed = [];
  plan.overlays.forEach((o, i) => {
    const at = `overlays[${i}]`;
    if (!o || typeof o !== 'object') {
      problems.push(`${at} must be an object`);
      return;
    }
    if (!OVERLAY_KINDS.includes(o.kind)) {
      problems.push(`${at}.kind must be one of ${OVERLAY_KINDS.join(', ')}`);
    }

    // Doctrine: every on-screen element must state its purpose in one sentence.
    const why = typeof o.why === 'string' ? o.why.trim() : '';
    if (!why) {
      problems.push(`${at} needs a "why" — one plain sentence saying what it adds on screen`);
    } else if (WHY_FILLER.has(why.toLowerCase())) {
      problems.push(`${at}.why "${why}" says nothing — give it a real purpose or cut it`);
    }

    if (!isNum(o.start) || !isNum(o.end)) {
      problems.push(`${at} needs numeric start and end`);
    } else {
      if (o.start < 0) problems.push(`${at}.start cannot be negative`);
      if (o.end <= o.start) problems.push(`${at}.end must be after start`);
      if (o.end - o.start < MIN_OVERLAY_SECONDS) {
        problems.push(`${at} is shorter than ${MIN_OVERLAY_SECONDS}s — give it room to be read`);
      }
      if (hasDuration && o.end > duration + 0.001) {
        problems.push(`${at}.end (${o.end}s) is past the end of the video (${duration}s)`);
      }
      placed.push({ i, start: o.start, end: o.end });

      // Doctrine: the hook always shows the speaker. No takeover (full/center)
      // before the first sentence lands; a split (left/right) keeps the face on.
      if (hookKeep > 0 && o.start < hookKeep) {
        let overlayFrame;
        if (o.kind === 'graphic') overlayFrame = catalog?.templateIndex?.[o.name]?.frame;
        else if (o.kind === 'diagram') {
          overlayFrame = catalog?.diagramIndex?.[o.name]?.frame ?? getLayout(o.name)?.frame;
        } else overlayFrame = o.frame ?? DEFAULT_VISUAL_FRAME;
        const overlayMode = overlayFrame ? s?.frames?.[overlayFrame]?.mode : null;
        if (overlayMode === 'takeover') {
          problems.push(`${at} takes over the screen at ${o.start}s — the first ${hookKeep}s always show you talking to camera, never a b-roll (a split frame is fine)`);
        }
      }
    }

    if (o.kind === 'graphic') {
      if (typeof o.name !== 'string' || !o.name.trim()) {
        problems.push(`${at} needs a graphic name`);
      } else if (!has(catalog?.templates, o.name)) {
        problems.push(`${at} uses graphic "${o.name}" which is not in the library`);
      }
      if (o.fields !== undefined && (typeof o.fields !== 'object' || Array.isArray(o.fields))) {
        problems.push(`${at}.fields must be an object of fill-in values`);
      } else if (o.fields) {
        const allowed = catalog?.templateIndex?.[o.name]?.fields;
        if (Array.isArray(allowed)) {
          for (const key of Object.keys(o.fields)) {
            if (!allowed.includes(key)) {
              problems.push(`${at}.fields has "${key}" which "${o.name}" does not take (it takes: ${allowed.join(', ')})`);
            }
          }
        }
      }
    } else if (o.kind === 'visual') {
      const file = typeof o.file === 'string' ? o.file.trim() : '';
      const asset = typeof o.asset === 'string' ? o.asset.trim() : '';
      if (!file && !asset) {
        problems.push(`${at} needs a "file" — the path to that video's picture or clip`);
      } else if (asset && !has(catalog?.visuals, asset)) {
        problems.push(`${at} uses visual "${asset}" which is not in the library`);
      }
      const frame = o.frame ?? DEFAULT_VISUAL_FRAME;
      if (!validFrames.includes(frame)) {
        problems.push(`${at}.frame must be one of ${validFrames.join(', ')}`);
      }
    } else if (o.kind === 'diagram') {
      if (typeof o.name !== 'string' || !o.name.trim()) {
        problems.push(`${at} needs a diagram name`);
      } else if (!has(catalog?.diagrams, o.name)) {
        problems.push(`${at} uses diagram "${o.name}" which is not in the library`);
      } else {
        const layout = catalog?.diagramIndex?.[o.name]?.descriptor ?? getLayout(o.name);
        const overDur = isNum(o.start) && isNum(o.end) ? o.end - o.start : null;
        for (const p of validateDiagram(o.spec, layout, { duration: overDur })) {
          problems.push(`${at}: ${p}`);
        }
      }
    }
  });

  // no two overlays on screen at once
  placed.sort((a, b) => a.start - b.start);
  for (let k = 1; k < placed.length; k++) {
    if (placed[k].start < placed[k - 1].end - 0.001) {
      problems.push(
        `overlays[${placed[k].i}] overlaps overlays[${placed[k - 1].i}] ` +
        `(${placed[k].start}s starts before ${placed[k - 1].end}s ends)`
      );
    }
  }

  // ---- zooms ---------------------------------------------------------------
  const zMin = s?.motion?.zoom?.min ?? 1.0;
  const zMax = s?.motion?.zoom?.max ?? 1.25;
  plan.zooms.forEach((z, i) => {
    const at = `zooms[${i}]`;
    if (!z || typeof z !== 'object') { problems.push(`${at} must be an object`); return; }
    if (!isNum(z.at)) problems.push(`${at}.at must be a number`);
    else if (hasDuration && (z.at < 0 || z.at > duration + 0.001)) {
      problems.push(`${at}.at (${z.at}s) is outside the video`);
    }
    if (!isNum(z.scale)) problems.push(`${at}.scale must be a number`);
    else if (z.scale < zMin || z.scale > zMax) {
      problems.push(`${at}.scale ${z.scale} is outside the style range ${zMin}–${zMax}`);
    }
  });
  if (hasDuration) {
    const perMinute = s?.motion?.maxZoomsPerMinute ?? 4;
    const allowed = Math.max(1, Math.ceil((duration / 60) * perMinute));
    if (plan.zooms.length > allowed) {
      problems.push(`too many zooms (${plan.zooms.length}) — the style allows ${allowed} for a ${Math.round(duration)}s video`);
    }
  }

  // ---- sfx -----------------------------------------------------------------
  // A sound may be named by its cue name (`whoosh`), by the cue's asset id, or
  // by a library id. The plan uses cue names; the other two keep older plans valid.
  const cueNames = Object.keys(s?.sfx?.cues ?? {});
  const cueIds = Object.values(s?.sfx?.cues ?? {});
  plan.sfx.forEach((x, i) => {
    const at = `sfx[${i}]`;
    if (!x || typeof x !== 'object') { problems.push(`${at} must be an object`); return; }
    if (!isNum(x.at)) problems.push(`${at}.at must be a number`);
    else if (hasDuration && (x.at < 0 || x.at > duration + 0.001)) {
      problems.push(`${at}.at (${x.at}s) is outside the video`);
    }
    if (typeof x.sound !== 'string' || !x.sound.trim()) {
      problems.push(`${at}.sound must be a sound id`);
    } else if (!cueNames.includes(x.sound) && !cueIds.includes(x.sound) && !has(catalog?.sfx, x.sound)) {
      problems.push(`${at}.sound "${x.sound}" is not in the library`);
    }
  });

  return problems;
}

/** Convenience: validate a stored plan string. Throws on bad JSON. */
export function validatePlanJSON(text, opts) {
  const plan = parsePlan(text);
  if (plan === null) return ['no plan written yet'];
  return validatePlan(plan, opts);
}
