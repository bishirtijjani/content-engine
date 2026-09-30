// menu.mjs — the menu the model reads before writing a plan.
//
// One call returns everything the model is allowed to name: the frames, the
// templates (with their fields and frame), the visuals available, and the
// sounds. The model copies names from here. It cannot invent one — validation
// refuses anything not on the menu.
import { loadStyle } from './style.mjs';
import { listTemplates } from './templates.mjs';
import { loadCatalog } from './library.mjs';
import { listDiagrams } from './diagrams/registry.mjs';

export function buildMenu({ style = null, catalog = null } = {}) {
  const s = style ?? loadStyle();
  const cat = catalog ?? loadCatalog();
  return {
    frames: Object.entries(s.frames ?? {}).map(([name, f]) => ({ name, mode: f.mode, what: f.what })),
    templates: listTemplates().map((t) => ({ name: t.name, what: t.description, frame: t.frame, fields: t.fields })),
    diagrams: listDiagrams(),
    visuals: (cat.visuals ?? []).map((v) => ({ file: v.file, what: v.description })),
    sfx: (cat.sfx ?? []).map((x) => ({ id: x.id, what: x.description })),
    cues: Object.keys(s.sfx?.cues ?? {}),
    doctrine: s.doctrine ?? null,
  };
}
