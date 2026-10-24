// diagrams/layouts/interface/icon-grid.mjs — a grid of icons and labels.
import { checkLabel, checkCount, MAX_TITLE, MAX_NOTE, playTime } from '../../spec.mjs';
import { titleBlock, itemsOf } from '../_common.mjs';
import { wrapChars } from '../../primitives.mjs';

export default {
  name: 'icon-grid',
  description: 'A grid of icons with a label under each',
  frame: 'full',
  fields: ['title', 'items'],

  minDurationFor(n) { return playTime(1.0, 0.25, n); },

  validate(spec) {
    const out = [];
    if (spec?.title != null) checkLabel(spec.title, 'title', out, { max: MAX_TITLE, required: false });
    const items = itemsOf(spec, 'items');
    checkCount(items, 'items', out, 2, 9);
    items.forEach((it, i) => {
      checkLabel(it.label, `items[${i}].label`, out, { max: MAX_NOTE });
      if (!it.icon) out.push(`items[${i}] needs an icon`);
    });
    return out;
  },

  slots(spec) {
    const out = [];
    if (spec?.title) out.push('title');
    itemsOf(spec, 'items').forEach((_, i) => out.push(`item-${i}`));
    return out;
  },

  build(spec, c, P) {
    const items = itemsOf(spec, 'items');
    const { node: title, body } = titleBlock(spec, c, P, { ratio: 0.09, landscapeRatio: 0.13 });
    const nodes = [];
    const build = [];
    if (title) { nodes.push(title); build.push(['title']); }

    const cols = items.length <= 4 ? 2 : 3;
    const rows = Math.ceil(items.length / cols);
    const gapX = body.w * 0.04;
    const gapY = body.h * 0.04;
    const w = (body.w - gapX * (cols - 1)) / cols;
    // Cards are content-sized: a tall grid cell must not leave a dead band.
    const h = Math.min((body.h - gapY * (rows - 1)) / rows, P.unit * 0.36);
    const totalH = h * rows + gapY * (rows - 1);
    const offsetY = (body.h - totalH) / 2;

    items.forEach((it, i) => {
      const r = Math.floor(i / cols);
      const k = i % cols;
      const box = { x: body.x + k * (w + gapX), y: body.y + offsetY + r * (h + gapY), w, h };
      const tone = i === 0 ? 'amber' : 'ghost';
      const fg = i === 0 ? 'blue' : 'text';
      const content = P.cardContent(box, { icon: it.icon, label: it.label }, {
        id: `item-${i}`, fg, mode: 'stack',
        labelSize: P.theme.type.node * P.unit * 0.66,
        iconColor: i === 0 ? 'blue' : 'surface',
      });
      nodes.push(P.card(`item-${i}`, box, {
        tone, r: 26, children: content.children, meta: content.meta,
      }));
      build.push([`item-${i}`]);
    });

    return { nodes, build };
  },
};
