// plan-builder.mjs — build a plan by calling small functions.
//
// The model should never hand-write plan JSON. It calls these methods; the
// shape is correct every time. savePlan() still validates against the menu.
import { emptyPlan } from './plan.mjs';

export function newPlan() {
  const plan = emptyPlan();
  const builder = {
    /** Stress a few words. */
    caption({ emphasis } = {}) {
      if (Array.isArray(emphasis)) {
        plan.captions.emphasis.push(...emphasis.filter((s) => typeof s === 'string' && s.trim()));
      }
      return builder;
    },
    /** A drawn graphic (button, text box, card). `at` is [start, end] in seconds. */
    graphic({ at, name, fields, why } = {}) {
      plan.overlays.push({ kind: 'graphic', name, fields, why, start: at?.[0], end: at?.[1] });
      return builder;
    },
    /** A composed diagram (flow, ...). `at` is [start, end] in seconds. */
    diagram({ at, name, spec, why } = {}) {
      plan.overlays.push({ kind: 'diagram', name, spec, why, start: at?.[0], end: at?.[1] });
      return builder;
    },
    /** A picture or clip for this video. `at` is [start, end] in seconds. */
    visual({ at, frame = 'full', file, asset, why } = {}) {
      plan.overlays.push({ kind: 'visual', frame, file, asset, why, start: at?.[0], end: at?.[1] });
      return builder;
    },
    /** A camera push. */
    zoom({ at, scale } = {}) {
      plan.zooms.push({ at, scale });
      return builder;
    },
    /** A sound effect. */
    sfx({ at, sound } = {}) {
      plan.sfx.push({ at, sound });
      return builder;
    },
    toJSON() {
      return plan;
    },
  };
  return builder;
}
