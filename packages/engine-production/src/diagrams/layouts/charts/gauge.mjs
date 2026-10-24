// diagrams/layouts/charts/gauge.mjs — one value against a range.
import { checkLabel, MAX_TITLE, MAX_NOTE } from '../../spec.mjs';
import { titleBlock } from '../_common.mjs';

export default {
  name: 'gauge',
  description: 'A single value against its range, on an arc',
  frame: 'full',
  fields: ['title', 'value', 'min', 'max', 'unit'],

  minDurationFor() { return 2.0; },

  validate(spec) {
    const out = [];
    if (spec?.title != null) checkLabel(spec.title, 'title', out, { max: MAX_TITLE, required: false });
    const value = Number(spec?.value);
    if (!Number.isFinite(value)) out.push('value must be a number');
    const min = Number(spec?.min ?? 0);
    const max = Number(spec?.max ?? 100);
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) out.push('max must be greater than min');
    if (Number.isFinite(value) && (value < min || value > max)) out.push('value must sit between min and max');
    if (spec?.unit != null) checkLabel(String(spec.unit), 'unit', out, { max: 12, required: false });
    if (spec?.label != null) checkLabel(spec.label, 'label', out, { max: MAX_NOTE, required: false });
    return out;
  },

  slots(spec) {
    const out = [];
    if (spec?.title) out.push('title');
    out.push('arc-fill', 'needle', 'value');
    return out;
  },

  build(spec, c, P) {
    const { node: title, body } = titleBlock(spec, c, P, { ratio: 0.09, landscapeRatio: 0.13 });
    const nodes = [];
    const build = [];
    if (title) { nodes.push(title); build.push(['title']); }

    const min = Number(spec?.min ?? 0);
    const max = Number(spec?.max ?? 100);
    const value = Number(spec?.value);
    const ratio = Math.max(0, Math.min(1, (value - min) / (max - min)));
    const side = Math.min(body.w * 0.72, body.h * 0.58);
    const box = { x: body.x + (body.w - side) / 2, y: body.y + body.h * 0.05, w: side, h: side };

    nodes.push(P.shape('arc-bg', box, {
      shape: 'donut', inner: 0.72, startAngle: 180, endAngle: 360,
      fill: 'rgba(255,255,255,.16)', slot: false,
    }));
    nodes.push(P.shape('arc-fill', box, {
      shape: 'donut', inner: 0.72, startAngle: 180, endAngle: 180 + 180 * ratio,
      fill: 'surface',
    }));
    build.push(['arc-fill']);

    const a = ((180 + 180 * ratio) * Math.PI) / 180;
    const nx = 0.5 + 0.40 * Math.cos(a);
    const ny = 0.5 + 0.40 * Math.sin(a);
    nodes.push(P.shape('needle', box, {
      shape: 'line', x1: 0.5, y1: 0.5, x2: nx, y2: ny,
      stroke: 'text', strokeWidth: 8,
    }));
    build.push(['needle']);

    const valueSize = P.theme.type.data * P.unit * 0.34;
    nodes.push(P.text('value', {
      x: box.x + box.w * 0.14, y: box.y + box.h * 0.50, w: box.w * 0.72, h: box.h * 0.26,
    }, {
      value: `${value}${spec?.unit ? ` ${spec.unit}` : ''}`, size: valueSize, weight: 900, font: 'display',
      color: 'text', align: 'center', valign: 'center',
    }));
    build.push(['value']);

    if (spec?.label) {
      nodes.push(P.text('label', {
        x: box.x + box.w * 0.10, y: box.y + box.h * 0.76, w: box.w * 0.80, h: box.h * 0.14,
      }, {
        value: spec.label, size: P.unit * 0.024, weight: 700, font: 'body', color: 'text',
        align: 'center', valign: 'center', opacity: 0.78, slot: false,
      }));
    }
    nodes.push(P.text('range', {
      x: box.x, y: box.y + box.h * 0.94, w: box.w, h: box.h * 0.08,
    }, {
      value: `${min}  —  ${max}`, size: P.unit * 0.018, weight: 700, font: 'mono', color: 'text',
      align: 'center', valign: 'center', opacity: 0.55, slot: false,
    }));

    return { nodes, build };
  },
};
