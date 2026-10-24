// diagrams/layouts/structure/deployment.mjs — zones and the items inside them.
import { checkLabel, checkCount, MAX_TITLE, MAX_LABEL, MAX_NOTE, playTime } from '../../spec.mjs';
import { titleBlock } from '../_common.mjs';
import { wrapChars } from '../../primitives.mjs';

function trim(from, to) {
  const ca = { x: from.x + from.w / 2, y: from.y + from.h / 2 };
  const cb = { x: to.x + to.w / 2, y: to.y + to.h / 2 };
  const dx = cb.x - ca.x;
  const dy = cb.y - ca.y;
  const hit = (b, ox, oy, vx, vy) => {
    const tx = vx > 0 ? (b.x + b.w - ox) / vx : vx < 0 ? (b.x - ox) / vx : Infinity;
    const ty = vy > 0 ? (b.y + b.h - oy) / vy : vy < 0 ? (b.y - oy) / vy : Infinity;
    return { x: ox + vx * Math.min(tx, ty), y: oy + vy * Math.min(tx, ty) };
  };
  return [hit(from, ca.x, ca.y, dx, dy), hit(to, cb.x, cb.y, -dx, -dy)];
}

export default {
  name: 'deployment',
  description: 'Zones and the services deployed inside them',
  frame: 'full',
  fields: ['title', 'zones', 'links'],

  minDurationFor(n) { return playTime(1.2, 0.35, n); },

  validate(spec) {
    const out = [];
    if (spec?.title != null) checkLabel(spec.title, 'title', out, { max: MAX_TITLE, required: false });
    const zones = Array.isArray(spec?.zones) ? spec.zones : [];
    checkCount(zones, 'zones', out, 1, 3);
    const ids = new Set();
    zones.forEach((z, i) => {
      checkLabel(z?.label, `zones[${i}].label`, out, { max: 20 });
      const items = Array.isArray(z?.items) ? z.items : [];
      if (items.length < 1 || items.length > 4) out.push(`zones[${i}] needs 1-4 items`);
      items.forEach((it, j) => {
        const id = typeof it === 'string' ? `z${i}-${j}` : it?.id ?? `z${i}-${j}`;
        if (ids.has(id)) out.push(`zones[${i}].items[${j}] id "${id}" is used twice`);
        ids.add(id);
        checkLabel(typeof it === 'string' ? it : it?.label, `zones[${i}].items[${j}]`, out, { max: 20 });
      });
    });
    (Array.isArray(spec?.links) ? spec.links : []).forEach((l, i) => {
      if (!ids.has(l?.from)) out.push(`links[${i}].from must be an item id`);
      if (!ids.has(l?.to)) out.push(`links[${i}].to must be an item id`);
      if (l?.label != null) checkLabel(l.label, `links[${i}].label`, out, { max: MAX_NOTE, required: false });
    });
    return out;
  },

  slots(spec) {
    const out = [];
    if (spec?.title) out.push('title');
    (Array.isArray(spec?.zones) ? spec.zones : []).forEach((z, i) => {
      out.push(`zone-${i}`);
      (Array.isArray(z?.items) ? z.items : []).forEach((_, j) => out.push(`item-${i}-${j}`));
    });
    (Array.isArray(spec?.links) ? spec.links : []).forEach((_, i) => out.push(`link-${i}`));
    return out;
  },

  build(spec, c, P) {
    const zones = Array.isArray(spec?.zones) ? spec.zones : [];
    const links = Array.isArray(spec?.links) ? spec.links : [];
    const { node: title, body } = titleBlock(spec, c, P, { ratio: 0.09, landscapeRatio: 0.13 });
    const nodes = [];
    const edges = [];
    const build = [];
    if (title) { nodes.push(title); build.push(['title']); }

    const gap = body.h * 0.025;
    const zoneH = (body.h - gap * (zones.length - 1)) / zones.length;
    const boxes = new Map();
    zones.forEach((z, zi) => {
      const zbox = { x: body.x, y: body.y + zi * (zoneH + gap), w: body.w, h: zoneH };
      nodes.push(P.card(`zone-${zi}`, zbox, {
        tone: 'ghost', r: 24,
        children: [P.text(`zone-${zi}-t`, { x: zbox.x + 16, y: zbox.y, w: zbox.w * 0.20, h: zbox.h }, {
          value: z.label, size: P.unit * 0.021, weight: 800, font: 'display', color: 'text',
          align: 'left', valign: 'center', caps: true, tracking: 0.10, opacity: 0.7, slot: false,
        }, zbox)],
      }));
      build.push([`zone-${zi}`]);

      const items = Array.isArray(z.items) ? z.items : [];
      const itemAreaX = zbox.x + zbox.w * 0.22;
      const itemAreaW = zbox.w * 0.74;
      const ig = itemAreaW * 0.03;
      const iw = (itemAreaW - ig * (items.length - 1)) / items.length;
      items.forEach((it, ii) => {
        const label = typeof it === 'string' ? it : it?.label ?? '';
        const id = typeof it === 'string' ? `z${zi}-${ii}` : it?.id ?? `z${zi}-${ii}`;
        const box = { x: itemAreaX + ii * (iw + ig), y: zbox.y + zbox.h * 0.16, w: iw, h: zbox.h * 0.68 };
        boxes.set(id, box);
        const content = P.cardContent(box, {
          icon: (typeof it === 'object' && it?.icon) || 'box',
          label,
        }, {
          id: `item-${zi}-${ii}`, fg: 'text', mode: 'row',
          labelSize: P.theme.type.node * P.unit * 0.62,
        });
        nodes.push(P.card(`item-${zi}-${ii}`, box, {
          tone: 'blue', r: 18, children: content.children, meta: content.meta,
        }));
        build.push([`item-${zi}-${ii}`]);
      });
    });

    links.forEach((l, i) => {
      const a = boxes.get(l.from);
      const b = boxes.get(l.to);
      if (!a || !b) return;
      edges.push(P.edge(`link-${i}`, trim(a, b), {
        strokeWidth: 3, dashed: l.dashed === true, label: l.label, labelSize: P.unit * 0.016,
      }));
      build.push([`link-${i}`]);
    });

    return { nodes: [...nodes, ...edges], build };
  },
};
