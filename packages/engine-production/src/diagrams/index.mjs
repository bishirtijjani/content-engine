// diagrams/index.mjs — the diagram subsystem's public surface.
export { getLayout, listLayouts, layoutNames } from './registry.mjs';
export { compileDiagram, validateDiagramSpec, diagramSlots } from './compile.mjs';
export { deriveTheme } from './theme.mjs';
export { frameBox, designCanvas } from './frame.mjs';
export { primitives, TONES, wrapChars } from './primitives.mjs';
