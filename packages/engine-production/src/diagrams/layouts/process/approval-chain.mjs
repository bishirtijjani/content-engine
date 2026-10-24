// diagrams/layouts/process/approval-chain.mjs — staged approvals with status.
import { checkLabel, checkCount, MAX_TITLE, MAX_LABEL, playTime } from '../../spec.mjs';
import { titleBlock, itemsOf } from '../_common.mjs';
import { wrapChars } from '../../primitives.mjs';

const STATUS = {
  approved: { tone: 'amber', fg: 'blue', icon: 'circle-check' },
  pending: { tone: 'ghost', fg: 'text', icon: 'clock' },
  rejected: { tone: 'accent', fg: 'text', icon: 'circle-x' },
};

export default {
  name: 'approval-chain',
  description: 'Stages in a chain, each with an owner and a status',
  frame: 'full',
  fields: ['title', 'stages'],

  minDurationFor(n) { return playTime(1.2, 0.4, n); },

  validate(spec) {
    const out = [];
    if (spec?.title != null) checkLabel(spec.title, 'title', out, { max: MAX_TITLE, required: false });
    const stages = itemsOf(spec, 'stages');
    checkCount(stages, 'stages', out, 2, 5);
    stages.forEach((s, i) => {
      checkLabel(s.label, `stages[${i}].label`, out, { max: MAX_LABEL });
      if (s.who != null) checkLabel(s.who, `stages[${i}].who`, out, { max: 24, required: false });
      if (s.status != null && !STATUS[s.status]) out.push(`stages[${i}].status must be approved, pending or rejected`);
    });
    return out;
  },

  slots(spec) {
    const out = [];
    if (spec?.title) out.push('title');
    itemsOf(spec, 'stages').forEach((_, i) => out.push(`stage-${i}`));
    return out;
  },

  build(spec, c, P) {
    const stages = itemsOf(spec, 'stages');
    const n = stages.length;
    const { node: title, body } = titleBlock(spec, c, P, { ratio: 0.10, landscapeRatio: 0.14 });
    const nodes = [];
    const edges = [];
    const build = [];
    if (title) { nodes.push(title); build.push(['title']); }

    const gap = (c.landscape ? body.w : body.h) * 0.10;
    const w = c.landscape ? (body.w - gap * (n - 1)) / n : body.w;
    const h = c.landscape ? Math.min(body.h * 0.70, P.unit * 0.36) : (body.h - gap * (n - 1)) / n;

    stages.forEach((s, i) => {
      const box = c.landscape
        ? { x: body.x + i * (w + gap), y: body.y + (body.h - h) / 2, w, h }
        : { x: body.x, y: body.y + i * (h + gap), w, h };
      const st = STATUS[s.status] ?? STATUS.pending;
      const size = P.theme.type.node * P.unit * 0.76;
      nodes.push(P.card(`stage-${i}`, box, {
        tone: st.tone, r: 28,
        children: [
          P.icon(`stage-${i}-status`, { x: box.x + box.w * 0.06, y: box.y + box.h * 0.08, w: box.h * 0.16, h: box.h * 0.16 }, {
            name: st.icon, size: box.h * 0.16, color: st.fg, slot: false,
          }, box),
          P.text(`stage-${i}-t`, { x: box.x + box.w * 0.06, y: box.y + box.h * 0.28, w: box.w * 0.88, h: box.h * 0.36 }, {
            value: s.label, size, weight: 800, font: 'display', color: st.fg,
            align: 'left', valign: 'center', wrap: wrapChars(box.w * 0.88, size), maxLines: 2, slot: false,
          }, box),
          ...(s.who ? [P.text(`stage-${i}-who`, { x: box.x + box.w * 0.06, y: box.y + box.h * 0.66, w: box.w * 0.88, h: box.h * 0.20 }, {
            value: s.who, size: P.unit * 0.020, weight: 700, font: 'body', color: st.fg,
            align: 'left', valign: 'center', opacity: 0.78, slot: false,
          }, box)] : []),
        ],
      }));
      build.push([`stage-${i}`]);
      if (i < n - 1) {
        const pts = c.landscape
          ? [{ x: box.x + box.w, y: box.y + box.h / 2 }, { x: box.x + box.w + gap, y: box.y + box.h / 2 }]
          : [{ x: box.x + box.w / 2, y: box.y + box.h }, { x: box.x + box.w / 2, y: box.y + box.h + gap }];
        edges.push(P.edge(`link-${i}`, pts, { strokeWidth: 3, slot: false }));
      }
    });

    return { nodes: [...nodes, ...edges], build };
  },
};
