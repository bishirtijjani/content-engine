// diagrams/layouts/charts/heatmap.mjs — a matrix of values.
import { checkLabel, checkCount, MAX_TITLE, playTime } from '../../spec.mjs';
import { titleBlock } from '../_common.mjs';

export default {
  name: 'heatmap',
  description: 'A matrix of values, intensity carrying the number',
  frame: 'full',
  fields: ['title', 'rows', 'cols', 'values'],

  minDurationFor(n) { return playTime(1.0, 0.2, n); },

  validate(spec) {
    const out = [];
    if (spec?.title != null) checkLabel(spec.title, 'title', out, { max: MAX_TITLE, required: false });
    const rows = Array.isArray(spec?.rows) ? spec.rows : [];
    const cols = Array.isArray(spec?.cols) ? spec.cols : [];
    checkCount(rows, 'rows', out, 2, 7);
    checkCount(cols, 'cols', out, 2, 7);
    rows.forEach((r, i) => checkLabel(typeof r === 'string' ? r : r?.label, `rows[${i}]`, out, { max: 18 }));
    cols.forEach((c, i) => checkLabel(typeof c === 'string' ? c : c?.label, `cols[${i}]`, out, { max: 18 }));
    const values = Array.isArray(spec?.values) ? spec.values : [];
    if (values.length !== rows.length) out.push('values must have one row per rows entry');
    values.forEach((r, i) => {
      if (!Array.isArray(r) || r.length !== cols.length) out.push(`values[${i}] must have one cell per column`);
      else if (r.some((v) => !Number.isFinite(Number(v)))) out.push(`values[${i}] has a non-numeric cell`);
    });
    return out;
  },

  slots(spec) {
    const rows = Array.isArray(spec?.rows) ? spec.rows : [];
    const cols = Array.isArray(spec?.cols) ? spec.cols : [];
    const out = [];
    if (spec?.title) out.push('title');
    rows.forEach((_, i) => cols.forEach((__, j) => out.push(`cell-${i}-${j}`)));
    return out;
  },

  build(spec, c, P) {
    const rows = (spec?.rows ?? []).map((r) => (typeof r === 'string' ? r : r?.label ?? ''));
    const cols = (spec?.cols ?? []).map((r) => (typeof r === 'string' ? r : r?.label ?? ''));
    const values = Array.isArray(spec?.values) ? spec.values : [];
    const { node: title, body } = titleBlock(spec, c, P, { ratio: 0.09, landscapeRatio: 0.13 });
    const nodes = [];
    const build = [];
    if (title) { nodes.push(title); build.push(['title']); }

    const labelW = body.w * 0.20;
    const headH = body.h * 0.09;
    const grid = { x: body.x + labelW, y: body.y + headH, w: body.w - labelW, h: body.h - headH };
    const cw = grid.w / cols.length;
    const ch = grid.h / rows.length;
    const max = Math.max(1, ...values.flat().map(Number));

    cols.forEach((label, j) => {
      nodes.push(P.text(`col-${j}`, { x: grid.x + j * cw, y: body.y, w: cw, h: headH }, {
        value: label, size: P.unit * 0.019, weight: 700, font: 'body', color: 'text',
        align: 'center', valign: 'center', opacity: 0.72, slot: false,
      }));
    });

    rows.forEach((label, i) => {
      nodes.push(P.text(`row-${i}`, { x: body.x, y: grid.y + i * ch, w: labelW * 0.92, h: ch }, {
        value: label, size: P.unit * 0.019, weight: 700, font: 'body', color: 'text',
        align: 'right', valign: 'center', opacity: 0.72, slot: false,
      }));
      cols.forEach((_, j) => {
        const v = Number(values[i]?.[j] ?? 0);
        const r = Math.max(0, Math.min(1, v / max));
        const box = { x: grid.x + j * cw + 3, y: grid.y + i * ch + 3, w: cw - 6, h: ch - 6 };
        nodes.push(P.shape(`cell-${i}-${j}`, box, {
          shape: 'rect', r: 10, fill: 'surface', opacity: Math.round((0.14 + r * 0.86) * 100) / 100,
        }));
        nodes.push(P.text(`cell-${i}-${j}-t`, box, {
          value: String(v), size: P.unit * 0.021, weight: 800, font: 'display',
          color: r > 0.55 ? 'blue' : 'text', align: 'center', valign: 'center', slot: false,
        }));
        build.push([`cell-${i}-${j}`]);
      });
    });

    return { nodes, build };
  },
};
