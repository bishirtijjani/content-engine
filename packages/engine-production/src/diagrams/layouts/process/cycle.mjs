// diagrams/layouts/process/cycle.mjs — a repeating process on a real circle.
import { checkLabel, checkIcon, checkCount, MAX_TITLE, MAX_NOTE, playTime } from '../../spec.mjs';
import { titleBlock, itemsOf } from '../_common.mjs';

const ICONS = ['refresh', 'settings', 'bolt', 'target', 'chart-line', 'flag'];

export default {
  name: 'cycle',
  description: 'A repeating process arranged on a circle with curved arrows',
  frame: 'full',
  fields: ['title', 'steps', 'active', 'center'],

  minDurationFor(n) { return playTime(1.2, 0.45, n); },

  validate(spec) {
    const out = [];
    if (spec?.title != null) checkLabel(spec.title, 'title', out, { max: MAX_TITLE, required: false });
    if (spec?.center != null) checkLabel(spec.center, 'center', out, { max: MAX_NOTE, required: false });
    const steps = itemsOf(spec, 'steps');
    checkCount(steps, 'steps', out, 3, 6);
    steps.forEach((s, i) => { checkLabel(s.label, `steps[${i}]`, out); checkIcon(s.icon, `steps[${i}]`, out); });
    if (spec?.active != null && !Number.isInteger(spec.active)) out.push('active must be an integer index');
    return out;
  },

  slots(spec) {
    const n = itemsOf(spec, 'steps').length;
    const out = [];
    if (spec?.title) out.push('title');
    if (spec?.center) out.push('center');
    for (let i = 0; i < n; i++) { out.push(`node-${i}`); out.push(`link-${i}`); }
    return out;
  },

  build(spec, c, P) {
    const steps = itemsOf(spec, 'steps');
    const n = steps.length;
    const active = Number.isInteger(spec?.active) ? Math.max(0, Math.min(n - 1, spec.active)) : n - 1;
    const { node: title, body } = titleBlock(spec, c, P, { ratio: 0.10, landscapeRatio: 0.14 });
    const nodes = [];
    const edges = [];
    const build = [];
    if (title) { nodes.push(title); build.push(['title']); }

    const cx = body.x + body.w / 2;
    const cy = body.y + body.h / 2;
    const rx = body.w * 0.33;
    const ry = body.h * 0.34;
    const nodeW = Math.min(body.w * 0.34, P.unit * 0.30);
    const nodeH = Math.min(nodeW * 0.62, body.h * 0.24);
    const angleOf = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const pos = (i) => ({ x: cx + rx * Math.cos(angleOf(i)), y: cy + ry * Math.sin(angleOf(i)) });

    if (spec?.center) {
      const w = Math.min(body.w * 0.34, P.unit * 0.26);
      const h = Math.min(w * 0.42, body.h * 0.16);
      const box = { x: cx - w / 2, y: cy - h / 2, w, h };
      nodes.push(P.card('center', box, {
        tone: 'ink', r: 28,
        children: [P.text('center-t', { x: box.x + 8, y: box.y, w: box.w - 16, h: box.h }, {
          value: spec.center, size: P.theme.type.node * P.unit * 0.82, weight: 800, font: 'display',
          color: 'text', align: 'center', valign: 'center', wrap: 16, maxLines: 2, slot: false,
        }, box)],
      }));
      build.push(['center']);
    }

    for (let i = 0; i < n; i++) {
      const p = pos(i);
      const box = { x: p.x - nodeW / 2, y: p.y - nodeH / 2, w: nodeW, h: nodeH };
      const isActive = i === active;
      const tone = isActive ? 'amber' : 'blue';
      const fg = isActive ? 'blue' : 'text';
      const iconSize = Math.min(nodeH * 0.34, P.unit * 0.045);
      const children = [
        P.icon(`node-${i}-icon`, {
          x: box.x + box.w * 0.06, y: box.y + (box.h - iconSize) / 2, w: iconSize, h: iconSize,
        }, { name: steps[i].icon || ICONS[i % ICONS.length], size: iconSize, color: fg, slot: false }, box),
        P.text(`node-${i}-label`, {
          x: box.x + box.w * 0.06 + iconSize + box.w * 0.045,
          y: box.y, w: box.w * 0.86 - iconSize, h: box.h,
        }, {
          value: steps[i].label, size: P.theme.type.node * P.unit * 0.78, weight: 800, font: 'display',
          color: fg, align: 'left', valign: 'center', wrap: 14, maxLines: 2, slot: false,
        }, box),
      ];
      nodes.push(P.card(`node-${i}`, box, { tone, r: 30, children }));
      build.push([`node-${i}`]);

      // The connector runs outside the ring, between the angular gaps.
      const a0 = angleOf(i) + (2 * Math.PI / n) * 0.16;
      const a1 = angleOf(i) + (2 * Math.PI / n) * 0.84;
      const pts = [];
      for (let k = 0; k <= 6; k++) {
        const a = a0 + (a1 - a0) * (k / 6);
        pts.push({ x: cx + rx * 1.10 * Math.cos(a), y: cy + ry * 1.10 * Math.sin(a) });
      }
      edges.push(P.edge(`link-${i}`, pts, { curve: 'smooth', strokeWidth: 4 }));
      build.push([`link-${i}`]);
    }

    return { nodes: [...nodes, ...edges], build };
  },
};
