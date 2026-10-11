// composition/layout.mjs — the geometry a composition is placed into.
//
// This is the layout half of the composition language: where a visual may live
// (the safe box), how type scales (the video type scale), and how a proportional
// element (a dot grid, a bar) is sized to its box. It holds no opinion about any
// one concept — it is the shared geometry concepts are laid out with.
//
// Coordinates: `safeBox` returns CANVAS pixels (for positioning the stage
// element). Everything inside the stage uses stage-local pixels (0..w, 0..h).

const r3 = (n) => Math.round(n * 1000) / 1000;

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

/** Resolve the video type scale to pixel sizes for this canvas width. */
export function typeScale(style, width) {
  const t = style?.composition?.type ?? {};
  const out = {};
  for (const [role, def] of Object.entries(t)) {
    out[role] = { ...def, size: Math.max(10, Math.round(width * (def.ratio ?? 0.03))) };
  }
  return out;
}

/**
 * Size a `count`-cell grid that fits a box, keeping cells square. `gap` is a
 * fraction of the cell. `maxCell` caps the cell so a small count does not blow
 * up to fill the box. Returns stage-local geometry.
 */
export function dotGridGeometry({ count, cols = 8, box, gap = 0.42, maxCell = Infinity }) {
  const rows = Math.ceil(count / cols);
  const cellByW = box.w / (cols + (cols - 1) * gap);
  const cellByH = box.h / (rows + (rows - 1) * gap);
  const cell = Math.max(2, Math.min(cellByW, cellByH, maxCell));
  const g = cell * gap;
  const gridW = cols * cell + (cols - 1) * g;
  const gridH = rows * cell + (rows - 1) * g;
  return {
    cols, rows, count,
    cell: r3(cell), gap: r3(g),
    width: r3(gridW), height: r3(gridH),
    x: r3((box.w - gridW) / 2),
    y: r3((box.h - gridH) / 2),
  };
}

/** Stage-local centre X. */
export function centerX(box) {
  return r3(box.w / 2);
}

export { r3 };
