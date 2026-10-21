// composition/primitives.mjs — the drawing primitives shared by the snapshot
// recipes: the card surface and the text colour a surface wants, plus `esc`.
//
// Each returns HTML with inline styles resolved from the brand colours, so a
// composition is deterministic and carries no container of its own beyond the
// card it explicitly asks for. (Icon rendering and number formatting now live in
// one place — scene-graph.mjs — and are not duplicated here.)

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Card surfaces. Every significant element sits on one of these (rounded, soft
// shadow). `text` is the colour text on that surface should use.
const SURFACE = {
  blue: { bg: 'var(--brand-blue)', text: 'var(--brand-text)' },
  amber: { bg: 'var(--brand-surface)', text: 'var(--brand-blue)' },
  accent: { bg: 'var(--brand-orange)', text: 'var(--brand-text)' },
  ghost: { bg: 'rgba(255,255,255,0.14)', text: 'var(--brand-text)' },
  ink: { bg: 'rgba(11,18,32,0.55)', text: 'var(--brand-text)' },
};

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
