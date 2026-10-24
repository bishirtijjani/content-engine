// diagrams/layouts/structure/quadrant.mjs — points plotted in quadrants.
import { checkLabel, checkCount, MAX_TITLE, MAX_NOTE, playTime } from '../../spec.mjs';
import { titleBlock } from '../_common.mjs';
import { linear, extent, niceMax } from '../../charts/scales.mjs';

export default {
  name: 'quadrant',
  description: 'Points positioned across four labelled quadrants',
  frame: 'full',
  fields: ['title', 'x', 'y', 'points', 'quadrants'],

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
      if (spec?.[axis]?.label != null) checkLabel(spec[axis].label, `${axis}.label`, out, { max: MAX_NOTE, required: false });
    }
    (Array.isArray(spec?.quadrants) ? spec.quadrants : []).forEach((q, i) => checkLabel(typeof q === 'string' ? q : q?.label, `quadrants[${i}]`, out, { max: 20, required: false }));
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
    const quads = Array.isArray(spec?.quadrants) ? spec.quadrants.map((q) => (typeof q === 'string' ? q : q?.label ?? '')) : [];
    const { node: title, body } = titleBlock(spec, c, P, { ratio: 0.08, landscapeRatio: 0.12 });
    const nodes = [];
    const build = [];
    if (title) { nodes.push(title); build.push(['title']); }

    const padL = body.w * 0.08;
    const plot = { x: body.x + padL, y: body.y + body.h * 0.06, w: body.w - padL, h: body.h * 0.82 };
    const xs = extent(points.map((p) => p.x), { includeZero: true });
    const ys = extent(points.map((p) => p.y), { includeZero: true });
    const xMax = niceMax(Math.max(1, xs.max));
    const yMax = niceMax(Math.max(1, ys.max));
    const sx = linear(0, xMax, 0, plot.w);
    const sy = linear(0, yMax, plot.h, 0);

    // Quadrant dividers.
    nodes.push(P.shape('div-x', { x: plot.x + plot.w / 2, y: plot.y, w: 2, h: plot.h }, {
      shape: 'rect', fill: 'rgba(255,255,255,.32)', slot: false,
    }));
    nodes.push(P.shape('div-y', { x: plot.x, y: plot.y + plot.h / 2, w: plot.w, h: 2 }, {
      shape: 'rect', fill: 'rgba(255,255,255,.32)', slot: false,
    }));

    const qpos = [
      { x: plot.x + plot.w * 0.04, y: plot.y + plot.h * 0.04, align: 'left', valign: 'top' },
      { x: plot.x + plot.w * 0.54, y: plot.y + plot.h * 0.04, align: 'left', valign: 'top' },
      { x: plot.x + plot.w * 0.04, y: plot.y + plot.h * 0.54, align: 'left', valign: 'top' },
      { x: plot.x + plot.w * 0.54, y: plot.y + plot.h * 0.54, align: 'left', valign: 'top' },
    ];
    quads.slice(0, 4).forEach((q, i) => {
      nodes.push(P.text(`quad-${i}`, { x: qpos[i].x, y: qpos[i].y, w: plot.w * 0.42, h: P.unit * 0.05 }, {
        value: q, size: P.unit * 0.018, weight: 800, font: 'body', color: 'text',
        align: qpos[i].align, valign: qpos[i].valign, opacity: 0.6, caps: true, tracking: 0.10, slot: false,
      }));
    });

    if (spec?.x?.label) {
      nodes.push(P.text('xlabel', { x: plot.x, y: plot.y + plot.h + P.unit * 0.02, w: plot.w, h: P.unit * 0.04 }, {
        value: spec.x.label, size: P.unit * 0.018, weight: 700, font: 'body', color: 'text',
        align: 'center', valign: 'top', opacity: 0.7, caps: true, tracking: 0.08, slot: false,
      }));
    }
    if (spec?.y?.label) {
      nodes.push(P.text('ylabel', { x: body.x, y: plot.y - P.unit * 0.05, w: padL, h: P.unit * 0.04 }, {
        value: spec.y.label, size: P.unit * 0.018, weight: 700, font: 'body', color: 'text',
        align: 'left', valign: 'bottom', opacity: 0.7, caps: true, tracking: 0.08, slot: false,
      }));
    }

    points.forEach((p, i) => {
      const cx = plot.x + sx(Number(p.x));
      const cy = plot.y + sy(Number(p.y));
      const d = Math.min(P.unit * 0.042, plot.h * 0.055);
      const box = { x: cx - d / 2, y: cy - d / 2, w: d, h: d };
      nodes.push(P.group(`point-${i}`, box, {
        children: [
          P.shape(`point-${i}-dot`, box, {
            shape: 'circle', fill: p.tone ?? (i === 0 ? 'surface' : 'blue'), stroke: 'orange', strokeWidth: 3, slot: false,
          }, box),
          P.text(`point-${i}-label`, { x: box.x - plot.w * 0.07, y: box.y + box.h + 4, w: plot.w * 0.14 + box.w, h: P.unit * 0.032 }, {
            value: p.label, size: P.unit * 0.017, weight: 700, font: 'body', color: 'text',
            align: 'center', valign: 'top', slot: false,
          }, box),
        ],
      }));
      build.push([`point-${i}`]);
    });

    return { nodes, build };
  },
};
