// diagrams/beats.mjs — default beats for a diagram segment.
//
// A diagram layout declares its build order (title -> nodes -> connectors ->
// emphasis). When the agent does not hand-author beats, the engine distributes
// that order across the narration beats inside the segment. This writes TIMING,
// never content: `spoken` is always the narration's own text.
//
// Explicit agent beats always win — this only fills an empty `beats` array.
import { compileDiagram } from './compile.mjs';

const DRAW = /^(link|flow|trans|rel|edge|connector|handoff|arrow)-/;
const GROW = /^(bar|slice|tile|arc|cell)-/;

function opFor(target) {
  const ids = Array.isArray(target) ? target : [target];
  if (ids.length && ids.every((id) => DRAW.test(id))) return 'draw';
  if (ids.length && ids.every((id) => GROW.test(id))) return 'grow';
  return 'introduce';
}

/** The build order of a diagram segment (orientation-independent slot ids). */
export function diagramBuild(seg, style = null) {
  if (!seg?.diagram?.name) return [];
  try {
    return compileDiagram({
      name: seg.diagram.name,
      spec: seg.diagram.spec ?? {},
      style,
      orientation: 'portrait',
    }).build;
  } catch {
    return [];
  }
}

/**
 * Fill empty diagram beats from narration. Returns a new plan (never mutates).
 * @param {object} plan
 * @param {Array} narrationBeats - from deriveBeats(words)
 * @param {{style?:object}} [opts]
 */
export function synthesizeDiagramBeats(plan, narrationBeats = [], { style = null } = {}) {
  if (!plan || !Array.isArray(plan.segments)) return plan;
  const segments = plan.segments.map((seg) => {
    if (seg?.kind === 'footage' || !seg?.diagram) return seg;
    if (Array.isArray(seg.beats) && seg.beats.length) return seg;

    const groups = diagramBuild(seg, style).filter((g) => Array.isArray(g) && g.length);
    const inside = (narrationBeats ?? []).filter(
      (n) => n && Number.isFinite(n.start) && Number.isFinite(n.end)
        && n.end > seg.start + 0.05 && n.start < seg.end - 0.05,
    );
    if (!groups.length || !inside.length) return seg;

    const beats = inside.map((nb, i) => {
      const base = {
        id: `b${i + 1}`,
        start: Math.round(nb.start * 1000) / 1000,
        end: Math.round(nb.end * 1000) / 1000,
        spoken: nb.text,
      };
      if (i < groups.length) {
        return { ...base, action: { op: opFor(groups[i]), target: groups[i] } };
      }
      return { ...base, action: { op: 'hold' } };
    });

    // More build groups than narration beats: reveal the remainder with the last
    // beat, so every slot is still introduced by something spoken.
    if (groups.length > inside.length) {
      const last = beats[beats.length - 1];
      last.action = { op: 'introduce', target: groups.slice(inside.length).flat() };
    }

    return { ...seg, beats };
  });
  return { ...plan, segments };
}
