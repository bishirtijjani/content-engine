// diagrams/layouts/structure/architecture.mjs — components and labelled links.
import { checkLabel, checkCount, checkIcon, MAX_TITLE, MAX_LABEL, MAX_NOTE, playTime } from '../../spec.mjs';
import { titleBlock } from '../_common.mjs';
import { wrapChars } from '../../primitives.mjs';

function trimToBox(from, to) {
  const ca = { x: from.x + from.w / 2, y: from.y + from.h / 2 };
  const cb = { x: to.x + to.w / 2, y: to.y + to.h / 2 };
  const dx = cb.x - ca.x;
  const dy = cb.y - ca.y;
  const hit = (box, ox, oy, vx, vy) => {
    const tx = vx > 0 ? (box.x + box.w - ox) / vx : vx < 0 ? (box.x - ox) / vx : Infinity;
    const ty = vy > 0 ? (box.y + box.h - oy) / vy : vy < 0 ? (box.y - oy) / vy : Infinity;
    const t = Math.min(tx, ty);
    return { x: ox + vx * t, y: oy + vy * t };
  };
  const a = hit(from, ca.x, ca.y, dx, dy);
  const b = hit(to, cb.x, cb.y, -dx, -dy);
  return [a, b];
}

export default {
  name: 'architecture',
  description: 'System components and their connections, with labelled links',
  frame: 'full',
  fields: ['title', 'nodes', 'links'],

  minDurationFor(n) { return playTime(1.2, 0.35, n); },

  validate(spec) {
    const out = [];
    if (spec?.title != null) checkLabel(spec.title, 'title', out, { max: MAX_TITLE, required: false });
    const nodes = Array.isArray(spec?.nodes) ? spec.nodes : [];
    checkCount(nodes, 'nodes', out, 2, 8);
    const ids = new Set();
    nodes.forEach((n, i) => {
      const id = typeof n === 'string' ? `n${i}` : n?.id;
      if (!id) out.push(`nodes[${i}] needs an id`);
      else if (ids.has(id)) out.push(`nodes[${i}] id "${id}" is used twice`);
      else ids.add(id);
      checkLabel(typeof n === 'string' ? n : n?.label, `nodes[${i}].label`, out, { max: MAX_LABEL });
      checkIcon(n?.icon, `nodes[${i}]`, out);
    });
    const links = Array.isArray(spec?.links) ? spec.links : [];
    links.forEach((l, i) => {
      if (!l || !ids.has(l.from)) out.push(`links[${i}].from must be a node id`);
      if (!l || !ids.has(l.to)) out.push(`links[${i}].to must be a node id`);
      if (l?.label != null) checkLabel(l.label, `links[${i}].label`, out, { max: MAX_NOTE, required: false });
    });
    return out;
  },

  slots(spec) {
    const nodes = Array.isArray(spec?.nodes) ? spec.nodes : [];
    const out = [];
    if (spec?.title) out.push('title');
    nodes.forEach((n, i) => out.push(`node-${typeof n === 'string' ? `n${i}` : n?.id ?? `n${i}`}`));
    (Array.isArray(spec?.links) ? spec.links : []).forEach((_, i) => out.push(`link-${i}`));
    return out;
  },

  build(spec, c, P) {
    const raw = Array.isArray(spec?.nodes) ? spec.nodes : [];
    const definitions = raw.map((n, i) => (typeof n === 'string'
      ? { id: `n${i}`, label: n }
      : { ...n, id: n.id ?? `n${i}`, label: n.label ?? n.text ?? '' }));
    const links = Array.isArray(spec?.links) ? spec.links : [];
    const { node: title, body } = titleBlock(spec, c, P, { ratio: 0.11, landscapeRatio: 0.15 });
    const nodes = [];
    const edges = [];
    const build = [];
    if (title) { nodes.push(title); build.push(['title']); }

    const n = definitions.length;
    const cols = c.landscape ? Math.min(n, n <= 4 ? n : 4) : (n <= 2 ? 2 : 2);
    const rows = Math.ceil(n / cols);
    const gapX = body.w * 0.05;
    const gapY = body.h * 0.08;
    const w = (body.w - gapX * (cols - 1)) / cols;
    const rowH = (body.h - gapY * (rows - 1)) / rows;
    const h = Math.min(rowH, P.unit * (c.landscape ? 0.62 : 0.52));
    const padY = (rowH - h) / 2;
    const boxes = new Map();

    definitions.forEach((def, i) => {
      const r = Math.floor(i / cols);
      const k = i % cols;
      const box = { x: body.x + k * (w + gapX), y: body.y + padY + r * (rowH + gapY), w, h };
      boxes.set(def.id, box);
      const tone = def.tone ?? (i === 0 ? 'amber' : 'blue');
      const fg = tone === 'amber' ? 'blue' : 'text';
      const content = P.cardContent(box, { icon: def.icon || 'box', label: def.label }, {
        id: `node-${def.id}`, fg, mode: 'auto',
        labelSize: P.theme.type.node * P.unit * 0.80,
      });
      nodes.push(P.card(`node-${def.id}`, box, {
        tone, r: 30, children: content.children, meta: content.meta,
      }));
      build.push([`node-${def.id}`]);
    });

    links.forEach((link, i) => {
      const from = boxes.get(link.from);
      const to = boxes.get(link.to);
      if (!from || !to) return;
      const pts = trimToBox(from, to);
      edges.push(P.edge(`link-${i}`, pts, {
        strokeWidth: 3,
        dashed: link.dashed === true,
        label: link.label,
        labelSize: P.unit * 0.019,
      }));
      build.push([`link-${i}`]);
    });

    return { nodes: [...nodes, ...edges], build };
  },
};
