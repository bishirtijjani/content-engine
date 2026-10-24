// diagrams/layouts/charts/ranking.mjs — ordered rows with proportional bars.
import { checkLabel, checkCount, MAX_TITLE, playTime } from '../../spec.mjs';
import { titleBlock, itemsOf } from '../_common.mjs';

export default {
  name: 'ranking',
  description: 'Ordered rows with a rank, a label and a proportional bar',
  frame: 'full',
  fields: ['title', 'items'],

  minDurationFor(n) { return playTime(1.0, 0.3, n); },

  validate(spec) {
    const out = [];
    if (spec?.title != null) checkLabel(spec.title, 'title', out, { max: MAX_TITLE, required: false });
    const items = itemsOf(spec, 'items');
    checkCount(items, 'items', out, 2, 7);
    items.forEach((it, i) => {
      checkLabel(it.label, `items[${i}].label`, out, { max: 24 });
      if (!Number.isFinite(Number(it.value))) out.push(`items[${i}].value must be a number`);
    });
    return out;
  },

  slots(spec) {
    const out = [];
    if (spec?.title) out.push('title');
    itemsOf(spec, 'items').forEach((_, i) => out.push(`row-${i}`));
    return out;
  },

  build(spec, c, P) {
    const items = itemsOf(spec, 'items').map((it) => ({ ...it, value: Number(it.value) }));
    const { node: title, body } = titleBlock(spec, c, P, { ratio: 0.10, landscapeRatio: 0.14 });
    const nodes = [];
    const build = [];
    if (title) { nodes.push(title); build.push(['title']); }

    const max = Math.max(1, ...items.map((i) => i.value));
    const gap = body.h * 0.025;
    const rowH = (body.h - gap * (items.length - 1)) / items.length;
    items.forEach((it, i) => {
      const box = { x: body.x, y: body.y + i * (rowH + gap), w: body.w, h: rowH };
      const top = i === 0;
      const content = P.cardContent(box, { icon: it.icon || 'circle-dot', label: it.label }, {
        id: `row-${i}`, fg: 'text', mode: 'row',
        leading: 0.09, trailing: 0.51,
        labelSize: P.theme.type.node * P.unit * 0.80,
        iconColor: top ? 'surface' : 'text',
      });
      const children = [...content.children];
      children.push(P.text(`row-${i}-rank`, content.leadingBox, {
        value: String(i + 1), size: Math.min(box.h * 0.50, P.unit * 0.038), weight: 900, font: 'display',
        color: top ? 'surface' : 'text', align: 'center', valign: 'center', opacity: top ? 1 : 0.55, slot: false,
      }, box));

      const tb = content.trailingBox;
      const trackX = tb.x + tb.w * 0.03;
      const trackW = tb.w * 0.80;
      const barW = (Math.max(0, it.value) / max) * trackW;
      children.push(P.shape(`row-${i}-track`, { x: trackX, y: box.y + box.h * 0.34, w: trackW, h: box.h * 0.32 }, {
        shape: 'rect', r: box.h * 0.16, fill: 'rgba(255,255,255,.16)', slot: false,
      }, box));
      children.push(P.shape(`row-${i}-bar`, { x: trackX, y: box.y + box.h * 0.34, w: barW, h: box.h * 0.32 }, {
        shape: 'rect', r: box.h * 0.16, fill: top ? 'surface' : 'text', slot: false,
      }, box));
      children.push(P.text(`row-${i}-value`, { x: tb.x + tb.w * 0.86, y: box.y, w: tb.w * 0.14, h: box.h }, {
        value: String(it.value), size: Math.min(box.h * 0.40, P.unit * 0.030), weight: 900, font: 'display',
        color: top ? 'surface' : 'text', align: 'right', valign: 'center', slot: false,
      }, box));
      nodes.push(P.card(`row-${i}`, box, { tone: 'ink', r: 22, children, meta: content.meta }));
      build.push([`row-${i}`]);
    });

    return { nodes, build };
  },
};
