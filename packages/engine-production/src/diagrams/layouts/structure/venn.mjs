// diagrams/layouts/structure/venn.mjs — overlapping sets.
import { checkLabel, checkCount, MAX_TITLE, MAX_LABEL, playTime } from '../../spec.mjs';
import { titleBlock, itemsOf } from '../_common.mjs';

const TONES = ['surface', 'blue', 'text'];

export default {
  name: 'venn',
  description: 'Two or three overlapping sets, with the overlap named',
  frame: 'full',
  fields: ['title', 'sets', 'intersections'],

  minDurationFor(n) { return playTime(1.2, 0.4, n); },

  validate(spec) {
    const out = [];
    if (spec?.title != null) checkLabel(spec.title, 'title', out, { max: MAX_TITLE, required: false });
    const sets = itemsOf(spec, 'sets');
    checkCount(sets, 'sets', out, 2, 3);
    sets.forEach((s, i) => checkLabel(s.label, `sets[${i}]`, out, { max: MAX_LABEL }));
    const inter = Array.isArray(spec?.intersections) ? spec.intersections : [];
    inter.forEach((s, i) => checkLabel(typeof s === 'string' ? s : s?.label, `intersections[${i}]`, out, { max: 24 }));
    return out;
  },

  slots(spec) {
    const out = [];
    if (spec?.title) out.push('title');
    itemsOf(spec, 'sets').forEach((_, i) => { out.push(`circle-${i}`); out.push(`label-${i}`); });
    return out;
  },

  build(spec, c, P) {
    const sets = itemsOf(spec, 'sets');
    const inter = Array.isArray(spec?.intersections) ? spec.intersections : [];
    const { node: title, body } = titleBlock(spec, c, P, { ratio: 0.09, landscapeRatio: 0.13 });
    const nodes = [];
    const build = [];
    if (title) { nodes.push(title); build.push(['title']); }

    const area = { x: body.x + body.w * 0.12, y: body.y + body.h * 0.08, w: body.w * 0.76, h: body.h * 0.76 };
    const r = Math.min(area.w * 0.34, area.h * 0.36);
    const positions = sets.length === 2
      ? [{ x: area.x + area.w * 0.38, y: area.y + area.h * 0.50 }, { x: area.x + area.w * 0.62, y: area.y + area.h * 0.50 }]
      : [
        { x: area.x + area.w * 0.50, y: area.y + area.h * 0.34 },
        { x: area.x + area.w * 0.36, y: area.y + area.h * 0.64 },
        { x: area.x + area.w * 0.64, y: area.y + area.h * 0.64 },
      ];

    positions.forEach((p, i) => {
      const box = { x: p.x - r, y: p.y - r, w: r * 2, h: r * 2 };
      nodes.push(P.shape(`circle-${i}`, box, {
        shape: 'circle', fill: TONES[i % TONES.length], opacity: 0.30, stroke: 'text', strokeWidth: 4,
      }));
      build.push([`circle-${i}`]);
    });

    positions.forEach((p, i) => {
      const off = sets.length === 2 ? (i === 0 ? -r * 0.42 : r * 0.42) : (i === 0 ? 0 : (i === 1 ? -r * 0.34 : r * 0.34));
      const yOff = sets.length === 2 ? 0 : (i === 0 ? -r * 0.42 : r * 0.30);
      const box = { x: p.x + off - r * 0.50, y: p.y + yOff - r * 0.18, w: r, h: r * 0.36 };
      nodes.push(P.text(`label-${i}`, box, {
        value: sets[i].label, size: P.theme.type.node * P.unit * 0.72, weight: 800, font: 'display',
        color: 'text', align: 'center', valign: 'center', wrap: 14, maxLines: 2,
      }));
      build.push([`label-${i}`]);
    });

    inter.slice(0, 3).forEach((label, i) => {
      const value = typeof label === 'string' ? label : label?.label ?? '';
      const box = { x: area.x + area.w * 0.36, y: area.y + area.h * 0.46 + i * P.unit * 0.05, w: area.w * 0.28, h: P.unit * 0.045 };
      nodes.push(P.text(`inter-${i}`, box, {
        value, size: P.unit * 0.018, weight: 800, font: 'body', color: 'text',
        align: 'center', valign: 'center', slot: false,
      }));
    });

    return { nodes, build };
  },
};
