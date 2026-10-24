// diagrams/layouts/charts/waterfall.mjs — running totals and deltas.
import { checkLabel, checkCount, MAX_TITLE, playTime } from '../../spec.mjs';
import { titleBlock } from '../_common.mjs';
import { band, niceMax, linear, extent } from '../../charts/scales.mjs';

export default {
  name: 'waterfall',
  description: 'A running total built from additions and subtractions',
  frame: 'full',
  fields: ['title', 'items'],

  minDurationFor(n) { return playTime(1.2, 0.35, n); },

  validate(spec) {
    const out = [];
    if (spec?.title != null) checkLabel(spec.title, 'title', out, { max: MAX_TITLE, required: false });
    const items = Array.isArray(spec?.items) ? spec.items : [];
    checkCount(items, 'items', out, 2, 7);
    items.forEach((it, i) => {
      checkLabel(it?.label, `items[${i}].label`, out, { max: 18 });
      if (it?.type !== 'total' && !Number.isFinite(Number(it?.value))) out.push(`items[${i}].value must be a number`);
      if (it?.type != null && !['start', 'delta', 'total'].includes(it.type)) out.push(`items[${i}].type must be start, delta or total`);
    });
    return out;
  },

  slots(spec) {
    const out = [];
    if (spec?.title) out.push('title');
    (Array.isArray(spec?.items) ? spec.items : []).forEach((_, i) => out.push(`bar-${i}`));
    return out;
  },

  build(spec, c, P) {
    const items = Array.isArray(spec?.items) ? spec.items : [];
    const { node: title, body } = titleBlock(spec, c, P, { ratio: 0.09, landscapeRatio: 0.13 });
    const nodes = [];
    const build = [];
    if (title) { nodes.push(title); build.push(['title']); }

    const padB = body.h * 0.14;
    const plot = { x: body.x + body.w * 0.045, y: body.y + body.h * 0.05, w: body.w - body.w * 0.045, h: body.h - body.h * 0.05 - padB };

    let running = 0;
    const bars = items.map((it) => {
      const value = Number(it.value);
      if (it.type === 'start') { running = value; return { from: 0, to: value, kind: 'start' }; }
      if (it.type === 'total') { return { from: 0, to: running, kind: 'total' }; }
      const from = running;
      running += value;
      return { from, to: running, kind: value >= 0 ? 'up' : 'down' };
    });

    const ex = extent(bars.flatMap((b) => [b.from, b.to, 0]));
    const min = Math.min(0, ex.min);
    const max = niceMax(Math.max(1, ex.max));
    const sy = linear(min, max, plot.h, 0);
    const b = band(items.length, plot.x, plot.x + plot.w, 0.34);

    nodes.push(P.shape('axis', { x: plot.x, y: plot.y + sy(0), w: plot.w, h: 3 }, {
      shape: 'rect', fill: 'rgba(255,255,255,.45)', slot: false,
    }));

    bars.forEach((bar, i) => {
      const bx = b(i);
      const y = Math.min(sy(bar.from), sy(bar.to));
      const h = Math.max(4, Math.abs(sy(bar.to) - sy(bar.from)));
      const tone = bar.kind === 'total' ? 'surface' : bar.kind === 'down' ? 'accent' : bar.kind === 'start' ? 'text' : 'blue';
      nodes.push(P.shape(`bar-${i}`, { x: bx.start, y: plot.y + y, w: bx.size, h }, {
        shape: 'rect', r: 6, fill: tone,
      }));
      build.push([`bar-${i}`]);

      if (i < bars.length - 1) {
        const next = b(i + 1);
        const cy = plot.y + sy(bar.to);
        nodes.push(P.shape(`link-${i}`, { x: bx.start + bx.size, y: cy - 1, w: next.start - (bx.start + bx.size), h: 2 }, {
          shape: 'rect', fill: 'rgba(255,255,255,.32)', slot: false,
        }));
      }

      nodes.push(P.text(`label-${i}`, {
        x: plot.x + (plot.w * i) / items.length, y: plot.y + plot.h + plot.h * 0.03,
        w: plot.w / items.length, h: plot.h * 0.10,
      }, {
        value: items[i].label, size: P.unit * 0.019, weight: 700, font: 'body', color: 'text',
        align: 'center', valign: 'center', opacity: 0.72, slot: false,
      }));
      nodes.push(P.text(`value-${i}`, {
        x: plot.x + (plot.w * i) / items.length, y: y + plot.y - P.unit * 0.038,
        w: plot.w / items.length, h: P.unit * 0.034,
      }, {
        value: String(items[i].value), size: P.unit * 0.019, weight: 800, font: 'display', color: 'text',
        align: 'center', valign: 'bottom', slot: false,
      }));
    });

    return { nodes, build };
  },
};
