// diagrams/layouts/process/fork-join.mjs — one flow splitting and rejoining.
import { checkLabel, checkCount, MAX_TITLE, MAX_LABEL, playTime } from '../../spec.mjs';
import { titleBlock, itemsOf } from '../_common.mjs';
import { wrapChars } from '../../primitives.mjs';

export default {
  name: 'fork-join',
  description: 'A flow that forks into parallel branches and joins again',
  frame: 'full',
  fields: ['title', 'start', 'branches', 'join'],

  minDurationFor(n) { return playTime(1.2, 0.4, n); },

  validate(spec) {
    const out = [];
    if (spec?.title != null) checkLabel(spec.title, 'title', out, { max: MAX_TITLE, required: false });
    checkLabel(spec?.start, 'start', out, { max: MAX_LABEL });
    checkLabel(spec?.join, 'join', out, { max: MAX_LABEL });
    const branches = itemsOf(spec, 'branches');
    checkCount(branches, 'branches', out, 2, 4);
    branches.forEach((b, i) => checkLabel(b.label, `branches[${i}]`, out, { max: MAX_LABEL }));
    return out;
  },

  slots(spec) {
    const out = [];
    if (spec?.title) out.push('title');
    out.push('node-start');
    itemsOf(spec, 'branches').forEach((_, i) => out.push(`branch-${i}`));
    out.push('node-join');
    itemsOf(spec, 'branches').forEach((_, i) => { out.push(`link-in-${i}`); out.push(`link-out-${i}`); });
    return out;
  },

  build(spec, c, P) {
    const branches = itemsOf(spec, 'branches');
    const { node: title, body } = titleBlock(spec, c, P, { ratio: 0.09, landscapeRatio: 0.13 });
    const nodes = [];
    const edges = [];
    const build = [];
    if (title) { nodes.push(title); build.push(['title']); }

    const endW = Math.min(body.w * 0.40, P.unit * 0.44);
    const endH = Math.min(body.h * 0.16, P.unit * 0.12);
    const startBox = { x: body.x + (body.w - endW) / 2, y: body.y, w: endW, h: endH };
    const joinBox = { x: body.x + (body.w - endW) / 2, y: body.y + body.h - endH, w: endW, h: endH };
    const midH = Math.min(body.h * 0.20, P.unit * 0.15);
    const gap = body.w * 0.04;
    const bw = (body.w - gap * (branches.length - 1)) / branches.length;
    const midY = body.y + (body.h - midH) / 2;
    const branchBoxes = branches.map((_, i) => ({ x: body.x + i * (bw + gap), y: midY, w: bw, h: midH }));

    const terminal = (id, box, value, tone, fg) => P.card(id, box, {
      tone, r: 28,
      children: [P.text(`${id}-t`, { x: box.x + 16, y: box.y, w: box.w - 32, h: box.h }, {
        value, size: P.theme.type.node * P.unit * 0.80, weight: 800, font: 'display', color: fg,
        align: 'center', valign: 'center', wrap: wrapChars(box.w - 32, P.theme.type.node * P.unit * 0.80), maxLines: 2, slot: false,
      }, box)],
    });

    nodes.push(terminal('node-start', startBox, spec.start, 'amber', 'blue'));
    build.push(['node-start']);

    branchBoxes.forEach((box, i) => {
      nodes.push(terminal(`branch-${i}`, box, branches[i].label, 'blue', 'text'));
      build.push([`branch-${i}`]);
    });

    nodes.push(terminal('node-join', joinBox, spec.join, 'amber', 'blue'));
    build.push(['node-join']);

    branchBoxes.forEach((box, i) => {
      edges.push(P.edge(`link-in-${i}`, [
        { x: startBox.x + startBox.w * (0.25 + 0.5 * (i / Math.max(1, branches.length - 1))), y: startBox.y + startBox.h },
        { x: startBox.x + startBox.w * (0.25 + 0.5 * (i / Math.max(1, branches.length - 1))), y: midY - body.h * 0.03 },
        { x: box.x + box.w / 2, y: midY - body.h * 0.03 },
        { x: box.x + box.w / 2, y: midY },
      ], { strokeWidth: 3 }));
      build.push([`link-in-${i}`]);
      edges.push(P.edge(`link-out-${i}`, [
        { x: box.x + box.w / 2, y: box.y + box.h },
        { x: box.x + box.w / 2, y: joinBox.y - body.h * 0.03 },
        { x: joinBox.x + joinBox.w * (0.25 + 0.5 * (i / Math.max(1, branches.length - 1))), y: joinBox.y - body.h * 0.03 },
        { x: joinBox.x + joinBox.w * (0.25 + 0.5 * (i / Math.max(1, branches.length - 1))), y: joinBox.y },
      ], { strokeWidth: 3 }));
      build.push([`link-out-${i}`]);
    });

    return { nodes: [...nodes, ...edges], build };
  },
};
