// layouts/cycle.mjs — a repeating circular process.
//
// Nodes sit on a real circle; curved arcs join each to the next (and the last
// back to the first), so the loop reads as a loop. A centre label can name the
// cycle. Arc length drives the draw animation, same as Flow's connectors.
import { text, iconGroup, path, circle, r3, wrap } from '../primitives.mjs';
import { frameBox, svgOpen, svgClose, titleText } from './shared.mjs';

function geometry(spec, box, theme) {
  const steps = spec.steps;
  const n = steps.length;
  const active = Number.isInteger(spec.active) ? Math.max(0, Math.min(n - 1, spec.active)) : n - 1;
  const fb = frameBox(spec, box);
  const { w, h, usableW, usableH } = fb;
  const cx = w / 2;
  const cy = (fb.top + fb.my) + usableH * 0.54;
  const radius = Math.min(usableW, usableH) * 0.38;
  const nodeR = Math.min(radius * 0.36, w * 0.078);
  const iconSize = nodeR * 0.95;
  const labelSize = Math.max(12, Math.min(nodeR * 0.46, 22));

  const nodes = [];
  // start at 12 o'clock, go clockwise
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    const x = cx + Math.cos(a) * radius;
    const y = cy + Math.sin(a) * radius;
    nodes.push({
      index: i, angle: a, x, y, r: nodeR, active: i === active,
      lines: wrap(steps[i].label, Math.max(8, Math.floor((nodeR * 1.9) / (labelSize * 0.56))), 2),
      labelSize,
      icon: steps[i].icon ? { name: steps[i].icon, size: iconSize } : null,
    });
  }

  const arcs = [];
  for (let i = 0; i < n; i++) {
    const a0 = nodes[i].angle;
    const a1 = nodes[(i + 1) % n].angle;
    // gaps around each node so the arc does not touch the circle
    const pad = (nodeR * 1.35) / radius;
    const start = a0 + pad;
    let end = a1 - pad;
    if (i === n - 1) end = a1 + Math.PI * 2 - pad; // wrap past 12 o'clock
    const sx = cx + Math.cos(start) * radius;
    const sy = cy + Math.sin(start) * radius;
    const ex = cx + Math.cos(end) * radius;
    const ey = cy + Math.sin(end) * radius;
    const large = end - start > Math.PI ? 1 : 0;
    const d = `M${r3(sx)} ${r3(sy)} A${r3(radius)} ${r3(radius)} 0 ${large} 1 ${r3(ex)} ${r3(ey)}`;
    arcs.push({ length: Math.abs(end - start) * radius, markup: path({ d, cls: 'dg-loop', markerId: '__ARROW__' }).markup, index: i });
  }

  return {
    ...fb, orientation: 'cycle', cx, cy, radius, nodes, arcs,
    center: spec.center ? { text: String(spec.center) } : null,
  };
}

function svg(geo, theme, ovId) {
  const [open, arrowId] = svgOpen(geo.w, geo.h, ovId);
  const arcs = geo.arcs
    .map((a, i) => `<g class="dg-edge dg-edge-${i}">${a.markup.replace('__ARROW__', arrowId)}</g>`)
    .join('');
  const nodes = geo.nodes
    .map((nd, i) => {
      const bg = circle({ cx: nd.x, cy: nd.y, r: nd.r, cls: 'dg-node-bg' });
      const ring = nd.active ? circle({ cx: nd.x, cy: nd.y, r: nd.r, cls: 'dg-node-ring' }) : '';
      const ic = nd.icon
        ? iconGroup({ name: nd.icon.name, x: nd.x - nd.icon.size / 2, y: nd.y - nd.icon.size / 2 - nd.labelSize * 0.5, size: nd.icon.size })
        : '';
      const label = text({
        x: nd.x, y: nd.y + nd.r * 0.5 + nd.labelSize * 0.7, cls: 'dg-node-label',
        anchor: 'middle', size: nd.labelSize, weight: 600, lines: nd.lines,
      });
      return `<g class="dg-node dg-node-${i}"><g class="dg-node-anim">${bg}${ring}${ic}${label}</g></g>`;
    })
    .join('');
  const innerGap = geo.radius - geo.nodes[0].r;
  // keep the centre label clear of the side nodes: half its width must fit the gap
  const maxCenterByWidth = (innerGap * 1.7) / Math.max(4, String(geo.center?.text ?? '').length * 0.58);
  const centerSize = Math.max(12, Math.min(geo.radius * 0.3, innerGap * 0.5, maxCenterByWidth, 32));
  const center = geo.center
    ? text({ x: geo.cx, y: geo.cy + centerSize * 0.34, cls: 'dg-heading', anchor: 'middle', size: centerSize, weight: 800, lines: [geo.center.text] })
    : '';
  return open + titleText(geo) + center + arcs + nodes + svgClose;
}

function animate(geo, { t0, dur, ovId }) {
  const s = `#${ovId}`;
  const n = geo.nodes.length;
  const line = (x) => `      ${x};`;
  const out = [];
  if (geo.title) {
    out.push(line(`tl.set('${s} .dg-title', {y:12}, ${r3(t0)})`));
    out.push(line(`tl.to('${s} .dg-title', {opacity:1, y:0, duration:0.35, ease:'power2.out'}, ${r3(t0)})`));
  }
  const step = Math.max(0.28, Math.min(0.5, (dur * 0.5) / n));
  const start = t0 + 0.25;
  geo.nodes.forEach((nd, i) => {
    const at = start + i * step;
    out.push(line(`tl.set('${s} .dg-node-${i} .dg-node-anim', {scale:0.9}, ${r3(t0)})`));
    out.push(line(`tl.to('${s} .dg-node-${i} .dg-node-anim', {opacity:1, scale:1, transformOrigin:'center center', duration:0.4, ease:'back.out(1.5)'}, ${r3(at)})`));
    const a = geo.arcs[i];
    out.push(line(`tl.set('${s} .dg-edge-${i} .dg-loop', {strokeDashoffset:${r3(a.length)}}, ${r3(t0)})`));
    out.push(line(`tl.to('${s} .dg-edge-${i} .dg-loop', {strokeDashoffset:0, duration:0.45, ease:'power2.inOut'}, ${r3(at + 0.2)})`));
  });
  const ringAt = start + n * step + 0.3;
  out.push(line(`tl.to('${s} .dg-node-${geo.nodes.findIndex((x) => x.active)} .dg-node-ring', {opacity:1, duration:0.25, ease:'power2.out'}, ${r3(ringAt)})`));
  const exitAt = Math.max(t0 + 0.6, t0 + dur - 0.35);
  out.push(line(`tl.to('${s} .dg-root', {opacity:0, y:-10, duration:0.35, ease:'power2.in'}, ${r3(exitAt)})`));
  return out;
}

export default {
  name: 'cycle',
  description: 'A repeating process arranged on a circle with curved arrows',
  frame: 'full',
  steps: { min: 3, max: 6 },
  fields: ['title', 'steps', 'active', 'center'],
  minDurationFor: (n) => 1.2 + n * 0.45,
  geometry,
  svg,
  animate,
};
