// menu.mjs — the menu the model reads before writing a segment plan.
//
// One call returns everything the model is allowed to name: the brand doctrine,
// the segment model (Video -> Segments -> Beats), the snapshot concepts and
// their slots, the beat actions/transitions, the cue rule, the icon vocabulary,
// and the frame modes. The model copies names from here — it cannot invent one.
import { loadStyle, framesFor } from './style.mjs';
import { ICON_NAMES } from './diagrams/icons.mjs';
import { SUGGESTED_ICONS } from './diagrams/icons.suggested.mjs';
import { SNAPSHOT_CONCEPTS, ACTION_OPS, FRAMES, TRANSITIONS, SEGMENT_KINDS } from './composition/snapshot-spec.mjs';
import { listLayouts } from './diagrams/registry.mjs';

export function buildMenu({ style = null, orientation = 'portrait' } = {}) {
  const s = style ?? loadStyle();
  const layout = s.layout ?? {};
  const ori = orientation === 'portrait' ? 'portrait' : 'landscape';
  return {
    brand: s.brand?.name ?? null,
    doctrine: s.doctrine ?? null,
    layout: layout.sizes?.[ori] ?? layout.sizes?.landscape ?? null,
    // Frame modes are kept for the caption/speaker treatment.
    frames: Object.entries(framesFor(s, orientation)).map(([name, f]) => ({ name, mode: f.mode, what: f.what })),
    // The icon vocabulary. Any Tabler outline icon name is valid; `suggested`
    // is a discoverable slice grouped by domain. Icons are what make a data,
    // list, process or relationship frame feel designed — reach for one.
    icons: {
      count: ICON_NAMES.length,
      naming: 'Tabler outline icon names, kebab-case (e.g. "clock", "arrow-right", "currency-dollar")',
      note: 'Use icons generously — give each data point, step, node and list item a relevant icon. Any Tabler outline name is valid; these are common ones.',
      suggested: SUGGESTED_ICONS,
    },
    // The plan model: author a video as Segments (Footage + Snapshots); each
    // snapshot is ONE completed composition, and its beats progressively build
    // it. Design the completed composition first, then say what each beat does.
    plan: {
      model: 'Video -> Segments -> Beats. The video is an ordered list of segments: FOOTAGE (you talking — the face, no visuals) or SNAPSHOT (a b-roll section shown on the orange backdrop, ONE completed composition built by its beats).',
      segmentKinds: SEGMENT_KINDS,
      footage: 'You do not place footage by hand. The engine derives it word-accurately: a snapshot is on screen only while its content builds and shows (from its first body element to its last), and every remaining stretch — a lead-in, a gap between snapshots, the hook, the tail — becomes a footage segment (the face). A gap shorter than the style threshold holds the previous scene instead (seamless b-roll); a snapshot shorter than the snapshot minimum is held longer. The emitted plan lists every footage segment with the narration that plays over it.',
      snapshotConcepts: SNAPSHOT_CONCEPTS,
      // Named diagram layouts: a segment may carry `diagram:{name,spec}` instead
      // of a snapshot concept. The layout owns its fields and slot ids.
      diagrams: listLayouts(),
      beatActions: ACTION_OPS,
      frames: FRAMES,
      transitions: TRANSITIONS,
      slots: {
        note: 'action.target MUST name slots from the snapshot concept\'s list. "0..n" means one per array item (steps, terms, chips, rows, branches, bars). Every slot MUST be introduced by a beat — nothing is on screen before its narration. Numbers shown as figures count up. A non-"hold" beat needs a target; "hold" needs none.',
        'title-steps': ['head', 'headline', 'step-0..n'],
        equation: ['head', 'term-0..n', 'result', 'note'],
        keypoint: ['head', 'text', 'chip-0..n'],
        worksheet: ['head', 'headline', 'header', 'row-0..n'],
        decision: ['head', 'question', 'branch-0..n'],
        bars: ['head', 'headline', 'bar-0..n'],
        quote: ['head', 'struck', 'text'],
        cta: ['head', 'text', 'handle', 'sub'],
      },
      cue: {
        note: 'A beat reveals a slot on the exact words. A figure is cued automatically on the number it shows ("200" reveals when "200" is said). For anything else, set action.cue to the word/phrase the slot should appear on — a string (all of the beat\'s slots) or a map {slot: phrase}. The phrase must be spoken inside that beat; without a cue the slot appears at the beat start.',
        example: '{ "op": "introduce", "target": ["result"], "cue": { "result": "2,500" } }',
      },
      rule: 'Walk the narration in order. Use FOOTAGE for the hook and anywhere the face carries it; use a SNAPSHOT where a structure or a live visual gives more than the face. Every segment covers a run of the narration; segments are ordered, non-overlapping, and cover every narration beat. In a snapshot, design the completed composition first, then give every beat an action (op + target slot(s)) that builds toward it — every slot gets a beat. Consecutive snapshots play back-to-back on the backdrop; footage appears only where you place a footage segment. A snapshot is never the caption text redrawn.',
    },
  };
}
