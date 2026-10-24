// diagrams/layouts/charts/pie.mjs — pie and donut.
import { checkLabel, checkCount, MAX_TITLE, MAX_NOTE, playTime } from '../../spec.mjs';
import { titleBlock, itemsOf } from '../_common.mjs';

const TONES = ['surface', 'text', 'accent', 'blue', 'amber'];

export default {
  name: 'pie',
  description: 'A whole split into slices, with a legend',
  frame: 'full',
  fields: ['title', 'slices', 'donut', 'center'],

  minDurationFor(n) { return playTime(1.2, 0.4, n); },

  validate(spec) {
    const out = [];
    if (spec?.title != null) checkLabel(spec.title, 'title', out, { max: MAX_TITLE, required: false });
    const slices = itemsOf(spec, 'slices');
    checkCount(slices, 'slices', out, 2, 6);
    let sum = 0;
    slices.forEach((s, i) => {
      checkLabel(s.label, `slices[${i}].label`, out, { max: 22 });
      const v = Number(s.value);
      if (!Number.isFinite(v) || v <= 0) out.push(`slices[${i}].value must be a positive number`);
      else sum += v;
    });
    if (sum <= 0) out.push('slices must add up to more than zero');
    if (spec?.center != null) checkLabel(spec.center, 'center', out, { max: MAX_NOTE, required: false });
    return out;
  },

  slots(spec) {
    const out = [];
    if (spec?.title) out.push('title');
    itemsOf(spec, 'slices').forEach((_, i) => out.push(`slice-${i}`));
    return out;
  },

  build(spec, c, P) {
    const slices = itemsOf(spec, 'slices').map((s, i) => ({ ...s, value: Number(s.value), tone: s.tone ?? TONES[i % TONES.length] }));
    const total = slices.reduce((n, s) => n + s.value, 0) || 1;
    const { node: title, body } = titleBlock(spec, c, P, { ratio: 0.09, landscapeRatio: 0.13 });
    const nodes = [];
    const build = [];
    if (title) { nodes.push(title); build.push(['title']); }

    const legendW = c.landscape ? body.w * 0.34 : 0;
    const legendH = c.landscape ? 0 : body.h * 0.22;
    const chartH = body.h - legendH;
    const side = Math.min(c.landscape ? body.w - legendW : body.w * 0.92, chartH * 0.92);
    const box = {
      x: body.x + (c.landscape ? (body.w - legendW - side) / 2 : (body.w - side) / 2),
      y: body.y + (chartH - side) / 2,
      w: side, h: side,
    };

    let a = -90;
    slices.forEach((s, i) => {
      const sweep = (s.value / total) * 360;
      const a0 = a;
      const a1 = a + sweep;
      a = a1;
      nodes.push(P.shape(`slice-${i}`, box, {
        shape: spec?.donut ? 'donut' : 'pie',
        inner: spec?.donut ? 0.60 : 0,
        startAngle: a0,
        endAngle: a1,
        fill: s.tone,
        stroke: 'rgba(234,88,12,0.9)',
        strokeWidth: 4,
      }));
      build.push([`slice-${i}`]);
    });

    if (spec?.center) {
      nodes.push(P.text('center', { x: box.x + box.w * 0.20, y: box.y + box.h * 0.36, w: box.w * 0.60, h: box.h * 0.28 }, {
        value: spec.center, size: P.unit * (spec.donut ? 0.040 : 0.030), weight: 900, font: 'display',
        color: 'text', align: 'center', valign: 'center', wrap: 16, maxLines: 2, slot: false,
      }));
    }

    // Legend.
    const lx = c.landscape ? body.x + body.w - legendW + body.w * 0.02 : body.x;
    const ly = c.landscape ? body.y + body.h * 0.10 : body.y + chartH + body.h * 0.03;
    const rowH = Math.min(P.unit * 0.065, (c.landscape ? body.h * 0.14 : body.h * 0.06));
    slices.forEach((s, i) => {
      const y = ly + i * rowH;
      nodes.push(P.shape(`legend-${i}-dot`, { x: lx, y: y + rowH * 0.26, w: 18, h: 18 }, {
        shape: 'circle', fill: s.tone, slot: false,
      }));
      nodes.push(P.text(`legend-${i}-t`, { x: lx + 28, y, w: (c.landscape ? legendW * 0.78 : body.w * 0.62), h: rowH }, {
        value: `${s.label}  ${Math.round((s.value / total) * 100)}%`, size: P.unit * 0.022, weight: 700, font: 'body',
        color: 'text', align: 'left', valign: 'center', slot: false,
      }));
    });

    return { nodes, build };
  },
};
