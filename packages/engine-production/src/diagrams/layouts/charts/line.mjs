// diagrams/layouts/charts/line.mjs — line and area charts.
import { checkLabel, checkCount, MAX_TITLE, playTime } from '../../spec.mjs';
import { titleBlock } from '../_common.mjs';
import { linear, niceMax, linePath, areaPath } from '../../charts/scales.mjs';

const PALETTE = ['surface', 'text', 'accent', 'blue'];

function valuesOf(series) {
  if (Array.isArray(series?.values)) return series.values.map((v) => Number(typeof v === 'object' ? v.value ?? v.y : v));
  if (Array.isArray(series?.points)) return series.points.map((p) => Number(typeof p === 'object' ? p.value ?? p.y : p));
  return [];
}

export function makeLineLayout({ name, area = false }) {
  return {
    name,
    description: area ? 'A trend over categories, filled to the baseline' : 'A trend over categories, one line per series',
    frame: 'full',
    fields: ['title', 'x', 'series', 'valueLabels'],

    minDurationFor(n) { return playTime(1.2, 0.35, n); },

    validate(spec) {
      const out = [];
      if (spec?.title != null) checkLabel(spec.title, 'title', out, { max: MAX_TITLE, required: false });
      const series = Array.isArray(spec?.series) ? spec.series : [];
      checkCount(series, 'series', out, 1, 4);
      series.forEach((s, i) => {
        checkLabel(s.label, `series[${i}].label`, out, { max: 24, required: false });
        const v = valuesOf(s);
        if (v.length < 2 || v.length > 10) out.push(`series[${i}] needs 2-10 values`);
        if (v.some((x) => !Number.isFinite(x))) out.push(`series[${i}] has a non-numeric value`);
      });
      const labels = Array.isArray(spec?.x?.labels) ? spec.x.labels : [];
      if (labels.length && series.length && labels.length !== valuesOf(series[0]).length) {
        out.push('x.labels must match the series length');
      }
      return out;
    },

    slots(spec) {
      const out = [];
      if (spec?.title) out.push('title');
      (Array.isArray(spec?.series) ? spec.series : []).forEach((_, i) => out.push(`series-${i}`));
      return out;
    },

    build(spec, c, P) {
      const series = Array.isArray(spec?.series) ? spec.series : [];
      const { node: title, body } = titleBlock(spec, c, P, { ratio: 0.09, landscapeRatio: 0.13 });
      const nodes = [];
      const build = [];
      if (title) { nodes.push(title); build.push(['title']); }

      const legendH = body.h * 0.10;
      const padL = body.w * 0.095;
      const padB = body.h * 0.14;
      const padT = body.h * 0.04;
      const plot = {
        x: body.x + padL,
        y: body.y + legendH + padT,
        w: body.w - padL,
        h: body.h - legendH - padT - padB,
      };

      const all = series.flatMap(valuesOf);
      const max = niceMax(Math.max(1, ...all));
      const min = Math.min(0, ...all);
      const yScale = linear(min, max, 0, plot.h);
      const count = Math.max(...series.map((s) => valuesOf(s).length), 2);

      // Legend (static).
      let lx = body.x;
      series.forEach((s, i) => {
        const tone = PALETTE[i % PALETTE.length];
        const w = Math.min(body.w * 0.28, P.unit * 0.20);
        nodes.push(P.shape(`legend-dot-${i}`, { x: lx, y: body.y + legendH * 0.20, w: 14, h: 14 }, {
          shape: 'circle', fill: tone, slot: false,
        }));
        nodes.push(P.text(`legend-${i}`, { x: lx + 22, y: body.y, w: w - 22, h: legendH }, {
          value: s.label ?? `Series ${i + 1}`, size: P.unit * 0.022, weight: 700, font: 'body',
          color: 'text', align: 'left', valign: 'center', opacity: 0.86, slot: false,
        }));
        lx += w;
      });

      // Grid + axis + category labels (static chrome).
      for (let k = 0; k <= 3; k++) {
        const gy = plot.y + (plot.h * k) / 3;
        nodes.push(P.shape(`grid-${k}`, { x: plot.x, y: gy, w: plot.w, h: 2 }, {
          shape: 'rect', fill: k === 3 ? 'rgba(255,255,255,.42)' : 'rgba(255,255,255,.16)', slot: false,
        }));
        nodes.push(P.text(`ylab-${k}`, { x: body.x, y: gy - P.unit * 0.018, w: padL * 0.85, h: P.unit * 0.036 }, {
          value: String(Math.round(max - ((max - min) * k) / 3)), size: P.unit * 0.019, weight: 600, font: 'mono',
          color: 'text', align: 'right', valign: 'center', opacity: 0.55, slot: false,
        }));
      }
      const labels = Array.isArray(spec?.x?.labels) ? spec.x.labels : [];
      for (let i = 0; i < count; i++) {
        const cxLocal = count === 1 ? 0.5 : i / (count - 1);
        nodes.push(P.text(`xlab-${i}`, {
          x: plot.x + plot.w * cxLocal - plot.w / count / 2,
          y: plot.y + plot.h + plot.h * 0.06,
          w: plot.w / count,
          h: plot.h * 0.12,
        }, {
          value: String(labels[i] ?? i + 1), size: P.unit * 0.019, weight: 600, font: 'body',
          color: 'text', align: 'center', valign: 'center', opacity: 0.62, slot: false,
        }));
      }

      series.forEach((s, si) => {
        const vals = valuesOf(s);
        const tone = PALETTE[si % PALETTE.length];
        const color = P.col(tone);
        const pts = vals.map((v, i) => ({
          x: (count === 1 ? 0.5 : i / (count - 1)) * plot.w,
          y: plot.h - yScale(v),
        }));
        const children = [];
        if (area) {
          children.push(P.shape(`series-${si}-area`, plot, {
            shape: 'path', d: areaPath(pts, plot.h), fill: 'blue', opacity: 0.30, slot: false,
          }, plot));
        }
        children.push(P.shape(`series-${si}-line`, plot, {
          shape: 'path', d: linePath(pts), fill: 'none', stroke: color, strokeWidth: 5, slot: false,
        }, plot));
        pts.forEach((p, i) => {
          children.push(P.shape(`series-${si}-dot-${i}`, { x: plot.x + p.x - 7, y: plot.y + p.y - 7, w: 14, h: 14 }, {
            shape: 'circle', fill: color, stroke: 'orange', strokeWidth: 3, slot: false,
          }, plot));
          if (spec?.valueLabels) {
            children.push(P.text(`series-${si}-val-${i}`, {
              x: plot.x + p.x - plot.w / count / 2, y: plot.y + p.y - P.unit * 0.042, w: plot.w / count, h: P.unit * 0.038,
            }, {
              value: String(vals[i]), size: P.unit * 0.019, weight: 800, font: 'display',
              color: 'text', align: 'center', valign: 'bottom', slot: false,
            }, plot));
          }
        });
        nodes.push(P.group(`series-${si}`, plot, { children }));
        build.push([`series-${si}`]);
      });

      return { nodes, build };
    },
  };
}
