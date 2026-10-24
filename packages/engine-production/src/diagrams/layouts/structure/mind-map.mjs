// diagrams/layouts/structure/mind-map.mjs — a centre with branches and leaves.
import { checkLabel, checkCount, MAX_TITLE, MAX_LABEL, playTime } from '../../spec.mjs';
import { titleBlock } from '../_common.mjs';
import { wrapChars } from '../../primitives.mjs';

export default {
  name: 'mind-map',
  description: 'A central idea with branches and their leaves',
  frame: 'full',
  fields: ['title', 'center', 'branches'],

  minDurationFor(n) { return playTime(1.2, 0.4, n); },

  validate(spec) {
    const out = [];
    if (spec?.title != null) checkLabel(spec.title, 'title', out, { max: MAX_TITLE, required: false });
    checkLabel(spec?.center, 'center', out, { max: MAX_LABEL });
    const branches = Array.isArray(spec?.branches) ? spec.branches : [];
    checkCount(branches, 'branches', out, 2, 5);
    branches.forEach((b, i) => {
      checkLabel(b?.label, `branches[${i}].label`, out, { max: MAX_LABEL });
      const leaves = Array.isArray(b?.children) ? b.children : [];
      if (leaves.length > 4) out.push(`branches[${i}] has too many children (max 4)`);
      leaves.forEach((l, j) => checkLabel(typeof l === 'string' ? l : l?.label, `branches[${i}].children[${j}]`, out, { max: 20 }));
    });
    return out;
  },

  slots(spec) {
    const out = [];
    if (spec?.title) out.push('title');
    out.push('center');
    const branches = Array.isArray(spec?.branches) ? spec.branches : [];
    branches.forEach((b, i) => {
      out.push(`branch-${i}`);
      (Array.isArray(b?.children) ? b.children : []).forEach((_, j) => out.push(`leaf-${i}-${j}`));
    });
    return out;
  },

  build(spec, c, P) {
    const branches = Array.isArray(spec?.branches) ? spec.branches : [];
    const { node: title, body } = titleBlock(spec, c, P, { ratio: 0.09, landscapeRatio: 0.13 });
    const nodes = [];
    const edges = [];
    const build = [];
    if (title) { nodes.push(title); build.push(['title']); }

    const cx = body.x + body.w * 0.30;
    const cy = body.y + body.h / 2;
    const cw = Math.min(body.w * 0.22, P.unit * 0.24);
    const chh = Math.min(body.h * 0.14, P.unit * 0.12);
    const centerBox = { x: cx - cw / 2, y: cy - chh / 2, w: cw, h: chh };
    nodes.push(P.card('center', centerBox, {
      tone: 'amber', r: 30,
      children: [P.text('center-t', { x: centerBox.x + 12, y: centerBox.y, w: centerBox.w - 24, h: centerBox.h }, {
        value: spec.center, size: P.theme.type.node * P.unit * 0.80, weight: 900, font: 'display',
        color: 'blue', align: 'center', valign: 'center', wrap: wrapChars(centerBox.w - 24, P.theme.type.node * P.unit * 0.80), maxLines: 2, slot: false,
      }, centerBox)],
    }));
    build.push(['center']);

    const n = branches.length;
    const spanTop = body.y + body.h * 0.06;
    const spanH = body.h * 0.88;
    const branchX = body.x + body.w * 0.58;
    const bw = Math.min(body.w * 0.24, P.unit * 0.26);
    const bh = Math.min(spanH / n * 0.62, P.unit * 0.11);
    const leafX = body.x + body.w * 0.82;
    const lw = Math.min(body.w * 0.16, P.unit * 0.18);
    const lh = Math.min(bh * 0.72, P.unit * 0.08);

    branches.forEach((b, i) => {
      const by = spanTop + (spanH / n) * (i + 0.5) - bh / 2;
      const box = { x: branchX, y: by, w: bw, h: bh };
      nodes.push(P.card(`branch-${i}`, box, {
        tone: 'blue', r: 22,
        children: [P.text(`branch-${i}-t`, { x: box.x + 10, y: box.y, w: box.w - 20, h: box.h }, {
          value: b.label, size: P.theme.type.node * P.unit * 0.66, weight: 800, font: 'display',
          color: 'text', align: 'center', valign: 'center', wrap: wrapChars(box.w - 20, P.theme.type.node * P.unit * 0.66), maxLines: 2, slot: false,
        }, box)],
      }));
      build.push([`branch-${i}`]);

      edges.push(P.edge(`link-${i}`, [
        { x: centerBox.x + centerBox.w, y: cy },
        { x: box.x, y: box.y + box.h / 2 },
      ], { curve: 'smooth', strokeWidth: 3, slot: false }));

      const leaves = Array.isArray(b.children) ? b.children : [];
      leaves.forEach((leaf, j) => {
        const label = typeof leaf === 'string' ? leaf : leaf?.label ?? '';
        const ly = box.y + (box.h / Math.max(1, leaves.length)) * (j + 0.5) - lh / 2;
        const lbox = { x: leafX, y: ly, w: lw, h: lh };
        nodes.push(P.card(`leaf-${i}-${j}`, lbox, {
          tone: 'ghost', r: 16,
          children: [P.text(`leaf-${i}-${j}-t`, { x: lbox.x + 8, y: lbox.y, w: lbox.w - 16, h: lbox.h }, {
            value: label, size: P.unit * 0.017, weight: 700, font: 'body', color: 'text',
            align: 'center', valign: 'center', wrap: wrapChars(lbox.w - 16, P.unit * 0.017), maxLines: 2, slot: false,
          }, lbox)],
        }));
        build.push([`leaf-${i}-${j}`]);
        edges.push(P.edge(`leaf-link-${i}-${j}`, [
          { x: box.x + box.w, y: box.y + box.h / 2 },
          { x: lbox.x, y: ly + lh / 2 },
        ], { strokeWidth: 2, slot: false }));
      });
    });

    return { nodes: [...nodes, ...edges], build };
  },
};
