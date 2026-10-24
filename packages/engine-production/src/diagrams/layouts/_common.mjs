// diagrams/layouts/_common.mjs — shared geometry helpers for layouts.
//
// Layouts own their geometry; these are only the pieces genuinely reused:
// a title block that returns the remaining body, item normalization, pills and
// box anchors. No brand values live here.
import { listOf, textOf } from '../spec.mjs';

/** Title at the top of the frame; returns the node and the body left below it. */
export function titleBlock(spec, c, P, { ratio = 0.12, size = 0.56, landscapeRatio = 0.16 } = {}) {
  if (!spec?.title) return { node: null, body: { x: c.x, y: c.y, w: c.w, h: c.h } };
  const h = c.h * (c.landscape ? landscapeRatio : ratio);
  const node = P.text('title', { x: c.x, y: c.y, w: c.w, h }, {
    value: spec.title,
    size: P.theme.type.title * P.unit * size,
    weight: 900,
    font: 'display',
    align: 'center',
    valign: 'center',
  });
  return { node, body: { x: c.x, y: c.y + h, w: c.w, h: c.h - h } };
}

/** Normalize a list of strings/objects to {label, ...}. */
export function itemsOf(spec, key) {
  return listOf(spec?.[key]).map((it) => {
    if (typeof it === 'string') return { label: it };
    if (it && typeof it === 'object') return { ...it, label: textOf(it) };
    return { label: '' };
  });
}

export const center = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
export const bottom = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h });
export const top = (b) => ({ x: b.x + b.w / 2, y: b.y });
export const right = (b) => ({ x: b.x + b.w, y: b.y + b.h / 2 });
export const left = (b) => ({ x: b.x, y: b.y + b.h / 2 });

/** A pill: amber surface, blue label, fully rounded. */
export function pill(P, id, box, value, opts = {}, parent = null) {
  const size = opts.size ?? P.unit * 0.024;
  const color = opts.color ?? 'blue';
  const children = [
    P.text(`${id}-t`, { x: box.x + box.w * 0.06, y: box.y, w: box.w * 0.88, h: box.h }, {
      value, size, weight: 700, font: 'body', color,
      align: 'center', valign: 'center', slot: false,
    }, box),
  ];
  return P.card(id, box, { tone: opts.tone ?? 'amber', r: 999, children, shadow: opts.shadow !== false, style: opts.style, slot: opts.slot }, parent);
}

/** A card with an icon on the left and a wrapped label beside it. */
export function iconCard(P, id, box, { label, icon, tone = 'blue', fg = 'text', iconRatio = 0.34, labelScale = 1, slot = true } = {}) {
  const iconSize = Math.min(box.h * iconRatio, P.unit * 0.058);
  const children = [];
  children.push(P.icon(`${id}-icon`, {
    x: box.x + box.w * 0.05, y: box.y + (box.h - iconSize) / 2, w: iconSize, h: iconSize,
  }, { name: icon, size: iconSize, color: fg, slot: false }, box));
  const textX = box.x + box.w * 0.05 + iconSize + box.w * 0.03;
  const labelSize = P.theme.type.node * P.unit * labelScale;
  children.push(P.text(`${id}-label`, {
    x: textX, y: box.y, w: box.x + box.w * 0.95 - textX, h: box.h,
  }, {
    value: label, size: labelSize, weight: 800, font: 'display', color: fg,
    align: 'left', valign: 'center', wrap: Math.max(8, Math.floor((box.x + box.w * 0.95 - textX) / (labelSize * 0.52))),
    maxLines: 2, slot: false,
  }, box));
  return P.card(id, box, { tone, children, slot });
}

/** Draw a straight connector between two boxes, trimmed to their edges. */
export function connect(P, id, from, to, opts = {}) {
  const a = opts.fromEdge ?? bottom(from);
  const b = opts.toEdge ?? top(to);
  return P.edge(id, [a, b], opts);
}
