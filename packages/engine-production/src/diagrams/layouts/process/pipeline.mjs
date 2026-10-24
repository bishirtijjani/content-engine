// diagrams/layouts/process/pipeline.mjs — stages with a progress rail.
import { checkLabel, checkIcon, checkCount, MAX_TITLE, playTime } from '../../spec.mjs';
import { titleBlock, itemsOf, bottom, top } from '../_common.mjs';
import { wrapChars } from '../../primitives.mjs';

const ICONS = ['circle-dot', 'settings', 'bolt', 'package', 'flag'];

export default {
  name: 'pipeline',
  description: 'Stages progressing start to finish, with a progress rail',
  frame: 'full',
  fields: ['title', 'steps', 'progress'],

  minDurationFor(n) { return playTime(1.1, 0.45, n); },

  validate(spec) {
    const out = [];
    if (spec?.title != null) checkLabel(spec.title, 'title', out, { max: MAX_TITLE, required: false });
    const steps = itemsOf(spec, 'steps');
    checkCount(steps, 'steps', out, 2, 5);
    steps.forEach((s, i) => { checkLabel(s.label, `steps[${i}]`, out); checkIcon(s.icon, `steps[${i}]`, out); });
    if (spec?.progress != null && !Number.isInteger(spec.progress)) out.push('progress must be an integer index');
    return out;
  },

  slots(spec) {
    const n = itemsOf(spec, 'steps').length;
    const out = [];
    if (spec?.title) out.push('title');
    for (let i = 0; i < n; i++) {
      out.push(`node-${i}`);
      if (i < n - 1) out.push(`link-${i}`);
      out.push(`rail-${i}`);
    }
    return out;
  },

  build(spec, c, P) {
    const steps = itemsOf(spec, 'steps');
    const n = steps.length;
    const progress = Number.isInteger(spec?.progress) ? Math.max(0, Math.min(n - 1, spec.progress)) : n - 1;
    const { node: title, body } = titleBlock(spec, c, P);
    const nodes = [];
    const edges = [];
    const build = [];
    if (title) { nodes.push(title); build.push(['title']); }

    const railH = body.h * (c.landscape ? 0.10 : 0.055);
    const rail = { x: body.x, y: body.y + body.h - railH, w: body.w, h: railH };
    const cards = { x: body.x, y: body.y, w: body.w, h: body.h - railH - body.h * 0.03 };

    const gap = (c.landscape ? cards.w : cards.h) * 0.10;
    const cardW = c.landscape ? (cards.w - gap * (n - 1)) / n : cards.w;
    const cardH = c.landscape ? cards.h * 0.86 : (cards.h - gap * (n - 1)) / n;

    for (let i = 0; i < n; i++) {
      const box = c.landscape
        ? { x: cards.x + i * (cardW + gap), y: cards.y, w: cardW, h: cardH }
        : { x: cards.x, y: cards.y + i * (cardH + gap), w: cardW, h: cardH };
      const done = i <= progress;
      const tone = done ? (i === progress ? 'amber' : 'blue') : 'ghost';
      const fg = tone === 'amber' ? 'blue' : 'text';
      const content = P.cardContent(box, {
        icon: steps[i].icon || ICONS[i % ICONS.length],
        label: steps[i].label,
      }, {
        id: `node-${i}`, fg, mode: 'auto',
        labelSize: P.theme.type.node * P.unit * (c.landscape ? 0.84 : 1),
      });
      nodes.push(P.card(`node-${i}`, box, { tone, children: content.children, meta: content.meta }));
      build.push([`node-${i}`]);
      if (i < n - 1) {
        const pts = c.landscape
          ? [{ x: box.x + box.w, y: box.y + box.h / 2 }, { x: box.x + box.w + gap, y: box.y + box.h / 2 }]
          : [bottom(box), top({ x: box.x, y: box.y + box.h + gap, w: box.w, h: 0 })];
        edges.push(P.edge(`link-${i}`, pts, { strokeWidth: 4 }));
        build.push([`link-${i}`]);
      }
    }

    // The rail: one segment per stage, filled to the progress index.
    const segGap = rail.w * 0.012;
    const segW = (rail.w - segGap * (n - 1)) / n;
    for (let i = 0; i < n; i++) {
      const box = { x: rail.x + i * (segW + segGap), y: rail.y, w: segW, h: rail.h };
      const on = i <= progress;
      nodes.push(P.shape(`rail-${i}`, box, {
        shape: 'rect', r: rail.h / 2, fill: on ? (i === progress ? 'surface' : 'blue') : 'rgba(255,255,255,.18)',
      }));
      build.push([`rail-${i}`]);
    }

    return { nodes: [...nodes, ...edges], build };
  },
};
