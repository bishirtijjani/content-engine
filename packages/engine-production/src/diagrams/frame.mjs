// diagrams/frame.mjs — the canvas and the safe box every layout draws inside.
//
// The safe box comes from composition.zones.safe in the locked style: its bottom
// edge is the caption keep-out line, so a diagram never enters the caption band.
import { loadStyle } from '../style.mjs';

export function designCanvas(orientation = 'portrait') {
  return orientation === 'landscape' ? { W: 1920, H: 1080 } : { W: 1080, H: 1920 };
}

/**
 * The safe box in design pixels, plus the canvas size and orientation flag.
 * @param {Object} [style]
 * @param {'portrait'|'landscape'} [orientation]
 */
export function frameBox(style = null, orientation = 'portrait') {
  const s = style ?? loadStyle();
  const c = s?.composition?.zones?.safe ?? { top: 0.10, bottom: 0.34, left: 0.06, right: 0.06 };
  const { W, H } = designCanvas(orientation);
  const left = Number(c.left ?? 0.06);
  const right = Number(c.right ?? 0.06);
  const top = Number(c.top ?? 0.10);
  const bottom = Number(c.bottom ?? 0.34);
  return {
    W,
    H,
    orientation,
    landscape: orientation === 'landscape',
    x: left * W,
    y: top * H,
    w: (1 - left - right) * W,
    h: (1 - top - bottom) * H,
  };
}
