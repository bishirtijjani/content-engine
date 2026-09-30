// layouts/pipeline.mjs — stages progressing from start to finish.
//
// Flow's row/stack, but with a stage rail underneath: a numbered bar that fills
// stage by stage, so progress is the point. Nodes and connectors are the same
// visual language as Flow.
import { rect, text, iconGroup, connector, r3, wrap } from '../primitives.mjs';
import { frameBox, svgOpen, svgClose, titleText, card, fitLabel } from './shared.mjs';

function geometry(spec, box, theme) {
  const steps = spec.steps;
  const n = steps.length;
  const active = Number.isInteger(spec.progress) ? Math.max(0, Math.min(n - 1, spec.progress)) : n - 1;
  const fb = frameBox(spec, box);
  const { w, h, landscape, usableW, usableH } = fb;
  const nodes = [];
  const edges = [];
  // leave room at the bottom for the progress rail
  const railH = h * (landscape ? 0.09 : 0.06);
  const contentH = usableH - railH - h * 0.02;

  if (landscape) {
    const gapMin = w * 0.045;
    let nodeH = contentH * 0.9;
    let nodeW = (usableW - (n - 1) * gapMin) / n;
    nodeW = Math.min(nodeW, nodeH * 1.5);
    nodeH = Math.min(nodeH, nodeW * 0.92);
    const gap = n > 1 ? (usableW - n * nodeW) / (n - 1) : 0;
    const totalW = n * nodeW + (n - 1) * gap;
    const startX = (w - totalW) / 2;
    const rowY = fb.top + fb.my + (contentH - nodeH) / 2;
    const cy = rowY + nodeH / 2;
    const fits = fitLabel(steps.map((s) => s.label), { w: nodeW, h: nodeH, base: Math.min(nodeH * 0.2, 40) });
    steps.forEach((st, i) => {
      const x = startX + i * (nodeW + gap);
      const iconSize = Math.min(nodeH * 0.26, nodeW * 0.34);
      nodes.push({
        x, y: rowY, w: nodeW, h: nodeH, active: i === active, index: i,
        lines: wrap(st.label, fits.chars), labelSize: fits.size,
        icon: st.icon ? { name: st.icon, size: iconSize } : null,
      });
      if (i < n - 1) {
        const e = connector({ x1: x + nodeW, y1: cy, x2: startX + (i + 1) * (nodeW + gap), y2: cy, markerId: '__ARROW__' });
        edges.push({ ...e, index: i });
      }
    });
    const railY = fb.top + fb.my + contentH + h * 0.03;
    const rail = { x: startX, y: railY, w: totalW, h: railH * 0.5, n, active, landscape: true };
    return { ...fb, orientation: 'landscape', nodes, edges, rail };
  }

  const nodeW = usableW * 0.9;
  let nodeH = Math.min(contentH * 0.18, nodeW * 0.32);
  let gap = n > 1 ? (contentH - n * nodeH) / (n - 1) : 0;
  const minGap = h * 0.02;
  if (gap < minGap) { nodeH = (contentH - (n - 1) * minGap) / n; gap = minGap; }
  const totalH = n * nodeH + (n - 1) * gap;
  const startY = fb.top + fb.my + (contentH - totalH) / 2;
  const x = (w - nodeW) / 2;
  const labelSize = Math.max(14, Math.min(nodeH * 0.3, 36));
  steps.forEach((st, i) => {
    const iconSize = Math.min(nodeH * 0.46, nodeW * 0.16);
    const chars = Math.max(8, Math.floor((nodeW - nodeH * 0.9) / (labelSize * 0.56)));
    nodes.push({
      x, y: startY + i * (nodeH + gap), w: nodeW, h: nodeH, active: i === active, index: i,
      lines: wrap(st.label, chars), labelSize, icon: st.icon ? { name: st.icon, size: iconSize } : null,
    });
    if (i < n - 1) {
      const cx = w / 2;
      const e = connector({ x1: cx, y1: startY + i * (nodeH + gap) + nodeH, x2: cx, y2: startY + (i + 1) * (nodeH + gap), markerId: '__ARROW__' });
      edges.push({ ...e, index: i });
    }
  });
  const barH = h * 0.018;
  const rail = { x: x, y: startY + totalH + h * 0.04, w: nodeW, h: barH, n, active, landscape: false };
  return { ...fb, orientation: 'portrait', nodes, edges, rail };
}

function svg(geo, theme, ovId) {
  const [open, arrowId] = svgOpen(geo.w, geo.h, ovId);
  const edges = geo.edges
    .map((e, i) => `<g class="dg-edge dg-edge-${i}">${e.markup.replace('__ARROW__', arrowId)}</g>`)
    .join('');
  const cards = geo.nodes
    .map((nd, i) => card({
      x: nd.x, y: nd.y, w: nd.w, h: nd.h, index: i, r: theme.radius,
      lines: nd.lines, labelSize: nd.labelSize,
      icon: nd.icon?.name ?? null, iconSize: nd.icon?.size ?? 30,
      layout: geo.orientation === 'landscape' ? 'above' : 'left',
      active: nd.active,
    }))
    .join('');
  const rail = railSvg(geo.rail, theme);
  return open + titleText(geo) + edges + cards + rail + svgClose;
}

function railSvg(rail, theme) {
  if (!rail) return '';
  const { x, y, w, h, n, active, landscape } = rail;
  const stepW = n > 0 ? w / n : w;
  const parts = [`<g class="dg-rail">`];
  // track
  parts.push(rect({ x, y, w, h, r: h / 2, cls: 'dg-band-quiet' }));
  // filled portion up to the active stage
  const filled = stepW * (active + 1);
  parts.push(`<g class="dg-rail-fill">` + rect({ x, y, w: Math.max(h, filled), h, r: h / 2, cls: 'dg-funnel-accent' }) + `</g>`);
  for (let i = 0; i < n; i++) {
    const cx = x + stepW * (i + 0.5);
    const done = i <= active;
    const r = Math.max(4, h * 0.62);
    parts.push(`<g class="dg-rail-dot dg-rail-dot-${i}">` + `<circle class="${done ? 'dg-marker' : 'dg-marker-off'}" cx="${r3(cx)}" cy="${r3(y + h / 2)}" r="${r3(r)}"/>` + `</g>`);
  }
  parts.push(`</g>`);
  return parts.join('');
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
  const step = Math.max(0.28, Math.min(0.55, (dur * 0.55) / n));
  const nodeStart = t0 + 0.25;
  const axis = geo.orientation === 'landscape' ? 'x' : 'y';
  geo.nodes.forEach((nd, i) => {
    const at = nodeStart + i * step;
    const from = JSON.stringify({ scale: 0.94, [axis]: -16 });
    out.push(line(`tl.set('${s} .dg-node-${i} .dg-node-anim', ${from}, ${r3(t0)})`));
    out.push(line(`tl.to('${s} .dg-node-${i} .dg-node-anim', {opacity:1, ${axis}:0, scale:1, duration:0.40, ease:'power2.out'}, ${r3(at)})`));
    if (geo.edges[i]) {
      const e = geo.edges[i];
      out.push(line(`tl.set('${s} .dg-edge-${i} .dg-line', {strokeDashoffset:${r3(e.length)}}, ${r3(t0)})`));
      out.push(line(`tl.to('${s} .dg-edge-${i} .dg-line', {strokeDashoffset:0, duration:0.30, ease:'power2.inOut'}, ${r3(at + 0.22)})`));
    }
  });
  // rail reveals in step with the stages
  out.push(line(`tl.set('${s} .dg-rail', {opacity:0}, ${r3(t0)})`));
  out.push(line(`tl.to('${s} .dg-rail', {opacity:1, duration:0.3, ease:'power2.out'}, ${r3(nodeStart)})`));
  const revealAt = nodeStart + geo.rail.active * step;
  out.push(line(`tl.fromTo('${s} .dg-rail-fill', {scaleX:0}, {scaleX:1, transformOrigin:'left center', duration:${r3(Math.max(0.3, geo.rail.active * step + 0.3))}, ease:'power2.out'}, ${r3(nodeStart)})`));
  const ringAt = nodeStart + geo.rail.active * step + 0.45;
  out.push(line(`tl.to('${s} .dg-node-${geo.rail.active} .dg-node-ring', {opacity:1, duration:0.25, ease:'power2.out'}, ${r3(ringAt)})`));
  const exitAt = Math.max(t0 + 0.6, t0 + dur - 0.35);
  out.push(line(`tl.to('${s} .dg-root', {opacity:0, y:-10, duration:0.35, ease:'power2.in'}, ${r3(exitAt)})`));
  return out;
}

export default {
  name: 'pipeline',
  description: 'Stages progressing start to finish, with a progress rail',
  frame: 'full',
  steps: { min: 2, max: 5 },
  fields: ['title', 'steps', 'progress'],
  minDurationFor: (n) => 1.1 + n * 0.45,
  geometry,
  svg,
  animate,
};
