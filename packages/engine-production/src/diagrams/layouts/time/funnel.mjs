// diagrams/layouts/time/funnel.mjs — stages that narrow.
import { checkLabel, checkCount, MAX_TITLE, MAX_NOTE, playTime } from '../../spec.mjs';
import { titleBlock, itemsOf } from '../_common.mjs';

export default {
  name: 'funnel',
  description: 'Stages that narrow like a funnel, with the count at each stage',
  frame: 'full',
  fields: ['title', 'stages'],

  minDurationFor(n) { return playTime(1.1, 0.45, n); },

  validate(spec) {
    const out = [];
    if (spec?.title != null) checkLabel(spec.title, 'title', out, { max: MAX_TITLE, required: false });
    const stages = itemsOf(spec, 'stages');
    checkCount(stages, 'stages', out, 2, 6);
    stages.forEach((s, i) => checkLabel(s.label, `stages[${i}]`, out, { max: MAX_NOTE }));
    return out;
  },

  slots(spec) {
    const n = itemsOf(spec, 'stages').length;
    const out = [];
    if (spec?.title) out.push('title');
    for (let i = 0; i < n; i++) out.push(`stage-${i}`);
    return out;
  },

  build(spec, c, P) {
    const stages = itemsOf(spec, 'stages');
    const n = stages.length;
    const { node: title, body } = titleBlock(spec, c, P, { ratio: 0.10, landscapeRatio: 0.14 });
    const nodes = [];
    const build = [];
    if (title) { nodes.push(title); build.push(['title']); }

    const gap = 0;
    const bandH = body.h / n;
    const top0 = 1;
    const bottom0 = 0.36;
    const widthAt = (t) => top0 + (bottom0 - top0) * t;

    for (let i = 0; i < n; i++) {
      const y = body.y + i * (bandH + gap);
      const tw = widthAt(i / n);
      const bw = widthAt((i + 1) / n);
      const box = { x: body.x, y, w: body.w, h: bandH };
      const isLast = i === n - 1;
      const fill = isLast ? 'surface' : (i === 0 ? 'blue' : 'rgba(15,76,129,0.86)');
      const fg = isLast ? 'blue' : 'text';
      const valueSize = P.theme.type.node * P.unit * (n > 4 ? 0.82 : 0.98);
      const labelSize = P.theme.type.node * P.unit * (n > 4 ? 0.60 : 0.70);
      const children = [
        P.shape(`stage-${i}-shape`, box, {
          shape: 'polygon',
          points: [
            { x: (1 - tw) / 2, y: 0 }, { x: (1 + tw) / 2, y: 0 },
            { x: (1 + bw) / 2, y: 1 }, { x: (1 - bw) / 2, y: 1 },
          ],
          fill, slot: false,
        }, box),
      ];
      if (stages[i].value != null) {
        children.push(P.text(`stage-${i}-value`, { x: box.x, y: box.y + box.h * 0.12, w: box.w, h: box.h * 0.44 }, {
          value: String(stages[i].value), size: valueSize, weight: 900, font: 'display', color: fg,
          align: 'center', valign: 'center', slot: false,
        }, box));
        children.push(P.text(`stage-${i}-label`, { x: box.x, y: box.y + box.h * 0.52, w: box.w, h: box.h * 0.36 }, {
          value: stages[i].label, size: labelSize, weight: 700, font: 'body', color: fg,
          align: 'center', valign: 'center', opacity: 0.92, slot: false,
        }, box));
      } else {
        children.push(P.text(`stage-${i}-label`, { x: box.x, y: box.y, w: box.w, h: box.h }, {
          value: stages[i].label, size: valueSize * 0.82, weight: 800, font: 'display', color: fg,
          align: 'center', valign: 'center', slot: false,
        }, box));
      }
      nodes.push(P.card(`stage-${i}`, box, {
        tone: 'ghost', r: 18, shadow: true, overflow: 'visible',
        children,
        style: { background: 'transparent', 'box-shadow': 'none' },
      }));
      build.push([`stage-${i}`]);
    }

    return { nodes, build };
  },
};
