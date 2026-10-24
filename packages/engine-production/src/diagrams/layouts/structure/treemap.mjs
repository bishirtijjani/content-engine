// diagrams/layouts/structure/treemap.mjs — area proportional to value.
import { checkLabel, checkCount, MAX_TITLE, playTime } from '../../spec.mjs';
import { titleBlock, itemsOf } from '../_common.mjs';
import { PALETTE } from '../../charts/palette.mjs';
import { wrapChars } from '../../primitives.mjs';

function split(items, box, horizontal, out) {
  if (!items.length) return out;
  if (items.length === 1) { out.push({ item: items[0], box }); return out; }
  const total = items.reduce((n, it) => n + it.value, 0) || 1;
  let acc = 0;
  let k = 1;
  for (let i = 0; i < items.length; i++) {
    acc += items[i].value;
    k = i + 1;
    if (acc >= total / 2) break;
  }
  const a = items.slice(0, k);
  const b = items.slice(k);
  if (!b.length) { out.push({ item: items[0], box }); return out; }
  const ratio = a.reduce((n, it) => n + it.value, 0) / total;
  if (horizontal) {
    const wa = box.w * ratio;
    split(a, { x: box.x, y: box.y, w: wa, h: box.h }, !horizontal, out);
    split(b, { x: box.x + wa, y: box.y, w: box.w - wa, h: box.h }, !horizontal, out);
  } else {
    const ha = box.h * ratio;
    split(a, { x: box.x, y: box.y, w: box.w, h: ha }, !horizontal, out);
    split(b, { x: box.x, y: box.y + ha, w: box.w, h: box.h - ha }, !horizontal, out);
  }
  return out;
}

export default {
  name: 'treemap',
  description: 'Rectangles sized by value',
  frame: 'full',
  fields: ['title', 'items'],

  minDurationFor(n) { return playTime(1.1, 0.3, n); },

  validate(spec) {
    const out = [];
    if (spec?.title != null) checkLabel(spec.title, 'title', out, { max: MAX_TITLE, required: false });
    const items = itemsOf(spec, 'items');
    checkCount(items, 'items', out, 2, 8);
    items.forEach((it, i) => {
      checkLabel(it.label, `items[${i}].label`, out, { max: 20 });
      if (!(Number(it.value) > 0)) out.push(`items[${i}].value must be positive`);
    });
    return out;
  },

  slots(spec) {
    const out = [];
    if (spec?.title) out.push('title');
    itemsOf(spec, 'items').forEach((_, i) => out.push(`tile-${i}`));
    return out;
  },

  build(spec, c, P) {
    const items = itemsOf(spec, 'items')
      .map((it, i) => ({ ...it, value: Number(it.value), index: i }))
      .sort((a, b) => b.value - a.value);
    const { node: title, body } = titleBlock(spec, c, P, { ratio: 0.09, landscapeRatio: 0.13 });
    const nodes = [];
    const build = [];
    if (title) { nodes.push(title); build.push(['title']); }

    const pad = Math.min(body.w, body.h) * 0.008;
    const tiles = split(items, body, body.w >= body.h, []);
    tiles.forEach(({ item, box }) => {
      const b = { x: box.x + pad, y: box.y + pad, w: Math.max(8, box.w - pad * 2), h: Math.max(8, box.h - pad * 2) };
      const tone = item.tone ?? PALETTE[item.index % PALETTE.length];
      const size = Math.min(P.unit * 0.030, b.h * 0.22);
      nodes.push(P.card(`tile-${item.index}`, b, {
        tone, r: 14,
        children: [
          P.text(`tile-${item.index}-t`, { x: b.x + 10, y: b.y + b.h * 0.10, w: b.w - 20, h: b.h * 0.52 }, {
            value: item.label, size, weight: 800, font: 'display', color: tone === 'amber' || tone === 'surface' ? 'blue' : 'text',
            align: 'left', valign: 'center', wrap: wrapChars(b.w - 20, size), maxLines: 2, slot: false,
          }, b),
          ...(b.h > P.unit * 0.10 ? [P.text(`tile-${item.index}-v`, { x: b.x + 10, y: b.y + b.h * 0.64, w: b.w - 20, h: b.h * 0.24 }, {
            value: String(item.value), size: size * 0.82, weight: 800, font: 'body',
            color: tone === 'amber' || tone === 'surface' ? 'blue' : 'text', align: 'left', valign: 'center', opacity: 0.8, slot: false,
          }, b)] : []),
        ],
      }));
      build.push([`tile-${item.index}`]);
    });

    return { nodes, build };
  },
};
