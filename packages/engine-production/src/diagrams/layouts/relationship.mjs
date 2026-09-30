// layouts/relationship.mjs — entities that interact, placed around a hub.
//
// Nodes sit on a ring around a centre hub (the first node, or a named hub);
// straight labelled connectors join the interacting pairs. Node and link counts
// are capped so the network stays readable — not spaghetti.
import { text, iconGroup, rect, circle, connector, r3, wrap } from '../primitives.mjs';
import { frameBox, svgOpen, svgClose, titleText } from './shared.mjs';

function geometry(spec, box, theme) {
  const nodes = spec.nodes;
  const links = spec.links;
  const fb = frameBox(spec, box);
  const { w, h, usableW, usableH } = fb;
  const n = nodes.length;
  const cx = w / 2;
  const cy = fb.top + fb.my + usableH * 0.5;
  // an elliptical ring uses the whole frame (wide on 16:9, tall on 9:16)
  const rx = usableW * 0.34;
  const ry = usableH * 0.42;
  const nodeW = Math.min(usableW * 0.28, Math.max(rx * 0.6, 150));
  const nodeH = Math.min(h * 0.14, nodeW * 0.34);
  const labelSize = Math.max(13, Math.min(nodeH * 0.34, 26));

  const placed = new Map();
  nodes.forEach((nd, i) => {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    const x = cx + Math.cos(a) * rx - nodeW / 2;
    const y = cy + Math.sin(a) * ry - nodeH / 2;
    placed.set(nd.id, { ...nd, x, y, w: nodeW, h: nodeH, cx: x + nodeW / 2, cy: y + nodeH / 2, index: i });
  });

  const edges = links.map((lk, i) => {
    const a = placed.get(lk.from);
    const b = placed.get(lk.to);
    if (!a || !b) return null;
    const dx = b.cx - a.cx;
    const dy = b.cy - a.cy;
    const len = Math.hypot(dx, dy) || 1;
    const padA = Math.min(a.w, a.h) / 2;
    const padB = Math.min(b.w, b.h) / 2;
    const e = connector({
      x1: a.cx + (dx / len) * padA, y1: a.cy + (dy / len) * padA,
      x2: b.cx - (dx / len) * padB, y2: b.cy - (dy / len) * padB,
      markerId: '',
    });
    return { ...e, index: i, label: lk.label ?? null, mid: { x: (a.cx + b.cx) / 2, y: (a.cy + b.cy) / 2 } };
  }).filter(Boolean);

  return { ...fb, orientation: 'relationship', cx, cy, rx, ry, nodeList: [...placed.values()], edges, labelSize };
}

function svg(geo, theme, ovId) {
  const [open] = svgOpen(geo.w, geo.h, ovId);
  const edges = geo.edges
    .map((e, i) => {
      const lbl = e.label
        ? `<g class="dg-linklabel-g"><rect class="dg-pill" x="${r3(e.mid.x - e.label.length * 4.2 - 8)}" y="${r3(e.mid.y - 13)}" width="${r3(e.label.length * 8.4 + 16)}" height="26" rx="13"/>` +
          text({ x: e.mid.x, y: e.mid.y + 5, cls: 'dg-link-label', anchor: 'middle', size: 16, weight: 700, lines: [e.label] }) + `</g>`
        : '';
      return `<g class="dg-edge dg-edge-${i}">${e.markup}${lbl}</g>`;
    })
    .join('');
  const nodes = geo.nodeList
    .map((nd, i) => {
      const bg = rect({ w: nd.w, h: nd.h, r: theme.radius, cls: i === 0 ? 'dg-panel-accent' : 'dg-panel' });
      const iconSize = Math.min(nd.h * 0.6, 28);
      const hasIcon = !!nd.icon;
      const ic = hasIcon ? iconGroup({ name: nd.icon, x: nd.w / 2 - iconSize / 2, y: nd.h * 0.14, size: iconSize }) : '';
      const lines = wrap(nd.label, Math.max(7, Math.floor((nd.w * 0.88) / (geo.labelSize * 0.56))), 2);
      const label = text({ x: nd.w / 2, y: hasIcon ? nd.h * 0.14 + iconSize + geo.labelSize * 0.95 : nd.h / 2 + geo.labelSize * 0.2, cls: 'dg-heading', anchor: 'middle', size: geo.labelSize, weight: 700, lines });
      return `<g class="dg-node dg-node-${i}" transform="translate(${r3(nd.x)} ${r3(nd.y)})"><g class="dg-node-anim">${bg}${ic}${label}</g></g>`;
    })
    .join('');
  return open + titleText(geo) + edges + nodes + svgClose;
}

function animate(geo, { t0, dur, ovId }) {
  const s = `#${ovId}`;
  const line = (x) => `      ${x};`;
  const out = [];
  if (geo.title) {
    out.push(line(`tl.set('${s} .dg-title', {y:12}, ${r3(t0)})`));
    out.push(line(`tl.to('${s} .dg-title', {opacity:1, y:0, duration:0.35, ease:'power2.out'}, ${r3(t0)})`));
  }
  const n = geo.nodeList.length;
  const step = Math.max(0.2, Math.min(0.36, (dur * 0.5) / n));
  geo.nodeList.forEach((nd, i) => {
    const at = t0 + 0.25 + i * step;
    out.push(line(`tl.set('${s} .dg-node-${i} .dg-node-anim', {opacity:0, scale:0.9, transformOrigin:'center center'}, ${r3(t0)})`));
    out.push(line(`tl.to('${s} .dg-node-${i} .dg-node-anim', {opacity:1, scale:1, duration:0.4, ease:'back.out(1.4)'}, ${r3(at)})`));
  });
  geo.edges.forEach((e, i) => {
    const at = t0 + 0.6 + i * Math.min(0.22, (dur * 0.4) / Math.max(1, geo.edges.length));
    out.push(line(`tl.set('${s} .dg-edge-${i} .dg-line', {strokeDashoffset:${r3(e.length)}}, ${r3(t0)})`));
    out.push(line(`tl.to('${s} .dg-edge-${i} .dg-line', {strokeDashoffset:0, duration:0.4, ease:'power2.inOut'}, ${r3(at)})`));
  });
  const exitAt = Math.max(t0 + 0.6, t0 + dur - 0.35);
  out.push(line(`tl.to('${s} .dg-root', {opacity:0, y:-10, duration:0.35, ease:'power2.in'}, ${r3(exitAt)})`));
  return out;
}

export default {
  name: 'relationship',
  description: 'Entities that interact, arranged around a hub with labelled links',
  frame: 'full',
  fields: ['title', 'nodes', 'links'],
  minDurationFor: (n) => 1.2 + n * 0.35,
  geometry,
  svg,
  animate,
};
