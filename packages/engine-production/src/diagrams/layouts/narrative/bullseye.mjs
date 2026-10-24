// diagrams/layouts/narrative/bullseye.mjs — concentric rings.
import { checkLabel, checkCount, MAX_TITLE, MAX_NOTE, playTime } from '../../spec.mjs';
import { titleBlock, itemsOf } from '../_common.mjs';

const TONES = ['surface', 'blue', 'text', 'accent'];

export default {
  name: 'bullseye',
  description: 'Concentric rings, with a label on each',
  frame: 'full',
  fields: ['title', 'rings'],

  minDurationFor(n) { return playTime(1.1, 0.35, n); },

  validate(spec) {
    const out = [];
    if (spec?.title != null) checkLabel(spec.title, 'title', out, { max: MAX_TITLE, required: false });
    const rings = itemsOf(spec, 'rings');
    checkCount(rings, 'rings', out, 2, 5);
    rings.forEach((r, i) => checkLabel(r.label, `rings[${i}]`, out, { max: MAX_NOTE }));
    return out;
  },

  slots(spec) {
    const out = [];
    if (spec?.title) out.push('title');
    itemsOf(spec, 'rings').forEach((_, i) => out.push(`ring-${i}`));
    return out;
  },

  build(spec, c, P) {
    const rings = itemsOf(spec, 'rings');
    const n = rings.length;
    const { node: title, body } = titleBlock(spec, c, P, { ratio: 0.09, landscapeRatio: 0.13 });
    const nodes = [];
    const build = [];
    if (title) { nodes.push(title); build.push(['title']); }

    const side = Math.min(body.w * 0.86, body.h * 0.86);
    const cx = body.x + body.w * 0.40;
    const cy = body.y + body.h / 2;
    const R = side / 2;

    for (let i = 0; i < n; i++) {
      const outer = R * ((n - i) / n);
      const inner = R * ((n - i - 1) / n);
      const box = { x: cx - outer, y: cy - outer, w: outer * 2, h: outer * 2 };
      nodes.push(P.shape(`ring-${i}`, box, {
        shape: 'donut', inner: inner / Math.max(1, outer),
        fill: TONES[i % TONES.length], opacity: i === n - 1 ? 0.95 : 0.78,
        stroke: 'rgba(234,88,12,.65)', strokeWidth: 3,
      }));
      build.push([`ring-${i}`]);
    }

    rings.forEach((r, i) => {
      const y = body.y + body.h * (0.12 + (i / Math.max(1, n)) * 0.72);
      const box = { x: body.x + body.w * 0.70, y, w: body.w * 0.28, h: body.h * 0.08 };
      const size = P.unit * 0.018;
      nodes.push(P.card(`ring-${i}-t`, box, {
        tone: 'ink', r: 14, shadow: false, slot: false,
        children: [P.text(`ring-${i}-tt`, { x: box.x + 10, y: box.y, w: box.w - 20, h: box.h }, {
          value: r.label, size, weight: 700, font: 'body', color: 'text',
          align: 'left', valign: 'center', wrap: 20, maxLines: 2, slot: false,
        }, box)],
      }));
    });

    return { nodes, build };
  },
};
