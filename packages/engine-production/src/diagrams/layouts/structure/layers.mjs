// diagrams/layouts/structure/layers.mjs — a stack of tiers.
import { checkLabel, checkCount, MAX_TITLE, MAX_LABEL, playTime } from '../../spec.mjs';
import { titleBlock, itemsOf } from '../_common.mjs';
import { wrapChars } from '../../primitives.mjs';

export default {
  name: 'layers',
  description: 'Layers stacked top to bottom, each a band of one system tier',
  frame: 'full',
  fields: ['title', 'layers'],

  minDurationFor(n) { return playTime(1.1, 0.45, n); },

  validate(spec) {
    const out = [];
    if (spec?.title != null) checkLabel(spec.title, 'title', out, { max: MAX_TITLE, required: false });
    const layers = itemsOf(spec, 'layers');
    checkCount(layers, 'layers', out, 3, 6);
    layers.forEach((l, i) => checkLabel(l.label, `layers[${i}]`, out, { max: MAX_LABEL }));
    return out;
  },

  slots(spec) {
    const n = itemsOf(spec, 'layers').length;
    const out = [];
    if (spec?.title) out.push('title');
    for (let i = 0; i < n; i++) out.push(`layer-${i}`);
    return out;
  },

  build(spec, c, P) {
    const layers = itemsOf(spec, 'layers');
    const n = layers.length;
    const { node: title, body } = titleBlock(spec, c, P, { ratio: 0.10, landscapeRatio: 0.14 });
    const nodes = [];
    const build = [];
    if (title) { nodes.push(title); build.push(['title']); }

    const gap = body.h * 0.025;
    const bandH = (body.h - gap * (n - 1)) / n;
    for (let i = 0; i < n; i++) {
      // The top bands are narrower, so the stack reads as a tower.
      const widthRatio = 0.70 + 0.30 * (i / Math.max(1, n - 1));
      const w = body.w * widthRatio;
      const x = body.x + (body.w - w) / 2;
      const y = body.y + i * (bandH + gap);
      const box = { x, y, w, h: bandH };
      const isTop = i === 0;
      const tone = isTop ? 'amber' : 'blue';
      const fg = isTop ? 'blue' : 'text';
      const content = P.cardContent(box, {
        icon: layers[i].icon || 'stack-2',
        label: layers[i].label,
      }, {
        id: `layer-${i}`, fg, mode: 'row',
        labelSize: P.theme.type.node * P.unit * 0.86,
      });
      nodes.push(P.card(`layer-${i}`, box, {
        tone, r: 26, children: content.children, meta: content.meta,
      }));
      build.push([`layer-${i}`]);
    }

    return { nodes, build };
  },
};
