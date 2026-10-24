// diagrams/layouts/narrative/pros-cons.mjs — two sides, kept readable.
import { checkLabel, checkCount, MAX_TITLE, MAX_NOTE, playTime } from '../../spec.mjs';
import { titleBlock, itemsOf } from '../_common.mjs';
import { wrapChars } from '../../primitives.mjs';

export default {
  name: 'pros-cons',
  description: 'Advantages and drawbacks side by side',
  frame: 'full',
  fields: ['title', 'pros', 'cons'],

  minDurationFor(n) { return playTime(1.1, 0.3, n); },

  validate(spec) {
    const out = [];
    if (spec?.title != null) checkLabel(spec.title, 'title', out, { max: MAX_TITLE, required: false });
    for (const key of ['pros', 'cons']) {
      const items = itemsOf(spec, key);
      checkCount(items, key, out, 1, 5);
      items.forEach((it, i) => checkLabel(it.label, `${key}[${i}]`, out, { max: MAX_NOTE }));
    }
    return out;
  },

  slots(spec) {
    const out = [];
    if (spec?.title) out.push('title');
    itemsOf(spec, 'pros').forEach((_, i) => out.push(`row-p-${i}`));
    itemsOf(spec, 'cons').forEach((_, i) => out.push(`row-c-${i}`));
    return out;
  },

  build(spec, c, P) {
    const pros = itemsOf(spec, 'pros');
    const cons = itemsOf(spec, 'cons');
    const { node: title, body } = titleBlock(spec, c, P, { ratio: 0.09, landscapeRatio: 0.13 });
    const nodes = [];
    const build = [];
    if (title) { nodes.push(title); build.push(['title']); }

    const gap = (c.landscape ? body.w : body.h) * 0.08;
    const colW = c.landscape ? (body.w - gap) / 2 : body.w;
    const colH = c.landscape ? body.h : (body.h - gap) / 2;
    const columns = [
      { key: 'pros', items: pros, tone: 'ghost', fg: 'text', icon: 'check', iconColor: 'surface', x: body.x, y: body.y },
      { key: 'cons', items: cons, tone: 'ghost', fg: 'text', icon: 'x', iconColor: 'accent', x: c.landscape ? body.x + colW + gap : body.x, y: c.landscape ? body.y : body.y + colH + gap },
    ];

    columns.forEach((col) => {
      const box = { x: col.x, y: col.y, w: colW, h: colH };
      const headH = colH * 0.14;
      nodes.push(P.text(`${col.key}-head`, { x: box.x, y: box.y, w: box.w, h: headH }, {
        value: col.key === 'pros' ? 'Pros' : 'Cons', size: P.unit * 0.022, weight: 800, font: 'display',
        color: col.key === 'pros' ? 'surface' : 'accent', align: 'left', valign: 'center',
        caps: true, tracking: 0.14, slot: false,
      }));
      const rowH = Math.min((colH - headH) / Math.max(1, col.items.length), P.unit * 0.10);
      col.items.forEach((it, i) => {
        const rowBox = { x: box.x, y: box.y + headH + i * rowH, w: box.w, h: rowH * 0.9 };
        const size = P.theme.type.node * P.unit * 0.70;
        nodes.push(P.card(`${col.key === 'pros' ? 'row-p' : 'row-c'}-${i}`, rowBox, {
          tone: col.tone, r: 18, shadow: false,
          children: [
            P.icon(`${col.key}-${i}-icon`, { x: rowBox.x + 12, y: rowBox.y + rowBox.h * 0.28, w: rowBox.h * 0.40, h: rowBox.h * 0.40 }, {
              name: col.icon, size: rowBox.h * 0.40, color: col.iconColor, slot: false,
            }, rowBox),
            P.text(`${col.key}-${i}-t`, { x: rowBox.x + 12 + rowBox.h * 0.52, y: rowBox.y, w: rowBox.w - 24 - rowBox.h * 0.52, h: rowBox.h }, {
              value: it.label, size, weight: 600, font: 'body', color: col.fg,
              align: 'left', valign: 'center', wrap: wrapChars(rowBox.w - 24 - rowBox.h * 0.52, size), maxLines: 2, slot: false,
            }, rowBox),
          ],
        }));
        build.push([`${col.key === 'pros' ? 'row-p' : 'row-c'}-${i}`]);
      });
    });

    return { nodes, build };
  },
};
