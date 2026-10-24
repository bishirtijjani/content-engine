// diagrams/layouts/structure/relationship.mjs — entities around a hub.
import { checkLabel, checkCount, MAX_TITLE, MAX_LABEL, MAX_NOTE, playTime } from '../../spec.mjs';
import { titleBlock, itemsOf } from '../_common.mjs';
import { wrapChars } from '../../primitives.mjs';

export default {
  name: 'relationship',
  description: 'Entities that interact, arranged around a hub with labelled links',
  frame: 'full',
  fields: ['title', 'hub', 'nodes', 'links'],

  minDurationFor(n) { return playTime(1.2, 0.35, n); },

  validate(spec) {
    const out = [];
    if (spec?.title != null) checkLabel(spec.title, 'title', out, { max: MAX_TITLE, required: false });
    checkLabel(typeof spec?.hub === 'string' ? spec.hub : spec?.hub?.label, 'hub', out, { max: MAX_LABEL });
    const nodes = itemsOf(spec, 'nodes');
    checkCount(nodes, 'nodes', out, 3, 6);
    nodes.forEach((n, i) => checkLabel(n.label, `nodes[${i}]`, out));
    const links = Array.isArray(spec?.links) ? spec.links : [];
    links.forEach((l, i) => {
      if (l?.label != null) checkLabel(l.label, `links[${i}].label`, out, { max: MAX_NOTE, required: false });
      if (l?.to != null && (!Number.isInteger(l.to) || l.to < 0 || l.to >= nodes.length)) {
        out.push(`links[${i}].to must be an index into nodes`);
      }
    });
    return out;
  },

  slots(spec) {
    const n = itemsOf(spec, 'nodes').length;
    const out = [];
    if (spec?.title) out.push('title');
    out.push('hub');
    for (let i = 0; i < n; i++) out.push(`node-${i}`);
    const links = Array.isArray(spec?.links) ? spec.links : [];
    const count = links.length || n;
    for (let i = 0; i < count; i++) out.push(`link-${i}`);
    return out;
  },

  build(spec, c, P) {
    const nodesData = itemsOf(spec, 'nodes');
    const n = nodesData.length;
    const { node: title, body } = titleBlock(spec, c, P, { ratio: 0.10, landscapeRatio: 0.14 });
    const nodes = [];
    const edges = [];
    const build = [];
    if (title) { nodes.push(title); build.push(['title']); }

    const cx = body.x + body.w / 2;
    const cy = body.y + body.h * 0.52;
    const rx = body.w * 0.36;
    const ry = body.h * 0.36;
    const wheelW = Math.min(body.w * 0.30, P.unit * 0.26);
    const wheelH = Math.min(wheelW * 0.52, body.h * 0.16);

    const hubW = Math.min(body.w * 0.36, P.unit * 0.34);
    const hubH = Math.min(hubW * 0.42, body.h * 0.15);
    const hubBox = { x: cx - hubW / 2, y: cy - hubH / 2, w: hubW, h: hubH };
    const hubLabel = typeof spec?.hub === 'string' ? spec.hub : spec?.hub?.label ?? '';
    const hubContent = P.cardContent(hubBox, { label: hubLabel }, {
      id: 'hub', fg: 'blue', mode: 'stack', labelSize: P.theme.type.node * P.unit * 0.86,
    });
    nodes.push(P.card('hub', hubBox, { tone: 'amber', r: 34, children: hubContent.children, meta: hubContent.meta }));
    build.push(['hub']);

    const positions = [];
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      const px = cx + rx * Math.cos(a);
      const py = cy + ry * Math.sin(a);
      positions.push({ x: px, y: py });
      const box = { x: px - wheelW / 2, y: py - wheelH / 2, w: wheelW, h: wheelH };
      const content = P.cardContent(box, {
        icon: nodesData[i].icon || 'circle-dot',
        label: nodesData[i].label,
      }, {
        id: `node-${i}`, fg: 'text', mode: 'row',
        labelSize: P.theme.type.node * P.unit * 0.74,
      });
      nodes.push(P.card(`node-${i}`, box, { tone: 'blue', r: 26, children: content.children, meta: content.meta }));
      build.push([`node-${i}`]);
    }

    const links = Array.isArray(spec?.links) && spec.links.length
      ? spec.links
      : nodesData.map((_, i) => ({ to: i }));
    links.forEach((link, i) => {
      const target = positions[link?.to ?? i] ?? positions[i % n];
      const dx = target.x - cx;
      const dy = target.y - cy;
      const len = Math.hypot(dx, dy) || 1;
      const a = { x: cx + (dx / len) * (hubW / 2), y: cy + (dy / len) * (hubH / 2) };
      const b = { x: target.x - (dx / len) * (wheelW / 2), y: target.y - (dy / len) * (wheelH / 2) };
      edges.push(P.edge(`link-${i}`, [a, b], { strokeWidth: 3, label: link?.label, labelSize: P.unit * 0.018 }));
      build.push([`link-${i}`]);
    });

    return { nodes: [...nodes, ...edges], build };
  },
};
