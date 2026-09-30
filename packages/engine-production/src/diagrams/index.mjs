// diagrams/index.mjs — the diagram subsystem's public surface.
export { listDiagrams, getLayout } from './registry.mjs';
export { renderDiagram, validateDiagram, DIAGRAM_CSS } from './render.mjs';
export { deriveTheme } from './theme.mjs';
export { ICON_NAMES } from './icons.mjs';
