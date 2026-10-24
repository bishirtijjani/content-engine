// diagrams/layouts/time/journey-map.mjs — stages crossed with rows of experience.
import { checkLabel, checkCount, MAX_TITLE, MAX_LABEL, MAX_NOTE, playTime } from '../../spec.mjs';
import { titleBlock } from '../_common.mjs';
import { wrapChars } from '../../primitives.mjs';

export default {
  name: 'journey-map',
  description: 'Stages across, experience rows down',
  frame: 'full',
  fields: ['title', 'stages', 'rows'],

  minDurationFor(n) { return playTime(1.2, 0.3, n); },

  validate(spec) {
    const out = [];
    if (spec?.title != null) checkLabel(spec.title, 'title', out, { max: MAX_TITLE, required: false });
    const stages = Array.isArray(spec?.stages) ? spec.stages : [];
    checkCount(stages, 'stages', out, 2, 5);
    stages.forEach((s, i) => checkLabel(typeof s === 'string' ? s : s?.label, `stages[${i}]`, out, { max: MAX_LABEL }));
    const rows = Array.isArray(spec?.rows) ? spec.rows : [];
    checkCount(rows, 'rows', out, 2, 4);
    rows.forEach((r, i) => {
      checkLabel(r?.label, `rows[${i}].label`, out, { max: 18 });
      if (!Array.isArray(r.values) || r.values.length !== stages.length) out.push(`rows[${i}].values must match stages`);
      else r.values.forEach((v, j) => checkLabel(String(v), `rows[${i}].values[${j}]`, out, { max: MAX_NOTE }));
    });
    return out;
  },

  slots(spec) {
    const out = [];
    if (spec?.title) out.push('title');
    const stages = Array.isArray(spec?.stages) ? spec.stages : [];
    const rows = Array.isArray(spec?.rows) ? spec.rows : [];
    stages.forEach((_, i) => out.push(`stage-${i}`));
    rows.forEach((_, i) => stages.forEach((__, j) => out.push(`cell-${i}-${j}`)));
    return out;
  },

  build(spec, c, P) {
    const stages = (Array.isArray(spec?.stages) ? spec.stages : []).map((s) => (typeof s === 'string' ? s : s?.label ?? ''));
    const rows = Array.isArray(spec?.rows) ? spec.rows : [];
    const { node: title, body } = titleBlock(spec, c, P, { ratio: 0.08, landscapeRatio: 0.12 });
    const nodes = [];
    const build = [];
    if (title) { nodes.push(title); build.push(['title']); }

    const labelW = body.w * 0.18;
    const headH = body.h * 0.13;
    const rowH = (body.h - headH) / rows.length;
    const colW = (body.w - labelW) / stages.length;

    stages.forEach((s, i) => {
      const box = { x: body.x + labelW + i * colW, y: body.y, w: colW, h: headH };
      const size = P.theme.type.node * P.unit * 0.62;
      nodes.push(P.card(`stage-${i}`, box, {
        tone: 'amber', r: 18,
        children: [P.text(`stage-${i}-t`, { x: box.x + 8, y: box.y, w: box.w - 16, h: box.h }, {
          value: s, size, weight: 800, font: 'display', color: 'blue',
          align: 'center', valign: 'center', wrap: wrapChars(box.w - 16, size), maxLines: 2, slot: false,
        }, box)],
      }));
      build.push([`stage-${i}`]);
    });

    rows.forEach((row, i) => {
      const y = body.y + headH + i * rowH;
      nodes.push(P.text(`row-${i}`, { x: body.x, y, w: labelW * 0.92, h: rowH }, {
        value: row.label, size: P.unit * 0.018, weight: 700, font: 'body', color: 'text',
        align: 'left', valign: 'center', opacity: 0.7, caps: true, tracking: 0.08, slot: false,
      }));
      stages.forEach((_, j) => {
        const box = { x: body.x + labelW + j * colW + 3, y: y + 3, w: colW - 6, h: rowH - 6 };
        const size = P.unit * 0.0165;
        nodes.push(P.card(`cell-${i}-${j}`, box, {
          tone: i % 2 ? 'ghost' : 'ink', r: 14, shadow: false,
          children: [P.text(`cell-${i}-${j}-t`, { x: box.x + 8, y: box.y, w: box.w - 16, h: box.h }, {
            value: String(row.values[j] ?? ''), size, weight: 600, font: 'body', color: 'text',
            align: 'left', valign: 'center', wrap: wrapChars(box.w - 16, size), maxLines: 3, slot: false,
          }, box)],
        }));
        build.push([`cell-${i}-${j}`]);
      });
    });

    return { nodes, build };
  },
};
