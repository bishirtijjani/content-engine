// diagrams/layouts/narrative/iceberg.mjs — visible and hidden.
import { checkLabel, checkCount, MAX_TITLE, MAX_NOTE, playTime } from '../../spec.mjs';
import { titleBlock, itemsOf } from '../_common.mjs';
import { wrapChars } from '../../primitives.mjs';

export default {
  name: 'iceberg',
  description: 'What shows above the waterline, and what sits below it',
  frame: 'full',
  fields: ['title', 'above', 'below'],

  minDurationFor(n) { return playTime(1.1, 0.35, n); },

  validate(spec) {
    const out = [];
    if (spec?.title != null) checkLabel(spec.title, 'title', out, { max: MAX_TITLE, required: false });
    for (const key of ['above', 'below']) {
      const items = itemsOf(spec, key);
      checkCount(items, key, out, 1, 4);
      items.forEach((it, i) => checkLabel(it.label, `${key}[${i}]`, out, { max: MAX_NOTE }));
    }
    return out;
  },

  slots(spec) {
    const out = [];
    if (spec?.title) out.push('title');
    itemsOf(spec, 'above').forEach((_, i) => out.push(`item-above-${i}`));
    itemsOf(spec, 'below').forEach((_, i) => out.push(`item-below-${i}`));
    return out;
  },

  build(spec, c, P) {
    const above = itemsOf(spec, 'above');
    const below = itemsOf(spec, 'below');
    const { node: title, body } = titleBlock(spec, c, P, { ratio: 0.09, landscapeRatio: 0.13 });
    const nodes = [];
    const build = [];
    if (title) { nodes.push(title); build.push(['title']); }

    const waterY = body.y + body.h * 0.42;
    nodes.push(P.shape('waterline', { x: body.x, y: waterY - 2, w: body.w, h: 4 }, {
      shape: 'rect', fill: 'rgba(255,255,255,.55)', slot: false,
    }));
    nodes.push(P.text('above-label', { x: body.x, y: body.y, w: body.w * 0.4, h: body.h * 0.06 }, {
      value: 'Visible', size: P.unit * 0.017, weight: 700, font: 'body', color: 'text',
      align: 'left', valign: 'center', opacity: 0.6, caps: true, tracking: 0.12, slot: false,
    }));
    nodes.push(P.text('below-label', { x: body.x, y: waterY + body.h * 0.02, w: body.w * 0.4, h: body.h * 0.06 }, {
      value: 'Hidden', size: P.unit * 0.017, weight: 700, font: 'body', color: 'text',
      align: 'left', valign: 'center', opacity: 0.6, caps: true, tracking: 0.12, slot: false,
    }));

    const row = (items, y, h, prefix, tone) => {
      const gap = body.w * 0.03;
      const w = (body.w - gap * (items.length - 1)) / items.length;
      items.forEach((it, i) => {
        const box = { x: body.x + i * (w + gap), y, w, h };
        const size = P.theme.type.node * P.unit * 0.68;
        nodes.push(P.card(`${prefix}-${i}`, box, {
          tone, r: 24,
          children: [P.text(`${prefix}-${i}-t`, { x: box.x + 12, y: box.y, w: box.w - 24, h: box.h }, {
            value: it.label, size, weight: 700, font: 'display', color: 'text',
            align: 'center', valign: 'center', wrap: wrapChars(box.w - 24, size), maxLines: 2, slot: false,
          }, box)],
        }));
        build.push([`${prefix}-${i}`]);
      });
    };

    row(above, body.y + body.h * 0.10, body.h * 0.22, 'item-above', 'amber');
    row(below, waterY + body.h * 0.12, body.h * 0.34, 'item-below', 'ghost');

    return { nodes, build };
  },
};
