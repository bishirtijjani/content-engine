// diagrams/layouts/charts/stacked-bars.mjs — categories split into series.
import { checkLabel, checkCount, MAX_TITLE, playTime } from '../../spec.mjs';
import { titleBlock } from '../_common.mjs';
import { band, niceMax, linear } from '../../charts/scales.mjs';
import { PALETTE } from '../../charts/palette.mjs';

export default {
  name: 'stacked-bars',
  description: 'Categories split into stacked series, one bar per category',
  frame: 'full',
  fields: ['title', 'categories', 'series'],

  minDurationFor(n) { return playTime(1.2, 0.35, n); },

  validate(spec) {
    const out = [];
    if (spec?.title != null) checkLabel(spec.title, 'title', out, { max: MAX_TITLE, required: false });
    const cats = Array.isArray(spec?.categories) ? spec.categories : [];
    checkCount(cats, 'categories', out, 2, 6);
    cats.forEach((c, i) => checkLabel(typeof c === 'string' ? c : c?.label, `categories[${i}]`, out, { max: 18 }));
    const series = Array.isArray(spec?.series) ? spec.series : [];
    checkCount(series, 'series', out, 1, 4);
    series.forEach((s, i) => {
      checkLabel(s.label, `series[${i}].label`, out, { max: 20, required: false });
      if (!Array.isArray(s.values) || s.values.length !== cats.length) out.push(`series[${i}].values must match categories`);
      else if (s.values.some((v) => !Number.isFinite(Number(v)))) out.push(`series[${i}] has a non-numeric value`);
    });
    return out;
  },

  slots(spec) {
    const cats = Array.isArray(spec?.categories) ? spec.categories : [];
    const series = Array.isArray(spec?.series) ? spec.series : [];
    const out = [];
    if (spec?.title) out.push('title');
    cats.forEach((_, i) => series.forEach((__, j) => out.push(`bar-${i}-${j}`)));
    return out;
  },

  build(spec, c, P) {
    const cats = (spec?.categories ?? []).map((x) => (typeof x === 'string' ? x : x?.label ?? ''));
    const series = Array.isArray(spec?.series) ? spec.series : [];
    const { node: title, body } = titleBlock(spec, c, P, { ratio: 0.09, landscapeRatio: 0.13 });
    const nodes = [];
    const build = [];
    if (title) { nodes.push(title); build.push(['title']); }

    const legendH = body.h * 0.10;
    const padL = body.w * 0.045;
    const padB = body.h * 0.13;
    const plot = { x: body.x + padL, y: body.y + legendH, w: body.w - padL, h: body.h - legendH - padB };

    let lx = body.x;
    series.forEach((s, i) => {
      const tone = s.tone ?? PALETTE[i % PALETTE.length];
      nodes.push(P.shape(`legend-${i}-dot`, { x: lx, y: body.y + legendH * 0.22, w: 14, h: 14 }, {
        shape: 'circle', fill: tone, slot: false,
      }));
      nodes.push(P.text(`legend-${i}`, { x: lx + 22, y: body.y, w: P.unit * 0.18, h: legendH }, {
        value: s.label ?? `Series ${i + 1}`, size: P.unit * 0.021, weight: 700, font: 'body',
        color: 'text', align: 'left', valign: 'center', opacity: 0.85, slot: false,
      }));
      lx += P.unit * 0.20;
    });

    const totals = cats.map((_, i) => series.reduce((n, s) => n + Number(s.values[i] ?? 0), 0));
    const max = niceMax(Math.max(1, ...totals));
    const sy = linear(0, max, 0, plot.h);
    const b = band(cats.length, plot.x, plot.x + plot.w, 0.36);

    nodes.push(P.shape('axis', { x: plot.x, y: plot.y + plot.h, w: plot.w, h: 3 }, {
      shape: 'rect', fill: 'rgba(255,255,255,.45)', slot: false,
    }));

    cats.forEach((cat, i) => {
      const bx = b(i);
      let cum = 0;
      series.forEach((s, j) => {
        const value = Number(s.values[i] ?? 0);
        const h = sy(value);
        const yLocal = plot.h - cum - h;
        const tone = s.tone ?? PALETTE[j % PALETTE.length];
        nodes.push(P.shape(`bar-${i}-${j}`, { x: bx.start, y: plot.y + yLocal, w: bx.size, h }, {
          shape: 'rect', r: 6, fill: tone,
        }));
        build.push([`bar-${i}-${j}`]);
        cum += h;
      });
      nodes.push(P.text(`cat-${i}`, {
        x: plot.x + (plot.w * i) / cats.length, y: plot.y + plot.h + plot.h * 0.04,
        w: plot.w / cats.length, h: plot.h * 0.10,
      }, {
        value: cat, size: P.unit * 0.020, weight: 700, font: 'body', color: 'text',
        align: 'center', valign: 'center', opacity: 0.72, slot: false,
      }));
    });

    return { nodes, build };
  },
};
