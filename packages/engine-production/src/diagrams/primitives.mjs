// primitives.mjs — the small SVG builders every diagram layout composes with.
//
// A diagram is pure SVG: no HTML boxes, no foreignObject. These functions emit
// the SVG fragments (rect, text, icon, connector, ring) and the geometry a
// layout needs. Layouts decide WHERE things go; primitives decide how to draw
// them. All coordinates are in the SVG viewBox, which equals the real frame box
// in pixels, so the diagram composes against the actual 16:9 or 9:16 box.
import { ICON_PATHS } from './icons.mjs';

export const r3 = (n) => Math.round(n * 1000) / 1000;

export const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** A rounded rectangle in local node coordinates. */
export function rect({ x = 0, y = 0, w, h, r = 0, cls = '' }) {
  return (
    `<rect class="${cls}" x="${r3(x)}" y="${r3(y)}" width="${r3(w)}" height="${r3(h)}" ` +
    `rx="${r3(r)}"/>`
  );
}

/**
 * A multi-line centred or left-anchored text block. `lines` is already wrapped;
 * line spacing is 1.18 of the font size. Size and weight are inline because
 * they are computed per frame box.
 */
export function text({ x, y, cls = '', anchor = 'middle', size = 32, weight = 700, lines = [] }) {
  const spans = lines
    .map((ln, i) => `<tspan x="${r3(x)}" dy="${i === 0 ? 0 : r3(size * 1.18)}">${esc(ln)}</tspan>`)
    .join('');
  return (
    `<text class="${cls}" x="${r3(x)}" y="${r3(y)}" text-anchor="${anchor}" ` +
    `style="font-size:${r3(size)}px;font-weight:${weight}">${spans}</text>`
  );
}

/** An icon drawn from the 24x24 registry, scaled to `size` and placed at x,y (top-left). */
export function iconGroup({ name, x, y, size, cls = 'dg-node-icon' }) {
  const paths = ICON_PATHS[name];
  if (!paths) return '';
  const s = size / 24;
  const body = paths.map((d) => `<path d="${d}"/>`).join('');
  return (
    `<g class="${cls}" transform="translate(${r3(x)} ${r3(y)}) scale(${r3(s)})" fill="none" ` +
    `stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</g>`
  );
}

/**
 * A straight connector with an arrowhead. Returns the path length (used to set
 * the dash so the line can draw itself) and the markup. `markerId` is a
 * placeholder that render.mjs replaces with the overlay's real marker id.
 */
export function connector({ x1, y1, x2, y2, cls = 'dg-line', markerId = '' }) {
  const length = Math.hypot(x2 - x1, y2 - y1);
  const mark = markerId ? ` marker-end="url(#${markerId})"` : '';
  const d = `M${r3(x1)} ${r3(y1)} L${r3(x2)} ${r3(y2)}`;
  const style = `stroke-dasharray:${r3(length)};stroke-dashoffset:${r3(length)}`;
  return { length, markup: `<path class="${cls}" d="${d}"${mark} style="${style}"/>` };
}
