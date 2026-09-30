// icons.custom.mjs — the custom-icon fallback.
//
// Tabler (MIT) covers every icon the diagram system currently uses. This file
// exists only as the seam for a concept Tabler genuinely does not cover. It is
// empty on purpose: do not add an icon here unless a real diagram needs one and
// no Tabler icon fits.
//
// Contract for any entry (must match the generated set so iconGroup() draws it
// with no special casing):
//   - a list of SVG path "d" strings on a 24x24 grid
//   - stroke geometry only (the wrapper is stroke=currentColor, fill=none,
//     stroke-width 2, round caps/joins — emitted by primitives.iconGroup())
//   - a comment naming why Tabler did not fit
//
// These keys win over the generated Tabler keys when both define the same name.
export const CUSTOM_ICON_PATHS = {};
