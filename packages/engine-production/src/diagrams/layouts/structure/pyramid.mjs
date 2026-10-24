// diagrams/layouts/structure/pyramid.mjs — a hierarchy, widest at the base.
import { checkLabel, checkCount, MAX_TITLE, MAX_NOTE, playTime } from '../../spec.mjs';
import { titleBlock, itemsOf } from '../_common.mjs';

export default {
  name: 'pyramid',
  description: 'Levels stacked widest at the base',
  frame: 'full',
  fields: ['title', 'levels'],

  minDurationFor(n) { return playTime(1.1, 0.4, n); },

  validate(spec) {
    const out = [];
    if (spec?.title != null) checkLabel(spec.title, 'title', out, { max: MAX_TITLE, required: false });
    const levels = itemsOf(spec, 'levels');
    checkCount(levels, 'levels', out, 3, 5);
    levels.forEach((l, i) => checkLabel(l.label, `levels[${i}]`, out, { max: MAX_NOTE }));
    return out;
  },

  slots(spec) {
    const out = [];
    if (spec?.title) out.push('title');
    itemsOf(spec, 'levels').forEach((_, i) => out.push(`level-${i}`));
    return out;
  },

  build(spec, c, P) {
    const levels = itemsOf(spec, 'levels');
    const n = levels.length;
    const { node: title, body } = titleBlock(spec, c, P, { ratio: 0.09, landscapeRatio: 0.13 });
    const nodes = [];
    const build = [];
    if (title) { nodes.push(title); build.push(['title']); }

    const bandH = body.h / n;
    const widthAt = (t) => 0.22 + 0.78 * t;
    levels.forEach((level, i) => {
      const y = body.y + i * bandH;
      const tw = widthAt(i / n);
      const bw = widthAt((i + 1) / n);
      const box = { x: body.x, y, w: body.w, h: bandH };
      const top = i === 0;
      const fill = top ? 'surface' : (i === n - 1 ? 'blue' : `rgba(15,76,129,${0.92 - i * 0.10})`);
      const fg = top ? 'blue' : 'text';
      const size = P.theme.type.node * P.unit * (n > 4 ? 0.66 : 0.78);
      nodes.push(P.card(`level-${i}`, box, {
        tone: 'ghost', r: 16, shadow: false,
        style: { background: 'transparent', 'box-shadow': 'none' },
        children: [
          P.shape(`level-${i}-shape`, box, {
            shape: 'polygon',
            points: [{ x: (1 - tw) / 2, y: 0 }, { x: (1 + tw) / 2, y: 0 }, { x: (1 + bw) / 2, y: 1 }, { x: (1 - bw) / 2, y: 1 }],
            fill, slot: false,
          }, box),
          P.text(`level-${i}-t`, { x: body.x, y: box.y + box.h * 0.10, w: body.w, h: box.h * 0.52 }, {
            value: level.label, size, weight: 800, font: 'display', color: fg,
            align: 'center', valign: 'center', slot: false,
          }, box),
          ...(level.value != null ? [P.text(`level-${i}-v`, { x: body.x, y: box.y + box.h * 0.58, w: body.w, h: box.h * 0.28 }, {
            value: String(level.value), size: size * 0.86, weight: 800, font: 'body', color: fg,
            align: 'center', valign: 'center', opacity: 0.8, slot: false,
          }, box)] : []),
        ],
      }));
      build.push([`level-${i}`]);
    });

    return { nodes, build };
  },
};
