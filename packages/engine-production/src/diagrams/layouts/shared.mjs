// layouts/shared.mjs — small helpers the shape-specific layouts share.
//
// Not a framework: a few functions that were genuinely reused across the new
// layouts (a card renderer, an SVG wrapper, a geometry header for the frame
// box). Flow does not import this — it keeps its own code untouched.
import { rect, text, iconGroup, r3 } from '../primitives.mjs';

export const LANDSCAPE_RATIO = 1.15;

/** The common geometry header: orientation, margins, title block, usable box. */
export function frameBox(spec, box) {
  const w = box.w;
  const h = box.h;
  const landscape = w / h >= LANDSCAPE_RATIO;
  const hasTitle = typeof spec.title === 'string' && spec.title.trim().length > 0;
  const mx = w * 0.06;
  const my = h * 0.05;
  const titleH = h * (landscape ? 0.15 : 0.11);
  const titleSize = Math.max(16, Math.min(titleH * 0.6, w * 0.05));
  return {
    w, h, landscape, hasTitle, mx, my, titleH, titleSize,
    usableW: w - 2 * mx,
    usableH: h - (hasTitle ? titleH : 0) - 2 * my,
    top: hasTitle ? titleH : 0,
    title: hasTitle
      ? { text: spec.title.trim(), x: w / 2, y: my + titleSize, size: titleSize }
      : null,
  };
}

/** The SVG element wrapper with the overlay's arrow marker. Returns [markup, arrowId]. */
export function svgOpen(w, h, ovId, extraDefs = '') {
  const arrowId = `dg-${ovId}-arrow`;
  const marker =
    `<marker id="${arrowId}" viewBox="0 0 10 10" refX="7.5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">` +
    `<path class="dg-arrow" d="M0 0 10 5 0 10Z"/></marker>`;
  const markup =
    `<svg class="dg-svg" viewBox="0 0 ${r3(w)} ${r3(h)}" preserveAspectRatio="xMidYMid meet" ` +
    `xmlns="http://www.w3.org/2000/svg"><defs>${marker}${extraDefs}</defs><g class="dg-root">`;
  return [markup, arrowId];
}

export const svgClose = '</g></svg>';

/** The title text, or ''. */
export function titleText(geo) {
  if (!geo.title) return '';
  return text({
    x: geo.title.x, y: geo.title.y, cls: 'dg-title', anchor: 'middle',
    size: geo.title.size, weight: 800, lines: [geo.title.text],
  });
}

/**
 * A card: rounded bg + optional ring + optional icon + a label block. Placed by
 * translate(x,y); animated by the caller via a `.dg-node-anim` node id.
 * `lines` is already wrapped. `layout` picks icon-above (center) or icon-left.
 */
export function card({
  x, y, w, h, r = 18, index = 0, lines = [], labelSize = 28,
  icon = null, iconSize = 34, layout = 'center', active = false,
  bg = 'dg-node-bg', labelCls = 'dg-node-label', animCls = 'dg-node-anim',
}) {
  const bgRect = rect({ w, h, r, cls: bg });
  const ring = active ? rect({ w, h, r, cls: 'dg-node-ring' }) : '';
  let ic = '';
  let labelX;
  let labelY;
  let anchor;
  let blockH = lines.length * labelSize * 1.18;

  if (icon && layout === 'left') {
    ic = iconGroup({ name: icon, x: h * 0.28, y: (h - Math.min(iconSize, h * 0.5)) / 2, size: Math.min(iconSize, h * 0.5) });
    labelX = h * 0.28 + Math.min(iconSize, h * 0.5) + h * 0.3;
    labelY = h / 2 - blockH / 2 + labelSize * 0.85;
    anchor = 'start';
  } else if (icon && layout === 'above') {
    const isz = Math.min(iconSize, w * 0.34, h * 0.3);
    ic = iconGroup({ name: icon, x: (w - isz) / 2, y: h * 0.14, size: isz });
    labelX = w / 2;
    labelY = h * (lines.length > 1 ? 0.52 : 0.6) + labelSize * 0.7;
    anchor = 'middle';
  } else {
    labelX = w / 2;
    labelY = h / 2 - blockH / 2 + labelSize * 0.85;
    anchor = 'middle';
  }

  const label = text({
    x: labelX, y: labelY, cls: labelCls, anchor, size: labelSize, weight: 600, lines,
  });
  return (
    `<g class="dg-node dg-node-${index}" transform="translate(${r3(x)} ${r3(y)})">` +
    `<g class="${animCls}">${bgRect}${ring}${ic}${label}</g></g>`
  );
}

/** Fit a label size so the tallest wrapped block fits inside `h`. */
export function fitLabel(labels, { w, h, base = 40, ratio = 0.56, floor = 12, budget = 0.88 }) {
  let size = base;
  let chars = Math.max(6, Math.floor((w * budget) / (size * ratio)));
  let maxLines = 1;
  for (const l of labels) maxLines = Math.max(maxLines, wrapCount(l, chars));
  if (maxLines > 1) size = Math.max(floor, base * (0.72 / maxLines) * 2);
  chars = Math.max(6, Math.floor((w * budget) / (size * ratio)));
  return { size, chars };
}

function wrapCount(label, maxChars) {
  const words = String(label).trim().split(/\s+/).filter(Boolean);
  let lines = 1;
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (!cur || next.length <= maxChars) cur = next;
    else { lines++; cur = w; }
  }
  return lines;
}
