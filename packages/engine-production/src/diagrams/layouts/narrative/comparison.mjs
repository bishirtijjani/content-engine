// diagrams/layouts/narrative/comparison.mjs — two or three alternatives.
import { checkLabel, checkCount, MAX_TITLE, MAX_NOTE, playTime } from '../../spec.mjs';
import { titleBlock, itemsOf, pill } from '../_common.mjs';
import { wrapChars } from '../../primitives.mjs';

export default {
  name: 'comparison',
  description: 'Two or three alternatives compared as panels, one highlighted',
  frame: 'full',
  fields: ['title', 'columns', 'highlight'],

  minDurationFor(n) { return playTime(1.1, 0.5, n); },

  validate(spec) {
    const out = [];
    if (spec?.title != null) checkLabel(spec.title, 'title', out, { max: MAX_TITLE, required: false });
    const cols = itemsOf(spec, 'columns');
    checkCount(cols, 'columns', out, 2, 3);
    cols.forEach((c, i) => {
      checkLabel(c.label, `columns[${i}].label`, out, { max: MAX_NOTE });
      if (c.points != null && !Array.isArray(c.points)) out.push(`columns[${i}].points must be an array`);
      itemsOf(c, 'points').forEach((p, j) => checkLabel(p.label, `columns[${i}].points[${j}]`, out, { max: 34 }));
    });
    if (spec?.highlight != null && !Number.isInteger(spec.highlight)) out.push('highlight must be an integer index');
    return out;
  },

  slots(spec) {
    const n = itemsOf(spec, 'columns').length;
    const out = [];
    if (spec?.title) out.push('title');
    for (let i = 0; i < n; i++) out.push(`col-${i}`);
    return out;
  },

  build(spec, c, P) {
    const cols = itemsOf(spec, 'columns');
    const n = cols.length;
    const highlight = Number.isInteger(spec?.highlight) ? Math.max(0, Math.min(n - 1, spec.highlight)) : -1;
    const { node: title, body } = titleBlock(spec, c, P, { ratio: 0.11, landscapeRatio: 0.15 });
    const nodes = [];
    const build = [];
    if (title) { nodes.push(title); build.push(['title']); }

    const gap = (c.landscape ? body.w : body.h) * 0.10;
    const colW = c.landscape ? (body.w - gap * (n - 1)) / n : body.w;
    const colH = c.landscape ? body.h : (body.h - gap * (n - 1)) / n;

    for (let i = 0; i < n; i++) {
      const box = c.landscape
        ? { x: body.x + i * (colW + gap), y: body.y, w: colW, h: colH }
        : { x: body.x, y: body.y + i * (colH + gap), w: colW, h: colH };
      const hot = i === highlight;
      const tone = hot ? 'amber' : 'ghost';
      const fg = hot ? 'blue' : 'text';
      const headSize = P.theme.type.node * P.unit * 0.98;
      const children = [
        P.text(`col-${i}-label`, { x: box.x + box.w * 0.07, y: box.y + box.h * 0.07, w: box.w * 0.86, h: box.h * 0.16 }, {
          value: cols[i].label, size: headSize, weight: 900, font: 'display', color: fg,
          align: 'left', valign: 'center', wrap: wrapChars(box.w * 0.86, headSize), maxLines: 2, slot: false,
        }, box),
      ];
      const size = P.theme.type.node * P.unit * 0.74;
      const rowH = Math.min(box.h * 0.13, P.unit * 0.062);
      const startY = box.y + box.h * 0.28;
      itemsOf(cols[i], 'points').forEach((p, j) => {
        const y = startY + j * rowH;
        if (y + rowH > box.y + box.h * 0.95) return;
        children.push(P.icon(`col-${i}-tick-${j}`, { x: box.x + box.w * 0.07, y: y + rowH * 0.22, w: rowH * 0.56, h: rowH * 0.56 }, {
          name: 'check', size: rowH * 0.56, color: hot ? 'blue' : 'surface', slot: false,
        }, box));
        children.push(P.text(`col-${i}-point-${j}`, { x: box.x + box.w * 0.07 + rowH * 0.72, y, w: box.w * 0.86 - rowH * 0.72, h: rowH }, {
          value: p.label, size, weight: 600, font: 'body', color: fg,
          align: 'left', valign: 'center', wrap: wrapChars(box.w * 0.86 - rowH * 0.72, size), maxLines: 2, slot: false,
        }, box));
      });
      nodes.push(P.card(`col-${i}`, box, { tone, r: 34, children }));
      build.push([`col-${i}`]);
    }

    if (n === 2) {
      const gapBox = c.landscape
        ? { x: body.x + colW + gap * 0.22, y: body.y + body.h / 2 - P.unit * 0.032, w: gap * 0.56, h: P.unit * 0.064 }
        : { x: body.x + body.w / 2 - P.unit * 0.05, y: body.y + colH + gap * 0.22, w: P.unit * 0.10, h: P.unit * 0.064 };
      nodes.push(pill(P, 'vs', gapBox, 'VS', { size: P.unit * 0.020, tone: 'accent', color: 'text', slot: false }));
    }

    return { nodes, build };
  },
};
