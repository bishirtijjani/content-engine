// diagrams/layouts/structure/matrix.mjs — a 2x2 matrix of quadrants.
import { checkLabel, checkCount, MAX_TITLE, MAX_LABEL, MAX_NOTE, playTime } from '../../spec.mjs';
import { titleBlock, itemsOf } from '../_common.mjs';
import { wrapChars } from '../../primitives.mjs';

export default {
  name: 'matrix',
  description: 'A two-by-two matrix with items in each quadrant',
  frame: 'full',
  fields: ['title', 'x', 'y', 'quadrants'],

  minDurationFor(n) { return playTime(1.2, 0.35, n); },

  validate(spec) {
    const out = [];
    if (spec?.title != null) checkLabel(spec.title, 'title', out, { max: MAX_TITLE, required: false });
    const quads = Array.isArray(spec?.quadrants) ? spec.quadrants : [];
    checkCount(quads, 'quadrants', out, 4, 4);
    quads.forEach((q, i) => {
      checkLabel(q?.label, `quadrants[${i}].label`, out, { max: MAX_LABEL });
      (itemsOf(q, 'items')).forEach((it, j) => checkLabel(it.label, `quadrants[${i}].items[${j}]`, out, { max: 20 }));
    });
    for (const axis of ['x', 'y']) {
      if (spec?.[axis]?.label != null) checkLabel(spec[axis].label, `${axis}.label`, out, { max: MAX_NOTE, required: false });
    }
    return out;
  },

  slots(spec) {
    const out = [];
    if (spec?.title) out.push('title');
    (Array.isArray(spec?.quadrants) ? spec.quadrants : []).forEach((_, i) => out.push(`quadrant-${i}`));
    return out;
  },

  build(spec, c, P) {
    const quads = Array.isArray(spec?.quadrants) ? spec.quadrants : [];
    const { node: title, body } = titleBlock(spec, c, P, { ratio: 0.08, landscapeRatio: 0.12 });
    const nodes = [];
    const build = [];
    if (title) { nodes.push(title); build.push(['title']); }

    const axisW = body.w * 0.07;
    const axisH = body.h * 0.07;
    const grid = { x: body.x + axisW, y: body.y + axisH, w: body.w - axisW, h: body.h - axisH };
    const gap = Math.min(grid.w, grid.h) * 0.02;
    const qw = (grid.w - gap) / 2;
    const qh = (grid.h - gap) / 2;

    const axisLabel = (id, box, value, align, valign) => {
      if (!value) return;
      nodes.push(P.text(id, box, {
        value, size: P.unit * 0.019, weight: 700, font: 'body', color: 'text',
        align, valign, opacity: 0.7, caps: true, tracking: 0.08, slot: false,
      }));
    };
    axisLabel('x-label', { x: grid.x + grid.w * 0.25, y: body.y, w: grid.w * 0.50, h: axisH }, spec?.x?.label, 'center', 'center');
    axisLabel('x-low', { x: grid.x, y: body.y, w: grid.w * 0.25, h: axisH }, spec?.x?.low, 'left', 'center');
    axisLabel('x-high', { x: grid.x + grid.w * 0.75, y: body.y, w: grid.w * 0.25, h: axisH }, spec?.x?.high, 'right', 'center');
    axisLabel('y-label', { x: body.x, y: grid.y + grid.h * 0.25, w: axisW, h: grid.h * 0.50 }, spec?.y?.label, 'center', 'center');
    axisLabel('y-low', { x: body.x, y: grid.y, w: axisW, h: grid.h * 0.25 }, spec?.y?.low, 'center', 'top');
    axisLabel('y-high', { x: body.x, y: grid.y + grid.h * 0.75, w: axisW, h: grid.h * 0.25 }, spec?.y?.high, 'center', 'bottom');

    quads.forEach((q, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const box = { x: grid.x + col * (qw + gap), y: grid.y + row * (qh + gap), w: qw, h: qh };
      const tone = q.tone ?? (i === 0 ? 'amber' : 'ghost');
      const fg = tone === 'amber' ? 'blue' : 'text';
      const items = itemsOf(q, 'items');
      const content = P.cardContent(box, {
        header: q.label,
        rows: items.map((it) => ({ left: it.label })),
      }, {
        id: `quadrant-${i}`, fg, mode: 'list',
        headerSize: P.theme.type.node * P.unit * 0.66,
        rowSize: P.unit * 0.021,
        bullet: true,
      });
      nodes.push(P.card(`quadrant-${i}`, box, { tone, r: 24, children: content.children, meta: content.meta }));
      build.push([`quadrant-${i}`]);
    });

    return { nodes, build };
  },
};
