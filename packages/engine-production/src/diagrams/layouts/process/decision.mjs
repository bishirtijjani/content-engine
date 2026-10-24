// diagrams/layouts/process/decision.mjs — a question and two branching outcomes.
import { checkLabel, MAX_TITLE, MAX_NOTE, playTime } from '../../spec.mjs';
import { titleBlock, itemsOf } from '../_common.mjs';
import { wrapChars } from '../../primitives.mjs';

function side(spec, key) {
  const v = spec?.[key];
  if (typeof v === 'string') return { label: v };
  if (v && typeof v === 'object') return { ...v, label: v.label ?? v.text ?? '' };
  return { label: '' };
}

export default {
  name: 'decision',
  description: 'A decision with a Yes and a No branch leading to outcomes',
  frame: 'full',
  fields: ['title', 'question', 'yes', 'no', 'yesLabel', 'noLabel'],

  minDurationFor() { return 2.2; },

  validate(spec) {
    const out = [];
    if (spec?.title != null) checkLabel(spec.title, 'title', out, { max: MAX_TITLE, required: false });
    checkLabel(spec?.question, 'question', out, { max: MAX_NOTE });
    for (const key of ['yes', 'no']) {
      const s = side(spec, key);
      checkLabel(s.label, key, out, { max: MAX_NOTE });
      itemsOf(s, 'points').forEach((p, i) => checkLabel(p.label, `${key}.points[${i}]`, out, { max: 34 }));
    }
    for (const key of ['yesLabel', 'noLabel']) {
      if (spec?.[key] != null) checkLabel(spec[key], key, out, { max: 18, required: false });
    }
    return out;
  },

  slots(spec) {
    const out = [];
    if (spec?.title) out.push('title');
    out.push('question', 'branch-yes', 'branch-no');
    return out;
  },

  build(spec, c, P) {
    const { node: title, body } = titleBlock(spec, c, P, { ratio: 0.10, landscapeRatio: 0.14 });
    const nodes = [];
    const build = [];
    if (title) { nodes.push(title); build.push(['title']); }

    const qSize = P.theme.type.node * P.unit * 1.06;
    const branch = (id, data, label, tone, box) => {
      const children = [];
      children.push(P.text(`${id}-head`, { x: box.x + box.w * 0.08, y: box.y + box.h * 0.10, w: box.w * 0.84, h: box.h * 0.22 }, {
        value: label, size: P.unit * 0.022, weight: 800, font: 'body', color: tone === 'amber' ? 'blue' : 'surface',
        align: 'left', valign: 'center', caps: true, tracking: 0.16, slot: false,
      }, box));
      children.push(P.text(`${id}-label`, { x: box.x + box.w * 0.08, y: box.y + box.h * 0.32, w: box.w * 0.84, h: box.h * 0.28 }, {
        value: data.label, size: P.theme.type.node * P.unit * 0.94, weight: 800, font: 'display',
        color: tone === 'amber' ? 'blue' : 'text', align: 'left', valign: 'center',
        wrap: wrapChars(box.w * 0.84, P.theme.type.node * P.unit * 0.94), maxLines: 2, slot: false,
      }, box));
      const size = P.theme.type.node * P.unit * 0.72;
      itemsOf(data, 'points').forEach((p, j) => {
        const y = box.y + box.h * 0.64 + j * box.h * 0.14;
        if (y + box.h * 0.12 > box.y + box.h * 0.95) return;
        children.push(P.text(`${id}-point-${j}`, { x: box.x + box.w * 0.08, y, w: box.w * 0.84, h: box.h * 0.12 }, {
          value: `· ${p.label}`, size, weight: 600, font: 'body',
          color: tone === 'amber' ? 'blue' : 'text', align: 'left', valign: 'center', slot: false,
        }, box));
      });
      nodes.push(P.card(id, box, { tone, r: 34, children }));
      build.push([id]);
    };

    if (c.landscape) {
      const qW = body.w * 0.44;
      const qBox = { x: body.x, y: body.y + body.h * 0.12, w: qW, h: body.h * 0.62 };
      nodes.push(P.card('question', qBox, {
        tone: 'blue', r: 40,
        children: [
          P.icon('question-icon', { x: qBox.x + qBox.w * 0.08, y: qBox.y + qBox.h * 0.10, w: qBox.h * 0.14, h: qBox.h * 0.14 }, {
            name: 'help-circle', size: qBox.h * 0.14, color: 'surface', slot: false,
          }, qBox),
          P.text('question-t', { x: qBox.x + qBox.w * 0.08, y: qBox.y + qBox.h * 0.30, w: qBox.w * 0.84, h: qBox.h * 0.56 }, {
            value: spec.question, size: qSize, weight: 900, font: 'display', color: 'text',
            align: 'left', valign: 'center', wrap: wrapChars(qBox.w * 0.84, qSize), maxLines: 3, slot: false,
          }, qBox),
        ],
      }));
      build.push(['question']);

      const bx = body.x + body.w * 0.52;
      const bw = body.w * 0.48;
      const bh = body.h * 0.38;
      const gap = body.h * 0.08;
      branch('branch-yes', side(spec, 'yes'), spec?.yesLabel ?? 'Yes', 'amber', { x: bx, y: body.y + body.h * 0.10, w: bw, h: bh });
      branch('branch-no', side(spec, 'no'), spec?.noLabel ?? 'No', 'ghost', { x: bx, y: body.y + body.h * 0.10 + bh + gap, w: bw, h: bh });

      nodes.push(P.edge('edge-yes', [
        { x: qBox.x + qBox.w, y: qBox.y + qBox.h * 0.45 },
        { x: bx, y: body.y + body.h * 0.10 + bh / 2 },
      ], { curve: 'smooth', strokeWidth: 4, slot: false }));
      nodes.push(P.edge('edge-no', [
        { x: qBox.x + qBox.w * 0.55, y: qBox.y + qBox.h },
        { x: bx, y: body.y + body.h * 0.10 + bh + gap + bh / 2 },
      ], { curve: 'smooth', strokeWidth: 4, slot: false }));
    } else {
      const qBox = { x: body.x, y: body.y, w: body.w, h: body.h * 0.30 };
      nodes.push(P.card('question', qBox, {
        tone: 'blue', r: 40,
        children: [
          P.icon('question-icon', { x: qBox.x + qBox.w * 0.06, y: qBox.y + qBox.h * 0.10, w: qBox.h * 0.16, h: qBox.h * 0.16 }, {
            name: 'help-circle', size: qBox.h * 0.16, color: 'surface', slot: false,
          }, qBox),
          P.text('question-t', { x: qBox.x + qBox.w * 0.06, y: qBox.y + qBox.h * 0.30, w: qBox.w * 0.88, h: qBox.h * 0.60 }, {
            value: spec.question, size: qSize, weight: 900, font: 'display', color: 'text',
            align: 'left', valign: 'center', wrap: wrapChars(qBox.w * 0.88, qSize), maxLines: 2, slot: false,
          }, qBox),
        ],
      }));
      build.push(['question']);

      const gap = body.w * 0.06;
      const bw = (body.w - gap) / 2;
      const bh = body.h * 0.46;
      const by = body.y + body.h * 0.40;
      branch('branch-yes', side(spec, 'yes'), spec?.yesLabel ?? 'Yes', 'amber', { x: body.x, y: by, w: bw, h: bh });
      branch('branch-no', side(spec, 'no'), spec?.noLabel ?? 'No', 'ghost', { x: body.x + bw + gap, y: by, w: bw, h: bh });

      nodes.push(P.edge('edge-yes', [
        { x: qBox.x + qBox.w * 0.30, y: qBox.y + qBox.h },
        { x: body.x + bw / 2, y: by },
      ], { strokeWidth: 4, slot: false }));
      nodes.push(P.edge('edge-no', [
        { x: qBox.x + qBox.w * 0.70, y: qBox.y + qBox.h },
        { x: body.x + bw + gap + bw / 2, y: by },
      ], { strokeWidth: 4, slot: false }));
    }

    return { nodes: [...nodes], build };
  },
};
