// icons.mjs — the inline SVG icon set for diagrams.
//
// Geometry is sourced from Tabler Icons (MIT, https://tabler.io/icons) and
// inlined at build time into icons.generated.mjs by tools/build-icons.mjs.
// runtime reads a plain JS object only — no dependency, no network, no fs, so
// rendering stays deterministic and dependency-free.
//
// icons.custom.mjs is the empty fallback seam for a concept Tabler does not
// cover; its keys win when both define the same name. See that file before
// adding anything.
//
// Each entry is a list of path "d" strings on a 24x24 grid. primitives.iconGroup()
// scales and positions them, and they render with `stroke: currentColor`, so CSS
// decides the colour.
import { COMPUTED_ICON_PATHS } from './icons.generated.mjs';
import { CUSTOM_ICON_PATHS } from './icons.custom.mjs';

export const ICON_PATHS = { ...COMPUTED_ICON_PATHS, ...CUSTOM_ICON_PATHS };

export const ICON_NAMES = Object.keys(ICON_PATHS);
