// diagrams/layouts/time/gantt.mjs — tasks on a shared time axis.
import { checkLabel, checkCount, MAX_TITLE, MAX_LABEL, playTime } from '../../spec.mjs';
import { titleBlock } from '../_common.mjs';
import { linear, extent, niceMax } from '../../charts/scales.mjs';
import { wrapChars } from '../../primitives.mjs';

export default {
  name: 'gantt',
  description: 'Tasks as bars on a shared time axis',
  frame: 'full',
  fields: ['title', 'tasks'],

  minDurationFor(n) { return playTime(1.1, 0.3, n); },

  validate(spec) {
    const out = [];
    if (spec?.title != null) checkLabel(spec.title, 'title', out, { max: MAX_TITLE, required: false });
    const tasks = Array.isArray(spec?.tasks) ? spec.tasks : [];
    checkCount(tasks, 'tasks', out, 2, 8);
    tasks.forEach((t, i) => {
      checkLabel(t?.label, `tasks[${i}].label`, out, { max: 22 });
      if (!Number.isFinite(Number(t?.start)) || !Number.isFinite(Number(t?.end)) || Number(t.end) <= Number(t.start)) {
        out.push(`tasks[${i}] needs start < end`);
      }
    });
    return out;
  },

  slots(spec) {
    const out = [];
    if (spec?.title) out.push('title');
    (Array.isArray(spec?.tasks) ? spec.tasks : []).forEach((_, i) => out.push(`row-${i}`));
    return out;
  },

  build(spec, c, P) {
    const tasks = Array.isArray(spec?.tasks) ? spec.tasks : [];
    const { node: title, body } = titleBlock(spec, c, P, { ratio: 0.09, landscapeRatio: 0.13 });
    const nodes = [];
    const build = [];
    if (title) { nodes.push(title); build.push(['title']); }

    const labelW = body.w * 0.26;
    const tickH = body.h * 0.08;
    const plot = { x: body.x + labelW, y: body.y + tickH, w: body.w - labelW, h: body.h - tickH };
    const ex = extent(tasks.flatMap((t) => [Number(t.start), Number(t.end)]));
    const max = niceMax(Math.max(1, ex.max));
    const sx = linear(0, max, 0, plot.w);
    const rowH = plot.h / tasks.length;

    for (let k = 0; k <= 4; k++) {
      const v = (max * k) / 4;
      const x = plot.x + sx(v);
      nodes.push(P.shape(`tick-${k}`, { x, y: plot.y - tickH * 0.18, w: 2, h: plot.h + tickH * 0.18 }, {
        shape: 'rect', fill: k === 0 ? 'rgba(255,255,255,.42)' : 'rgba(255,255,255,.14)', slot: false,
      }));
      nodes.push(P.text(`ticklab-${k}`, { x: x - plot.w * 0.06, y: body.y, w: plot.w * 0.12, h: tickH * 0.8 }, {
        value: String(Math.round(v)), size: P.unit * 0.017, weight: 600, font: 'mono',
        color: 'text', align: 'center', valign: 'center', opacity: 0.55, slot: false,
      }));
    }

    tasks.forEach((t, i) => {
      const y = plot.y + i * rowH;
      const box = { x: body.x, y, w: body.w, h: rowH };
      const barX = plot.x + sx(Number(t.start));
      const barW = Math.max(6, sx(Number(t.end) - Number(t.start)));
      const children = [
        P.text(`row-${i}-label`, { x: box.x, y: box.y, w: labelW * 0.94, h: rowH }, {
          value: t.label, size: P.unit * 0.019, weight: 700, font: 'body', color: 'text',
          align: 'left', valign: 'center', wrap: wrapChars(labelW * 0.94, P.unit * 0.019), maxLines: 1, slot: false,
        }, box),
        P.shape(`row-${i}-bar`, { x: barX, y: box.y + rowH * 0.28, w: barW, h: rowH * 0.40 }, {
          shape: 'rect', r: rowH * 0.20, fill: i === 0 ? 'surface' : 'blue', slot: false,
        }, box),
      ];
      if (t.owner) {
        children.push(P.text(`row-${i}-owner`, { x: barX + barW + 8, y: box.y, w: plot.w * 0.2, h: rowH }, {
          value: t.owner, size: P.unit * 0.015, weight: 700, font: 'body', color: 'text',
          align: 'left', valign: 'center', opacity: 0.6, slot: false,
        }, box));
      }
      nodes.push(P.group(`row-${i}`, box, { children }));
      build.push([`row-${i}`]);
    });

    return { nodes, build };
  },
};
