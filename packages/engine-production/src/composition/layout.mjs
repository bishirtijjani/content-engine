// composition/layout.mjs — the geometry a composition is placed into.
//
// The layout half of the composition language: where a visual may live (the safe
// box). It holds no opinion about any one concept — it is the shared geometry
// concepts are laid out with.
//
// Coordinates: `safeBox` returns CANVAS pixels (for positioning the stage
// element). Everything inside the stage uses stage-local pixels (0..w, 0..h).

/** The area a visual may occupy (its bottom is the caption keep-out line). */
export function safeBox(style, { width, height, orientation = 'portrait' }) {
  const c = style?.composition?.zones?.safe ?? { top: 0.1, bottom: 0.66, left: 0.06, right: 0.06 };
  return {
    x: Math.round(c.left * width),
    y: Math.round(c.top * height),
    w: Math.round((1 - c.left - c.right) * width),
    h: Math.round((1 - c.top - c.bottom) * height),
  };
}
