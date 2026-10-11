// composition/primitives.mjs — the drawing primitives.
//
// The minimum the hero-number frame needs, and nothing more: a type block, a
// data (figure + unit) block, a dot grid, and a hairline rule. Each returns HTML
// with inline styles resolved from the type scale and the brand colours, so a
// frame is deterministic and carries no container/card of its own — content sits
// directly on the canvas.

import { ICON_PATHS } from '../diagrams/icons.mjs';

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const FONT_VAR = {
  display: 'var(--brand-display)',
  body: 'var(--brand-body)',
  mono: 'var(--brand-mono)',
};

// Colour roles → brand values.
const COLOR = {
  text: 'var(--brand-text)',
  brand: 'var(--brand-blue)',
  accent: 'var(--brand-orange)',
  'accent-soft': 'var(--brand-accent-soft)',
};

// Card surfaces. Every significant element sits on one of these (rounded, soft
// shadow). `text` is the colour text on that surface should use.
const SURFACE = {
  blue: { bg: 'var(--brand-blue)', text: 'var(--brand-text)' },
  amber: { bg: 'var(--brand-surface)', text: 'var(--brand-blue)' },
  accent: { bg: 'var(--brand-orange)', text: 'var(--brand-text)' },
  ghost: { bg: 'rgba(255,255,255,0.14)', text: 'var(--brand-text)' },
  ink: { bg: 'rgba(11,18,32,0.55)', text: 'var(--brand-text)' },
};

/** Format a data value the way a viewer expects to read it. */
export function formatValue(value, format = 'int') {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value ?? '');
  const grouped = n.toLocaleString('en-US');
  switch (format) {
    case 'currency': return `$${grouped}`;
    case 'percent': return `${grouped}%`;
    case 'decimal': return String(n);
    default: return grouped;
  }
}

/** A typographic block (kicker / headline / label / footnote / unit). */
export function textBlock(node, scale) {
  const r = scale[node.role] ?? scale.label ?? { size: 32, weight: 600, font: 'body' };
  const color = COLOR[r.color] ?? COLOR.text;
  const caps = r.caps ? 'text-transform:uppercase;' : '';
  const tracking = r.tracking != null ? `letter-spacing:${r.tracking}em;` : '';
  const opacity = r.opacity != null ? `opacity:${r.opacity};` : '';
  const lh = r.lineHeight ?? 1.2;
  return (
    `<div class="cx-text cx-${node.role}" style="font-family:${FONT_VAR[r.font] ?? FONT_VAR.body};` +
    `font-weight:${r.weight ?? 600};font-size:${r.size}px;line-height:${lh};color:${color};` +
    `${caps}${tracking}${opacity}">${esc(node.text)}</div>`
  );
}

/** A figure ("40"). The unit is placed by the recipe, never inline here. */
export function dataBlock(node, scale) {
  const r = scale.data ?? { size: 360, weight: 800, font: 'mono', lineHeight: 1, tracking: -0.04 };
  const color = COLOR[r.color] ?? COLOR.text;
  return (
    `<div class="cx-fig" style="display:flex;align-items:baseline;` +
    `font-family:${FONT_VAR[r.font] ?? FONT_VAR.mono};font-weight:${r.weight};font-size:${r.size}px;` +
    `line-height:${r.lineHeight ?? 1};letter-spacing:${r.tracking ?? -0.04}em;color:${color};` +
    `text-shadow:0 18px 60px rgba(0,0,0,.45)">` +
    `<span class="cx-num">${esc(formatValue(node.value, node.format))}</span></div>`
  );
}

/**
 * An inline icon from the Tabler set (the same registry the diagrams use). Emits
 * a self-contained 24x24 SVG, stroked with `currentColor` so the brand colour is
 * set from the resolved role. An unknown name throws — never silently blank.
 */
export function iconBlock(node, scale, { size, tone } = {}) {
  const name = node?.name;
  const paths = ICON_PATHS[name];
  if (!paths) throw new Error(`unknown icon "${name}" — not in the Tabler set (check spelling / kebab-case)`);
  const r = scale?.icon ?? { size: 64, stroke: 2, color: 'text' };
  const px = Math.round(size ?? node.size ?? r.size ?? 64);
  const sw = node.stroke ?? r.stroke ?? 2;
  const color = COLOR[tone ?? node.color ?? r.color] ?? COLOR.text;
  const opacity = node.opacity ?? r.opacity ?? 1;
  const body = paths.map((d) => `<path d="${esc(d)}"/>`).join('');
  return (
    `<svg class="cx-icon" viewBox="0 0 24 24" width="${px}" height="${px}" fill="none" ` +
    `stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" ` +
    `style="color:${color};opacity:${opacity};display:block" aria-hidden="true">${body}</svg>`
  );
}

/** A grid of `count` cells — the proportional weight for a figure. */
export function dotGridBlock(node, geo, { tone = 'var(--brand-dot, rgba(255,255,255,0.92))' } = {}) {
  const dots = Array.from({ length: geo.count }, () => '<i class="cx-dot"></i>').join('');
  return (
    `<div class="cx-grid" style="display:grid;grid-template-columns:repeat(${geo.cols},${geo.cell}px);` +
    `gap:${geo.gap}px;justify-content:center">${dots}</div>`
  );
}

/** A proportional bar: a track with a fill to `value / max`. */
export function barBlock(node, { width, height = 26, tone = 'var(--brand-accent-soft)' } = {}) {
  const pct = Math.max(0, Math.min(1, Number(node.value) / Number(node.max))) * 100;
  const r = Math.round(height / 2);
  return (
    `<div class="cx-bar" style="width:${width}px;height:${height}px;border-radius:${r}px;` +
    `background:rgba(255,255,255,0.16);overflow:hidden">` +
    `<div class="cx-bar-fill" style="width:${pct.toFixed(1)}%;height:100%;background:${tone};border-radius:${r}px"></div></div>`
  );
}

/** A hairline rule. */
export function ruleBlock({ width = 80, tone = 'var(--brand-orange)' } = {}) {
  return `<div class="cx-rule" style="width:${width}px;height:4px;background:${tone};border-radius:2px"></div>`;
}

/** The text colour a given surface tone wants. */
export function surfaceText(tone = 'blue') {
  return (SURFACE[tone] ?? SURFACE.blue).text;
}

/**
 * A card: the rounded surface every significant element sits on. `inner` is the
 * element's HTML; the card supplies the brand surface, radius, padding and a soft
 * shadow. Tone picks the surface (blue default, amber for emphasis).
 */
export function cardBlock(inner, { tone = 'blue', radius = 40, padX = 48, padY = 36, className = '', style = '', slot = null } = {}) {
  const s = SURFACE[tone] ?? SURFACE.blue;
  return (
    `<div class="cx-card cx-card-${tone}${className ? ` ${className}` : ''}"` +
    `${slot ? ` data-slot="${esc(slot)}"` : ''} ` +
    `style="background:${s.bg};border-radius:${radius}px;padding:${padY}px ${padX}px;` +
    `box-shadow:0 26px 64px rgba(0,0,0,.30);${style}">${inner}</div>`
  );
}

export { esc };
