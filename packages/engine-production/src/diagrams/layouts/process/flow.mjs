// diagrams/layouts/process/flow.mjs — steps joined by arrows, one highlighted.
//
// Portrait: steps stack top to bottom, arrows down.
// Landscape: steps run left to right, arrows across.
// One spec, one slot set, both orientations.
import { checkLabel, checkIcon, checkCount, textOf, listOf, MAX_TITLE, playTime } from '../../spec.mjs';
import { wrapChars } from '../../primitives.mjs';

const STEP_ICONS = ['circle-check', 'settings', 'bolt', 'arrow-right', 'flag'];

export default {
  name: 'flow',
  description: 'Steps joined by arrows, revealed in order with one step highlighted',
  frame: 'full',
  fields: ['title', 'steps', 'active'],

  minDurationFor(n) {
    return playTime(1.0, 0.45, n);
  },

  validate(spec) {
    const out = [];
    if (spec?.title != null) checkLabel(spec.title, 'title', out, { max: MAX_TITLE, required: false });
    const steps = listOf(spec?.steps);
    checkCount(steps, 'steps', out, 2, 5);
    steps.forEach((s, i) => {
      checkLabel(textOf(s), `steps[${i}]`, out);
      checkIcon(s?.icon, `steps[${i}]`, out);
    });
    if (spec?.active != null && !Number.isInteger(spec.active)) out.push('active must be an integer index');
    return out;
  },

  slots(spec) {
    const n = listOf(spec?.steps).length;
    const out = [];
    if (spec?.title) out.push('title');
    for (let i = 0; i < n; i++) {
      out.push(`node-${i}`);
      if (i < n - 1) out.push(`link-${i}`);
    }
    return out;
  },

  build(spec, c, P) {
    const steps = listOf(spec?.steps).map((s, i) => ({
      label: textOf(s),
      icon: (s && typeof s === 'object' && s.icon) || STEP_ICONS[i % STEP_ICONS.length],
    }));
    const n = steps.length;
    const active = Number.isInteger(spec?.active) ? Math.max(0, Math.min(n - 1, spec.active)) : n - 1;
    const f = c;
    const nodes = [];
    const edges = [];
    const build = [];

    let body = { x: f.x, y: f.y, w: f.w, h: f.h };
    if (spec?.title) {
      const titleH = f.h * (f.landscape ? 0.16 : 0.12);
      nodes.push(P.text('title', { x: f.x, y: f.y, w: f.w, h: titleH }, {
        value: spec.title,
        size: P.theme.type.title * P.unit * (f.landscape ? 0.50 : 0.56),
        weight: 900, font: 'display', align: 'center', valign: 'center',
      }));
      build.push(['title']);
      body = { x: f.x, y: f.y + titleH, w: f.w, h: f.h - titleH };
    }

    const gapRatio = n <= 3 ? 0.12 : 0.08;
    const gap = (f.landscape ? body.w : body.h) * gapRatio;
    const cardW = f.landscape ? (body.w - gap * (n - 1)) / n : body.w;
    const cardH = f.landscape ? Math.min(body.h * 0.62, P.unit * 0.30) : (body.h - gap * (n - 1)) / n;
    const startX = f.landscape ? body.x : body.x;
    const startY = f.landscape ? body.y + (body.h - cardH) / 2 : body.y;

    for (let i = 0; i < n; i++) {
      const box = f.landscape
        ? { x: startX + i * (cardW + gap), y: startY, w: cardW, h: cardH }
        : { x: body.x, y: startY + i * (cardH + gap), w: cardW, h: cardH };
      const isActive = i === active;
      const cardTone = isActive ? 'amber' : 'blue';
      const fg = isActive ? 'blue' : 'text';
      const children = [];

      if (isActive) {
        children.push(P.shape(`node-${i}-ring`, { x: box.x + 2, y: box.y + 2, w: box.w - 4, h: box.h - 4 }, {
          shape: 'roundRect', r: 36, fill: 'none', stroke: 'orange', strokeWidth: 6, slot: false,
        }, box));
      }

      const labelSize = P.theme.type.node * P.unit * (f.landscape ? 0.84 : 1);
      const content = P.cardContent(box, { icon: steps[i].icon, label: steps[i].label }, {
        id: `node-${i}`,
        fg,
        mode: 'auto',
        labelSize,
        trailing: f.landscape ? 0 : 0.07,
      });
      children.push(...content.children);

      const stepNo = P.text(`node-${i}-no`, {
        x: box.x + box.w - box.w * 0.075,
        y: box.y + box.h * 0.08,
        w: box.w * 0.055,
        h: box.h * 0.22,
      }, {
        value: String(i + 1),
        size: labelSize * 0.62,
        weight: 900,
        font: 'display',
        color: fg,
        align: 'center',
        valign: 'center',
        opacity: 0.55,
        slot: false,
      }, box);
      children.push(stepNo);

      nodes.push(P.card(`node-${i}`, box, { tone: cardTone, r: 36, children, meta: content.meta }));
      build.push([`node-${i}`]);

      if (i < n - 1) {
        const pts = f.landscape
          ? [{ x: box.x + box.w, y: box.y + box.h / 2 }, { x: box.x + box.w + gap, y: box.y + box.h / 2 }]
          : [{ x: box.x + box.w / 2, y: box.y + box.h }, { x: box.x + box.w / 2, y: box.y + box.h + gap }];
        edges.push(P.edge(`link-${i}`, pts, { arrowSize: Math.round(P.unit * 0.024), strokeWidth: 4 }));
        build.push([`link-${i}`]);
      }
    }

    return { nodes: [...nodes, ...edges], build };
  },
};
