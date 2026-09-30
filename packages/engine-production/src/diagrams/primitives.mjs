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

/**
 * A dashed path from raw `d`. Used by curved connectors, cycle arcs and
 * branching elbows. Pass `length` (approximate is fine) to arm the draw so the
 * line can animate itself; the default reads it from `d`'s numbers, which is
 * close enough for arcs. `markerId` is filled in by render.mjs.
 */
export function path({ d, cls = 'dg-line', markerId = '', length = null, dash = true }) {
  const mark = markerId ? ` marker-end="url(#${markerId})"` : '';
  const len = length ?? approxLength(d);
  const style = dash ? ` style="stroke-dasharray:${r3(len)};stroke-dashoffset:${r3(len)}"` : '';
  return { length: len, markup: `<path class="${cls}" d="${d}"${mark}${style}/>` };
}

/** Rough polyline length from the numbers in a path `d` (arcs are approximated). */
export function approxLength(d) {
  const nums = (String(d).match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  let sum = 0;
  for (let i = 0; i + 3 < nums.length; i += 2) {
    sum += Math.hypot(nums[i + 2] - nums[i], nums[i + 3] - nums[i + 1]);
  }
  return Math.max(1, sum);
}

/** A filled or stroked polygon from a list of [x,y] points. */
export function polygon({ points = [], cls = '' }) {
  const pts = points.map(([x, y]) => `${r3(x)},${r3(y)}`).join(' ');
  return `<polygon class="${cls}" points="${pts}"/>`;
}

/** A circle (marker, node, ring). */
export function circle({ cx, cy, r, cls = '' }) {
  return `<circle class="${cls}" cx="${r3(cx)}" cy="${r3(cy)}" r="${r3(r)}"/>`;
}

/** A plain rule (the time axis, a divider). Not animated unless wrapped. */
export function line({ x1, y1, x2, y2, cls = 'dg-axis' }) {
  return `<line class="${cls}" x1="${r3(x1)}" y1="${r3(y1)}" x2="${r3(x2)}" y2="${r3(y2)}"/>`;
}

/** A short tick crossing a point on an axis. */
export function tick({ x, y, len = 14, vertical = false, cls = 'dg-tick' }) {
  return vertical
    ? line({ x1: x - len, y1: y, x2: x + len, y2: y, cls })
    : line({ x1: x, y1: y - len, x2: x, y2: y + len, cls });
}

/**
 * Wrap a label to at most `maxLines` at a character budget (no DOM measurement).
 * Shared by the layouts; Flow keeps its own copy.
 */
export function wrap(label, maxChars, maxLines = 2) {
  const words = String(label).trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (!cur || next.length <= maxChars) cur = next;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) lines.splice(maxLines - 1, lines.length - 1, lines.slice(maxLines - 1).join(' '));
  return lines;
}

