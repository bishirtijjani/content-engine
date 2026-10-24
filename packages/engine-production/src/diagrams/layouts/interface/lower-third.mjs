// diagrams/layouts/interface/lower-third.mjs — a name and role plate.
import { checkLabel, MAX_NOTE } from '../../spec.mjs';
import { titleBlock } from '../_common.mjs';

export default {
  name: 'lower-third',
  description: 'A lower-third name and role plate',
  frame: 'full',
  fields: ['name', 'role'],

  minDurationFor() { return 1.8; },

  validate(spec) {
    const out = [];
    checkLabel(spec?.name, 'name', out, { max: MAX_NOTE });
    checkLabel(spec?.role, 'role', out, { max: MAX_NOTE });
    return out;
  },

  slots() { return ['name', 'role']; },

  build(spec, c, P) {
    const { node: title, body } = titleBlock(spec, c, P, { ratio: 0.08, landscapeRatio: 0.12 });
    const nodes = [];
    const build = [];
    if (title) nodes.push(title);

    const h = Math.min(body.h * 0.18, P.unit * 0.16);
    const w = Math.min(body.w * 0.72, P.unit * 0.66);
    const box = { x: body.x, y: body.y + body.h * 0.64, w, h };
    nodes.push(P.card('plate', box, {
      tone: 'ink', r: 20, slot: false,
      children: [
        P.shape('plate-accent', { x: box.x, y: box.y, w: 8, h: box.h }, {
          shape: 'rect', fill: 'accent', slot: false,
        }, box),
        P.text('name', { x: box.x + 26, y: box.y + box.h * 0.10, w: box.w - 44, h: box.h * 0.48 }, {
          value: spec.name, size: P.theme.type.node * P.unit * 0.90, weight: 900, font: 'display',
          color: 'text', align: 'left', valign: 'center',
        }, box),
        P.text('role', { x: box.x + 26, y: box.y + box.h * 0.56, w: box.w - 44, h: box.h * 0.34 }, {
          value: spec.role, size: P.unit * 0.022, weight: 700, font: 'body',
          color: 'surface', align: 'left', valign: 'center', caps: true, tracking: 0.10,
        }, box),
      ],
    }));
    build.push(['name']);
    build.push(['role']);

    return { nodes, build };
  },
};
