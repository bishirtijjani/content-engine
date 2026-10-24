// diagrams/layouts/time/before-after.mjs — a transformation between two states.
import { checkLabel, MAX_TITLE, MAX_NOTE } from '../../spec.mjs';
import { titleBlock, itemsOf } from '../_common.mjs';
import { wrapChars } from '../../primitives.mjs';

export default {
  name: 'before-after',
  description: 'A transformation: a before state and an after state, joined by an arrow',
  frame: 'full',
  fields: ['title', 'before', 'after'],

  minDurationFor() { return 2.0; },

  validate(spec) {
    const out = [];
    if (spec?.title != null) checkLabel(spec.title, 'title', out, { max: MAX_TITLE, required: false });
    for (const key of ['before', 'after']) {
      const panel = spec?.[key];
      if (!panel || typeof panel !== 'object') { out.push(`${key} must be an object {label, points}`); continue; }
      checkLabel(panel.label, `${key}.label`, out, { max: MAX_NOTE });
      if (panel.points != null && !Array.isArray(panel.points)) out.push(`${key}.points must be an array`);
      itemsOf(panel, 'points').forEach((p, i) => checkLabel(p.label, `${key}.points[${i}]`, out, { max: 36 }));
    }
    return out;
  },

  slots(spec) {
    const out = [];
    if (spec?.title) out.push('title');
    out.push('panel-before', 'arrow', 'panel-after');
    return out;
  },

  build(spec, c, P) {
    const { node: title, body } = titleBlock(spec, c, P, { ratio: 0.11, landscapeRatio: 0.15 });
    const nodes = [];
    const build = [];
    if (title) { nodes.push(title); build.push(['title']); }

    const gap = (c.landscape ? body.w : body.h) * 0.14;
    const panelW = c.landscape ? (body.w - gap) / 2 : body.w;
    const panelH = c.landscape ? body.h : (body.h - gap) / 2;
    const beforeBox = c.landscape ? { x: body.x, y: body.y, w: panelW, h: panelH } : { x: body.x, y: body.y, w: panelW, h: panelH };
    const afterBox = c.landscape
      ? { x: body.x + panelW + gap, y: body.y, w: panelW, h: panelH }
      : { x: body.x, y: body.y + panelH + gap, w: panelW, h: panelH };

    const panel = (id, box, data, tone) => {
      const children = [];
      const headSize = P.theme.type.node * P.unit * 1.02;
      children.push(P.text(`${id}-label`, { x: box.x + box.w * 0.07, y: box.y + box.h * 0.08, w: box.w * 0.86, h: box.h * 0.18 }, {
        value: data.label, size: headSize, weight: 900, font: 'display', color: tone === 'amber' ? 'blue' : 'text',
        align: 'left', valign: 'center', wrap: wrapChars(box.w * 0.86, headSize), maxLines: 2, slot: false,
      }, box));
      const points = itemsOf(data, 'points');
      const size = P.theme.type.node * P.unit * 0.78;
      const rowH = Math.min(box.h * 0.16, P.unit * 0.075);
      const startY = box.y + box.h * 0.32;
      points.forEach((p, i) => {
        const y = startY + i * rowH;
        if (y + rowH > box.y + box.h * 0.94) return;
        children.push(P.shape(`${id}-dot-${i}`, { x: box.x + box.w * 0.07, y: y + rowH * 0.42, w: 12, h: 12 }, {
          shape: 'circle', fill: tone === 'amber' ? 'blue' : 'surface', slot: false,
        }, box));
        children.push(P.text(`${id}-point-${i}`, { x: box.x + box.w * 0.07 + 26, y, w: box.w * 0.84 - 26, h: rowH }, {
          value: p.label, size, weight: 600, font: 'body', color: tone === 'amber' ? 'blue' : 'text',
          align: 'left', valign: 'center', wrap: wrapChars(box.w * 0.84 - 26, size), maxLines: 2, slot: false,
        }, box));
      });
      nodes.push(P.card(id, box, { tone, r: 36, children }));
    };

    panel('panel-before', beforeBox, spec?.before ?? {}, 'ghost');
    build.push(['panel-before']);

    const pts = c.landscape
      ? [{ x: beforeBox.x + beforeBox.w + gap * 0.15, y: body.y + body.h / 2 }, { x: afterBox.x - gap * 0.15, y: body.y + body.h / 2 }]
      : [{ x: body.x + body.w / 2, y: beforeBox.y + beforeBox.h + gap * 0.15 }, { x: body.x + body.w / 2, y: afterBox.y - gap * 0.15 }];
    nodes.push(P.edge('arrow', pts, { arrowSize: Math.round(P.unit * 0.045), strokeWidth: 7, stroke: 'text' }));
    build.push(['arrow']);

    panel('panel-after', afterBox, spec?.after ?? {}, 'amber');
    build.push(['panel-after']);

    return { nodes, build };
  },
};
