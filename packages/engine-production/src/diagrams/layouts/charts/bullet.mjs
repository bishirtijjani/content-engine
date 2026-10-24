// diagrams/layouts/charts/bullet.mjs — a value, its target and its maximum.
import { checkLabel, checkCount, MAX_TITLE, playTime } from '../../spec.mjs';
import { titleBlock, itemsOf } from '../_common.mjs';

export default {
  name: 'bullet',
  description: 'A value bar against a target on a shared scale',
  frame: 'full',
  fields: ['title', 'items'],

  minDurationFor(n) { return playTime(1.0, 0.3, n); },

  validate(spec) {
    const out = [];
    if (spec?.title != null) checkLabel(spec.title, 'title', out, { max: MAX_TITLE, required: false });
    const items = itemsOf(spec, 'items');
    checkCount(items, 'items', out, 2, 6);
    items.forEach((it, i) => {
      checkLabel(it.label, `items[${i}].label`, out, { max: 24 });
      for (const k of ['value', 'target']) {
        if (!Number.isFinite(Number(it[k]))) out.push(`items[${i}].${k} must be a number`);
      }
      if (it.max != null && !Number.isFinite(Number(it.max))) out.push(`items[${i}].max must be a number`);
    });
    return out;
  },

  slots(spec) {
    const out = [];
    if (spec?.title) out.push('title');
    itemsOf(spec, 'items').forEach((_, i) => { out.push(`bar-${i}`); out.push(`target-${i}`); });
    return out;
  },

  build(spec, c, P) {
    const items = itemsOf(spec, 'items');
    const { node: title, body } = titleBlock(spec, c, P, { ratio: 0.10, landscapeRatio: 0.14 });
    const nodes = [];
    const build = [];
    if (title) { nodes.push(title); build.push(['title']); }

    const gap = body.h * 0.035;
    const rowH = (body.h - gap * (items.length - 1)) / items.length;
    items.forEach((it, i) => {
      const box = { x: body.x, y: body.y + i * (rowH + gap), w: body.w, h: rowH };
      const max = Math.max(Number(it.max ?? it.target), Number(it.value), Number(it.target), 1);
      const trackX = box.x + box.w * 0.36;
      const trackW = box.w * 0.56;
      const valueW = (Math.max(0, Number(it.value)) / max) * trackW;
      const targetX = trackX + (Number(it.target) / max) * trackW;
      const children = [
        P.text(`row-${i}-label`, { x: box.x, y: box.y, w: box.w * 0.34, h: box.h }, {
          value: it.label, size: P.theme.type.node * P.unit * 0.78, weight: 800, font: 'display', color: 'text',
          align: 'left', valign: 'center', wrap: 18, maxLines: 1, slot: false,
        }, box),
        P.text(`row-${i}-value`, { x: box.x + box.w * 0.92, y: box.y, w: box.w * 0.08, h: box.h }, {
          value: String(it.value), size: P.theme.type.node * P.unit * 0.74, weight: 900, font: 'display',
          color: 'text', align: 'right', valign: 'center', slot: false,
        }, box),
        P.shape(`row-${i}-track`, { x: trackX, y: box.y + box.h * 0.30, w: trackW, h: box.h * 0.40 }, {
          shape: 'rect', r: box.h * 0.20, fill: 'rgba(255,255,255,.14)', slot: false,
        }, box),
        P.shape(`bar-${i}`, { x: trackX, y: box.y + box.h * 0.40, w: valueW, h: box.h * 0.20 }, {
          shape: 'rect', r: box.h * 0.10, fill: 'surface',
        }, box),
        P.shape(`target-${i}`, { x: targetX - 2, y: box.y + box.h * 0.22, w: 4, h: box.h * 0.56 }, {
          shape: 'rect', r: 2, fill: 'text',
        }, box),
      ];
      nodes.push(P.group(`row-${i}`, box, { children, slot: false }));
      build.push([`bar-${i}`]);
      build.push([`target-${i}`]);
    });

    return { nodes, build };
  },
};
