// layouts/architecture.mjs — components of a system and how they connect.
//
// Nodes are laid out on a grid; links are straight labelled connectors. A node
// can be tagged `tone:'accent'` to stand out (e.g. the core API). Links may
// carry a short label. This reads as a real system diagram, not a Flow row.
import { text, iconGroup, rect, connector, r3, wrap } from '../primitives.mjs';
import { frameBox, svgOpen, svgClose, titleText } from './shared.mjs';

function geometry(spec, box, theme) {
  const nodes = spec.nodes;
  const links = spec.links;
  const fb = frameBox(spec, box);
  const { w, h, landscape, usableW, usableH } = fb;
  const n = nodes.length;
  const cols = landscape ? Math.min(n, n <= 4 ? n : Math.ceil(n / 2)) : (n <= 4 ? 2 : 2);
  const rows = Math.ceil(n / cols);
  const gapX = usableW * 0.06;
  const gapY = usableH * 0.12;
  const cardW = Math.min((usableW - gapX * (cols - 1)) / cols, usableW * 0.42);
  const cardH = Math.min((usableH - gapY * (rows - 1)) / rows, usableH * 0.34);
  const totalW = cols * cardW + (cols - 1) * gapX;
  const totalH = rows * cardH + (rows - 1) * gapY;
  const startX = (w - totalW) / 2;
  const startY = fb.top + fb.my + (usableH - totalH) / 2;
  const labelSize = Math.max(13, Math.min(cardH * 0.3, 26));

  const placed = new Map();
  nodes.forEach((nd, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = startX + col * (cardW + gapX);
    const y = startY + row * (cardH + gapY);
    placed.set(nd.id, { ...nd, x, y, w: cardW, h: cardH, index: i });
  });

  const rects = [...placed.values()].map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h }));
  const edges = links.map((lk, i) => {
    const a = placed.get(lk.from);
    const b = placed.get(lk.to);
    const c = { x1: a.x + a.w / 2, y1: a.y + a.h / 2, x2: b.x + b.w / 2, y2: b.y + b.h / 2 };
    // trim the line to the card boxes so the arrow lands on the edge, not inside
    const dx = c.x2 - c.x1;
    const dy = c.y2 - c.y1;
    const len = Math.hypot(dx, dy) || 1;
    const padA = Math.min(Math.abs(dx) > Math.abs(dy) ? a.w / 2 / Math.abs(dx / len) : a.h / 2 / Math.abs(dy / len), 60);
    const padB = Math.min(Math.abs(dx) > Math.abs(dy) ? b.w / 2 / Math.abs(dx / len) : b.h / 2 / Math.abs(dy / len), 60);
    const sx = c.x1 + (dx / len) * padA;
    const sy = c.y1 + (dy / len) * padA;
    const ex = c.x2 - (dx / len) * padB;
    const ey = c.y2 - (dy / len) * padB;
    const e = connector({ x1: sx, y1: sy, x2: ex, y2: ey, markerId: '__ARROW__' });
    const mid = lk.label ? clearLabelMid(sx, sy, ex, ey, rects) : { x: (sx + ex) / 2, y: (sy + ey) / 2 };
    return { ...e, index: i, label: lk.label ?? null, mid };
  });

  return {
    ...fb, orientation: landscape ? 'landscape' : 'portrait',
    nodeList: [...placed.values()], edges, labelSize,
  };
}

/**
 * A point on the trimmed edge near its middle but clear of every card, so a
 * link label is never hidden behind a node (a long diagonal can cross a card).
 * Tries the midpoint, then steps out both ways.
 */
function clearLabelMid(x1, y1, x2, y2, rects, margin = 20) {
  const at = (t) => ({ x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t });
  const blocked = (p) => rects.some((n) =>
    p.x >= n.x - margin && p.x <= n.x + n.w + margin &&
    p.y >= n.y - margin && p.y <= n.y + n.h + margin);
  if (!blocked(at(0.5))) return at(0.5);
  for (let d = 0.06; d <= 0.44; d += 0.06) {
    const back = at(0.5 - d);
    if (!blocked(back)) return back;
    const fwd = at(0.5 + d);
    if (!blocked(fwd)) return fwd;
  }
  return at(0.5);
}

function svg(geo, theme, ovId) {
  const [open, arrowId] = svgOpen(geo.w, geo.h, ovId);
  const edges = geo.edges
    .map((e, i) => `<g class="dg-edge dg-edge-${i}">${e.markup.replace('__ARROW__', arrowId)}</g>`)
    .join('');
  const nodes = geo.nodeList
    .map((nd) => {
      const accent = nd.tone === 'accent';
      const bg = rect({ w: nd.w, h: nd.h, r: theme.radius, cls: accent ? 'dg-panel-accent' : 'dg-panel' });
      const iconSize = Math.min(nd.h * 0.4, 32);
      const hasIcon = !!nd.icon;
      const ic = hasIcon ? iconGroup({ name: nd.icon, x: nd.w / 2 - iconSize / 2, y: nd.h * 0.16, size: iconSize }) : '';
      const lines = wrap(nd.label, Math.max(7, Math.floor((nd.w * 0.86) / (geo.labelSize * 0.56))), 2);
      const label = text({ x: nd.w / 2, y: hasIcon ? nd.h * 0.16 + iconSize + geo.labelSize * 1.0 : nd.h / 2 + geo.labelSize * 0.2, cls: 'dg-heading', anchor: 'middle', size: geo.labelSize, weight: 700, lines });
      return `<g class="dg-node dg-node-${nd.index}" transform="translate(${r3(nd.x)} ${r3(nd.y)})"><g class="dg-node-anim">${bg}${ic}${label}</g></g>`;
    })
    .join('');
  // labels last, so a pill is never hidden behind a card
  const labels = geo.edges
    .map((e, i) => {
      if (!e.label) return '';
      return `<g class="dg-edge-label dg-edge-label-${i}">` +
        `<rect class="dg-pill" x="${r3(e.mid.x - e.label.length * 4.2 - 8)}" y="${r3(e.mid.y - 13)}" width="${r3(e.label.length * 8.4 + 16)}" height="26" rx="13"/>` +
        text({ x: e.mid.x, y: e.mid.y + 5, cls: 'dg-link-label', anchor: 'middle', size: 16, weight: 700, lines: [e.label] }) + `</g>`;
    })
    .join('');
  return open + titleText(geo) + edges + nodes + labels + svgClose;
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
  const step = Math.max(0.2, Math.min(0.38, (dur * 0.5) / n));
  geo.nodeList.forEach((nd, i) => {
    const at = t0 + 0.25 + i * step;
    out.push(line(`tl.set('${s} .dg-node-${i} .dg-node-anim', {opacity:0, scale:0.94, transformOrigin:'center center'}, ${r3(t0)})`));
    out.push(line(`tl.to('${s} .dg-node-${i} .dg-node-anim', {opacity:1, scale:1, duration:0.38, ease:'power2.out'}, ${r3(at)})`));
  });
  geo.edges.forEach((e, i) => {
    const at = t0 + 0.6 + i * Math.min(0.25, (dur * 0.4) / Math.max(1, geo.edges.length));
    out.push(line(`tl.set('${s} .dg-edge-${i} .dg-line', {strokeDashoffset:${r3(e.length)}}, ${r3(t0)})`));
    out.push(line(`tl.to('${s} .dg-edge-${i} .dg-line', {strokeDashoffset:0, duration:0.4, ease:'power2.inOut'}, ${r3(at)})`));
  });
  const exitAt = Math.max(t0 + 0.6, t0 + dur - 0.35);
  out.push(line(`tl.to('${s} .dg-root', {opacity:0, y:-10, duration:0.35, ease:'power2.in'}, ${r3(exitAt)})`));
  return out;
}

export default {
  name: 'architecture',
  description: 'System components and their connections, with labelled links',
  frame: 'full',
  fields: ['title', 'nodes', 'links'],
  minDurationFor: (n) => 1.2 + n * 0.35,
  geometry,
  svg,
  animate,
};
