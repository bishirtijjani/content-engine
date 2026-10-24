// diagrams/layouts/narrative/balance.mjs — two weights against each other.
import { checkLabel, MAX_TITLE, MAX_NOTE, playTime } from '../../spec.mjs';
import { titleBlock } from '../_common.mjs';
import { wrapChars } from '../../primitives.mjs';

export default {
  name: 'balance',
  description: 'Two sides weighed against each other, with a verdict',
  frame: 'full',
  fields: ['title', 'left', 'right', 'verdict'],

  minDurationFor() { return 2.2; },

  validate(spec) {
    const out = [];
    if (spec?.title != null) checkLabel(spec.title, 'title', out, { max: MAX_TITLE, required: false });
    for (const key of ['left', 'right']) {
      const side = spec?.[key];
      if (!side || typeof side !== 'object') { out.push(`${key} must be an object {label, weight}`); continue; }
      checkLabel(side.label, `${key}.label`, out, { max: MAX_NOTE });
      if (!Number.isFinite(Number(side.weight)) || Number(side.weight) <= 0) out.push(`${key}.weight must be positive`);
    }
    if (spec?.verdict != null) checkLabel(spec.verdict, 'verdict', out, { max: MAX_NOTE, required: false });
    return out;
  },

  slots(spec) {
    const out = [];
    if (spec?.title) out.push('title');
    out.push('beam', 'pan-left', 'pan-right');
    if (spec?.verdict) out.push('verdict');
    return out;
  },

  build(spec, c, P) {
    const { node: title, body } = titleBlock(spec, c, P, { ratio: 0.09, landscapeRatio: 0.13 });
    const nodes = [];
    const build = [];
    if (title) { nodes.push(title); build.push(['title']); }

    const lw = Number(spec?.left?.weight ?? 1);
    const rw = Number(spec?.right?.weight ?? 1);
    const tilt = Math.max(-0.08, Math.min(0.08, (rw - lw) / (lw + rw) * 0.10));
    const cx = body.x + body.w / 2;
    const beamY = body.y + body.h * 0.40;
    const panW = Math.min(body.w * 0.34, P.unit * 0.36);
    const panH = Math.min(body.h * 0.22, P.unit * 0.18);
    const leftX = body.x + body.w * 0.04;
    const rightX = body.x + body.w * 0.96 - panW;
    const leftY = beamY + body.h * tilt;
    const rightY = beamY - body.h * tilt;

    nodes.push(P.shape('beam', { x: body.x + body.w * 0.06, y: beamY - 4, w: body.w * 0.88, h: 8 }, {
      shape: 'line', x1: 0, y1: 0.5 + tilt * 2.2, x2: 1, y2: 0.5 - tilt * 2.2,
      stroke: 'text', strokeWidth: 8,
    }));
    build.push(['beam']);

    nodes.push(P.shape('fulcrum', { x: cx - body.w * 0.05, y: beamY, w: body.w * 0.10, h: body.h * 0.18 }, {
      shape: 'polygon', points: [{ x: 0.5, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
      fill: 'surface', slot: false,
    }));

    const pan = (id, x, y, side, tone, fg) => {
      const box = { x, y, w: panW, h: panH };
      const size = P.theme.type.node * P.unit * 0.76;
      nodes.push(P.card(id, box, {
        tone, r: 26,
        children: [
          P.text(`${id}-t`, { x: box.x + 14, y: box.y, w: box.w - 28, h: box.h * 0.64 }, {
            value: side.label, size, weight: 800, font: 'display', color: fg,
            align: 'center', valign: 'center', wrap: wrapChars(box.w - 28, size), maxLines: 2, slot: false,
          }, box),
          P.text(`${id}-w`, { x: box.x + 14, y: box.y + box.h * 0.64, w: box.w - 28, h: box.h * 0.28 }, {
            value: String(side.weight), size: size * 0.86, weight: 900, font: 'display', color: fg,
            align: 'center', valign: 'center', opacity: 0.82, slot: false,
          }, box),
        ],
      }));
      build.push([id]);
    };

    pan('pan-left', leftX, leftY, spec.left, 'ghost', 'text');
    pan('pan-right', rightX, rightY, spec.right, 'amber', 'blue');

    if (spec?.verdict) {
      nodes.push(P.text('verdict', { x: body.x, y: body.y + body.h * 0.82, w: body.w, h: body.h * 0.10 }, {
        value: spec.verdict, size: P.theme.type.node * P.unit * 0.74, weight: 800, font: 'display',
        color: 'text', align: 'center', valign: 'center',
      }));
      build.push(['verdict']);
    }

    return { nodes, build };
  },
};
