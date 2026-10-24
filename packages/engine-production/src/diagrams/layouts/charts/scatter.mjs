// diagrams/layouts/charts/scatter.mjs — positioned points on two axes.
import { checkLabel, checkCount, MAX_TITLE, playTime } from '../../spec.mjs';
import { titleBlock } from '../_common.mjs';
import { linear, extent, niceMax } from '../../charts/scales.mjs';

export default {
  name: 'scatter',
  description: 'Points positioned on two axes, one label each',
  frame: 'full',
  fields: ['title', 'x', 'y', 'points'],

  minDurationFor(n) { return playTime(1.2, 0.3, n); },

  validate(spec) {
    const out = [];
    if (spec?.title != null) checkLabel(spec.title, 'title', out, { max: MAX_TITLE, required: false });
    const points = Array.isArray(spec?.points) ? spec.points : [];
    checkCount(points, 'points', out, 2, 10);
    points.forEach((p, i) => {
      checkLabel(p?.label, `points[${i}].label`, out, { max: 20 });
      if (!Number.isFinite(Number(p?.x)) || !Number.isFinite(Number(p?.y))) out.push(`points[${i}] needs numeric x and y`);
    });
    for (const axis of ['x', 'y']) {
      if (spec?.[axis]?.label != null) checkLabel(spec[axis].label, `${axis}.label`, out, { max: 24, required: false });
    }
    return out;
  },

  slots(spec) {
    const out = [];
    if (spec?.title) out.push('title');
    (Array.isArray(spec?.points) ? spec.points : []).forEach((_, i) => out.push(`point-${i}`));
    return out;
  },

  build(spec, c, P) {
    const points = Array.isArray(spec?.points) ? spec.points : [];
    const { node: title, body } = titleBlock(spec, c, P, { ratio: 0.09, landscapeRatio: 0.13 });
    const nodes = [];
    const build = [];
    if (title) { nodes.push(title); build.push(['title']); }

    const padL = body.w * 0.10;
    const padB = body.h * 0.14;
    const padT = body.h * 0.06;
    const plot = { x: body.x + padL, y: body.y + padT, w: body.w - padL, h: body.h - padT - padB };

    const xs = extent(points.map((p) => p.x), { includeZero: true });
    const ys = extent(points.map((p) => p.y), { includeZero: true });
    const xMax = niceMax(Math.max(1, xs.max));
    const yMax = niceMax(Math.max(1, ys.max));
    const sx = linear(0, xMax, 0, plot.w);
    const sy = linear(0, yMax, plot.h, 0);

    for (let k = 0; k <= 3; k++) {
      const gy = plot.y + (plot.h * k) / 3;
      nodes.push(P.shape(`grid-${k}`, { x: plot.x, y: gy, w: plot.w, h: 2 }, {
        shape: 'rect', fill: k === 3 ? 'rgba(255,255,255,.42)' : 'rgba(255,255,255,.16)', slot: false,
      }));
    }
    nodes.push(P.shape('axis-x', { x: plot.x, y: plot.y + plot.h, w: plot.w, h: 3 }, {
      shape: 'rect', fill: 'rgba(255,255,255,.5)', slot: false,
    }));
    nodes.push(P.shape('axis-y', { x: plot.x, y: plot.y, w: 3, h: plot.h }, {
      shape: 'rect', fill: 'rgba(255,255,255,.5)', slot: false,
    }));

    if (spec?.x?.label) {
      nodes.push(P.text('xlabel', { x: plot.x, y: plot.y + plot.h + body.h * 0.03, w: plot.w, h: body.h * 0.06 }, {
        value: spec.x.label, size: P.unit * 0.022, weight: 700, font: 'body', color: 'text',
        align: 'center', valign: 'center', opacity: 0.7, caps: true, tracking: 0.12, slot: false,
      }));
    }
    if (spec?.y?.label) {
      nodes.push(P.text('ylabel', { x: body.x, y: plot.y - P.unit * 0.050, w: padL, h: P.unit * 0.040 }, {
        value: spec.y.label, size: P.unit * 0.018, weight: 700, font: 'body', color: 'text',
        align: 'left', valign: 'bottom', opacity: 0.7, caps: true, tracking: 0.08, slot: false,
      }));
    }

    points.forEach((p, i) => {
      const cx = plot.x + sx(Number(p.x));
      const cy = plot.y + sy(Number(p.y));
      const d = Math.min(P.unit * 0.045, plot.h * 0.06);
      const box = { x: cx - d / 2, y: cy - d / 2, w: d, h: d };
      const tone = p.tone ?? (i === 0 ? 'surface' : 'blue');
      const labelBox = { x: box.x - plot.w * 0.08, y: box.y + box.h + 6, w: plot.w * 0.16 + box.w, h: P.unit * 0.035 };
      nodes.push(P.group(`point-${i}`, box, {
        children: [
          P.shape(`point-${i}-dot`, box, {
            shape: 'circle', fill: tone, stroke: 'orange', strokeWidth: 3, slot: false,
          }, box),
          P.text(`point-${i}-label`, labelBox, {
            value: p.label, size: P.unit * 0.019, weight: 700, font: 'body', color: 'text',
            align: 'center', valign: 'top', slot: false,
          }, box),
        ],
      }));
      build.push([`point-${i}`]);
    });

    return { nodes, build };
  },
};
