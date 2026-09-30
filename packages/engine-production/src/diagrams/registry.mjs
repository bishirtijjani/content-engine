// registry.mjs — the diagram layouts, in one synchronous map.
//
// Static imports (no dynamic import / readdir) so menu() and validatePlan()
// stay synchronous and deterministic. Add a layout by importing it and adding
// it to LAYOUTS.
import flow from './layouts/flow.mjs';
import pipeline from './layouts/pipeline.mjs';
import cycle from './layouts/cycle.mjs';
import timeline from './layouts/timeline.mjs';
import beforeAfter from './layouts/before-after.mjs';
import comparison from './layouts/comparison.mjs';
import decision from './layouts/decision.mjs';
import hierarchy from './layouts/hierarchy.mjs';
import architecture from './layouts/architecture.mjs';
import relationship from './layouts/relationship.mjs';
import layers from './layouts/layers.mjs';
import funnel from './layouts/funnel.mjs';

const LAYOUTS = {
  flow,
  pipeline,
  cycle,
  timeline,
  'before-after': beforeAfter,
  comparison,
  decision,
  hierarchy,
  architecture,
  relationship,
  layers,
  funnel,
};

/** The full layout descriptor, or null. */
export function getLayout(name) {
  return Object.prototype.hasOwnProperty.call(LAYOUTS, name) ? LAYOUTS[name] : null;
}

/** The menu summary of every layout (name, what it draws, its frame, its inputs). */
export function listDiagrams() {
  return Object.values(LAYOUTS).map((d) => ({
    name: d.name,
    what: d.description,
    frame: d.frame,
    steps: d.steps,
    fields: d.fields,
  }));
}
