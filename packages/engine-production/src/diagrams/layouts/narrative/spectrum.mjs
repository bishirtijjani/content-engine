// diagrams/layouts/narrative/spectrum.mjs — markers along a scale.
import { checkLabel, checkCount, MAX_TITLE, MAX_NOTE, playTime } from '../../spec.mjs';
import { titleBlock } from '../_common.mjs';
import { wrapChars } from '../../primitives.mjs';

export default {
  name: 'spectrum',
  description: 'A scale with low and high ends and markers along it',
  frame: 'full',
  fields: ['title', 'low', 'high', 'markers'],

  minDurationFor(n) { return playTime(1.1, 0.3, n); },

  validate(spec) {
    const out = [];
    if (spec?.title != null) checkLabel(spec.title, 'title', out, { max: MAX_TITLE, required: false });
    checkLabel(spec?.low, 'low', out, { max: 20 });
    checkLabel(spec?.high, 'high', out, { max: 20 });
    const markers = Array.isArray(spec?.markers) ? spec.markers : [];
    checkCount(markers, 'markers', out, 1, 5);
    markers.forEach((m, i) => {
      checkLabel(m?.label, `markers[${i}].label`, out, { max: MAX_NOTE });
      const p = Number(m?.position);
      if (!Number.isFinite(p) || p < 0 || p > 1) out.push(`markers[${i}].position must be between 0 and 1`);
    });
    return out;
  },

  slots(spec) {
    const out = [];
    if (spec?.title) out.push('title');
    (Array.isArray(spec?.markers) ? spec.markers : []).forEach((_, i) => out.push(`marker-${i}`));
    return out;
  },

  build(spec, c, P) {
    const markers = Array.isArray(spec?.markers) ? spec.markers : [];
    const { node: title, body } = titleBlock(spec, c, P, { ratio: 0.09, landscapeRatio: 0.13 });
    const nodes = [];
    const build = [];
    if (title) { nodes.push(title); build.push(['title']); }

    const axisY = body.y + body.h * 0.58;
    nodes.push(P.shape('axis', { x: body.x, y: axisY - 3, w: body.w, h: 6 }, {
      shape: 'rect', r: 3, fill: 'rgba(255,255,255,.35)', slot: false,
    }));
    nodes.push(P.text('low', { x: body.x, y: axisY + body.h * 0.06, w: body.w * 0.3, h: body.h * 0.08 }, {
      value: spec.low, size: P.unit * 0.020, weight: 700, font: 'body', color: 'text',
      align: 'left', valign: 'center', opacity: 0.7, caps: true, tracking: 0.10, slot: false,
    }));
    nodes.push(P.text('high', { x: body.x + body.w * 0.70, y: axisY + body.h * 0.06, w: body.w * 0.30, h: body.h * 0.08 }, {
      value: spec.high, size: P.unit * 0.020, weight: 700, font: 'body', color: 'text',
      align: 'right', valign: 'center', opacity: 0.7, caps: true, tracking: 0.10, slot: false,
    }));

    markers.forEach((m, i) => {
      const x = body.x + body.w * Number(m.position);
      nodes.push(P.shape(`marker-${i}-tick`, { x: x - 2, y: axisY - body.h * 0.05, w: 4, h: body.h * 0.10 }, {
        shape: 'rect', fill: 'text', slot: false,
      }));
      const w = Math.min(body.w * 0.30, P.unit * 0.34);
      const h = body.h * 0.14;
      const box = { x: Math.max(body.x, Math.min(body.x + body.w - w, x - w / 2)), y: axisY - body.h * 0.05 - h - body.h * 0.02, w, h };
      const size = P.theme.type.node * P.unit * 0.66;
      nodes.push(P.card(`marker-${i}`, box, {
        tone: i === 0 ? 'amber' : 'blue', r: 18,
        children: [P.text(`marker-${i}-t`, { x: box.x + 10, y: box.y, w: box.w - 20, h: box.h }, {
          value: m.label, size, weight: 700, font: 'display', color: i === 0 ? 'blue' : 'text',
          align: 'center', valign: 'center', wrap: wrapChars(box.w - 20, size), maxLines: 2, slot: false,
        }, box)],
      }));
      build.push([`marker-${i}`]);
    });

    return { nodes, build };
  },
};
