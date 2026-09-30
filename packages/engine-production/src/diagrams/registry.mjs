// registry.mjs — the diagram layouts, in one synchronous map.
//
// Static imports (no dynamic import / readdir) so menu() and validatePlan()
// stay synchronous and deterministic. Add a layout by importing it and adding
// it to LAYOUTS.
import flow from './layouts/flow.mjs';

const LAYOUTS = { flow };

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
