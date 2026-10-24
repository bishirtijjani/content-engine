// diagrams/compile.mjs — a diagram spec becomes a scene graph.
//
// This is the whole native bridge: layouts compute geometry in design pixels,
// the compiler turns it into the one node tree the renderer already accepts.
// Stills, video, slots and motion therefore need no diagram-specific path.
import { getLayout } from './registry.mjs';
import { frameBox } from './frame.mjs';
import { primitives } from './primitives.mjs';
import { deriveTheme } from './theme.mjs';

/** Validate one layout spec. Returns a list of plain problems (empty = good). */
export function validateDiagramSpec(name, spec) {
  const layout = getLayout(name);
  if (!layout) return [`unknown diagram layout "${name}"`];
  try {
    return layout.validate(spec ?? {}) ?? [];
  } catch (err) {
    return [`diagram "${name}" validation crashed: ${err.message}`];
  }
}

/** The orientation-independent slot ids of a diagram. */
export function diagramSlots(name, spec) {
  const layout = getLayout(name);
  if (!layout || typeof layout.slots !== 'function') return [];
  try {
    return layout.slots(spec ?? {}) ?? [];
  } catch {
    return [];
  }
}

/**
 * Compile a diagram to the scene-graph format.
 * @param {{name:string, spec:object, style?:object, orientation?:'portrait'|'landscape'}} opts
 * @returns {{sceneGraph:object, slots:string[], build:string[][], layout:object}}
 */
export function compileDiagram({ name, spec, style = null, orientation = 'portrait' }) {
  const layout = getLayout(name);
  if (!layout) throw new Error(`unknown diagram layout "${name}"`);

  const problems = validateDiagramSpec(name, spec);
  if (problems.length) {
    throw new Error(`diagram "${name}" is invalid:\n - ${problems.join('\n - ')}`);
  }

  const frame = frameBox(style, orientation);
  const ctx = { ...frame, style, orientation, theme: deriveTheme(style) };
  const primitivesApi = primitives(ctx);
  const built = layout.build(spec ?? {}, ctx, primitivesApi) ?? {};
  const nodes = Array.isArray(built.nodes) ? built.nodes : [];

  const sceneGraph = {
    scene: {
      id: spec?.id ?? name,
      orientation: 'full',
      duration: Number(spec?.duration) || 6,
    },
    nodes: [
      {
        id: 'root',
        type: 'group',
        layout: { x: 0, y: 0, w: 1, h: 1 },
        children: nodes,
      },
    ],
    animations: [],
    transitions: { technique: 'crossfade' },
  };

  return {
    sceneGraph,
    slots: diagramSlots(name, spec),
    build: Array.isArray(built.build) ? built.build : [],
    layout,
  };
}
