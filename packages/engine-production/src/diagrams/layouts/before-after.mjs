// layouts/before-after.mjs — a transformation from one state to another.
//
// Two panels joined by a bold transformation arrow in the middle. The before
// panel is muted, the after panel is the accent — so the change is the point.
// Landscape: side by side. Portrait: stacked with a downward arrow.
import { rect, text, iconGroup, connector, polygon, r3, wrap } from '../primitives.mjs';
import { frameBox, svgOpen, svgClose, titleText } from './shared.mjs';

function geometry(spec, box, theme) {
  const fb = frameBox(spec, box);
  const { w, h, landscape, usableW, usableH } = fb;
  const panels = [];
  let arrow;

  const panelH = landscape ? usableH * 0.86 : (usableH - h * 0.1) / 2;
  const labelSize = Math.max(16, Math.min(h * 0.06, 34));
  const pointSize = Math.max(13, Math.min(h * 0.04, 24));

  if (landscape) {
    const gap = w * 0.12;
    const pw = (usableW - gap) / 2;
    const py = fb.top + fb.my + (usableH - panelH) / 2;
    const leftX = fb.mx;
    const rightX = fb.mx + pw + gap;
    panels.push({ side: 'before', x: leftX, y: py, w: pw, h: panelH });
    panels.push({ side: 'after', x: rightX, y: py, w: pw, h: panelH });
    const ay = py + panelH / 2;
    arrow = connector({ x1: leftX + pw, y1: ay, x2: rightX, y2: ay, markerId: '__ARROW__' });
    arrow.cls = 'dg-line dg-arrow-line';
  } else {
    const pw = usableW * 0.86;
    const px = (w - pw) / 2;
    const gap = h * 0.1;
    const py = fb.top + fb.my;
    panels.push({ side: 'before', x: px, y: py, w: pw, h: panelH });
    panels.push({ side: 'after', x: px, y: py + panelH + gap, w: pw, h: panelH });
    const ax = w / 2;
    arrow = connector({ x1: ax, y1: py + panelH, x2: ax, y2: py + panelH + gap, markerId: '__ARROW__' });
    arrow.cls = 'dg-line dg-arrow-line';
  }

  panels.forEach((p) => {
    const side = spec[p.side] ?? {};
    p.label = side.label ?? p.side;
    p.icon = side.icon ?? null;
    p.points = Array.isArray(side.points) ? side.points.slice(0, 3) : [];
    p.accent = p.side === 'after';
    p.labelSize = labelSize;
    p.pointSize = pointSize;
    p.chars = Math.max(10, Math.floor((p.w - p.h * 0.9) / (labelSize * 0.56)));
  });

  return { ...fb, orientation: landscape ? 'landscape' : 'portrait', panels, arrow };
}

function panelSvg(p, theme) {
  const bg = rect({ w: p.w, h: p.h, r: theme.radius, cls: p.accent ? 'dg-panel-accent' : 'dg-panel-quiet' });
  const edge = p.accent ? rect({ w: p.w, h: p.h, r: theme.radius, cls: 'dg-panel-edge' }) : '';
  const iconSize = Math.min(p.h * 0.2, 44);
  const ic = p.icon ? iconGroup({ name: p.icon, x: p.h * 0.32, y: p.h * 0.26, size: iconSize }) : '';
  const tx = p.icon ? p.h * 0.32 + iconSize + p.h * 0.26 : p.w / 2;
  const anchor = p.icon ? 'start' : 'middle';
  const headY = p.h * 0.34;
  const head = text({ x: tx, y: headY, cls: 'dg-heading', anchor, size: p.labelSize, weight: 800, lines: wrap(p.label, Math.max(10, Math.floor((p.w - tx) / (p.labelSize * 0.56))), 2) });
  // render points as separate text lines for reliable spacing
  const pointLines = p.points.map((pt, i) => text({ x: tx, y: p.h * 0.58 + i * p.pointSize * 1.4, cls: 'dg-sub', anchor, size: p.pointSize, weight: 500, lines: [pt] })).join('');
  return bg + edge + ic + head + pointLines;
}

function svg(geo, theme, ovId) {
  const [open, arrowId] = svgOpen(geo.w, geo.h, ovId);
  const panels = geo.panels
    .map((p, i) => `<g class="dg-node dg-node-${i}" transform="translate(${r3(p.x)} ${r3(p.y)})"><g class="dg-node-anim">${panelSvg(p, theme)}</g></g>`)
    .join('');
  const arrow = `<g class="dg-edge dg-edge-0 dg-edge-anim" transform="translate(${r3(0)} ${r3(0)})">${geo.arrow.markup.replace('__ARROW__', arrowId)}</g>`;
  return open + titleText(geo) + arrow + panels + svgClose;
}

function animate(geo, { t0, dur, ovId }) {
  const s = `#${ovId}`;
  const line = (x) => `      ${x};`;
  const out = [];
  if (geo.title) {
    out.push(line(`tl.set('${s} .dg-title', {y:12}, ${r3(t0)})`));
    out.push(line(`tl.to('${s} .dg-title', {opacity:1, y:0, duration:0.35, ease:'power2.out'}, ${r3(t0)})`));
  }
  const horiz = geo.orientation === 'landscape';
  // before panel in
  out.push(line(`tl.set('${s} .dg-node-0 .dg-node-anim', {opacity:0, ${horiz ? 'x:-20' : 'y:-14'}}, ${r3(t0)})`));
  out.push(line(`tl.to('${s} .dg-node-0 .dg-node-anim', {opacity:1, x:0, y:0, duration:0.45, ease:'power2.out'}, ${r3(t0 + 0.25)})`));
  // transformation arrow draws
  out.push(line(`tl.set('${s} .dg-edge-0 .dg-line', {strokeDashoffset:${r3(geo.arrow.length)}}, ${r3(t0)})`));
  out.push(line(`tl.to('${s} .dg-edge-0 .dg-line', {strokeDashoffset:0, duration:0.5, ease:'power2.inOut'}, ${r3(t0 + 0.7)})`));
  // after panel in
  out.push(line(`tl.set('${s} .dg-node-1 .dg-node-anim', {opacity:0, ${horiz ? 'x:20' : 'y:14'}, scale:0.97}, ${r3(t0)})`));
  out.push(line(`tl.to('${s} .dg-node-1 .dg-node-anim', {opacity:1, x:0, y:0, scale:1, duration:0.45, ease:'back.out(1.4)'}, ${r3(t0 + 1.15)})`));
  const exitAt = Math.max(t0 + 0.6, t0 + dur - 0.35);
  out.push(line(`tl.to('${s} .dg-root', {opacity:0, y:-10, duration:0.35, ease:'power2.in'}, ${r3(exitAt)})`));
  return out;
}

export default {
  name: 'before-after',
  description: 'A transformation: a before state and an after state, joined by an arrow',
  frame: 'full',
  fields: ['title', 'before', 'after'],
  minDurationFor: () => 2.0,
  geometry,
  svg,
  animate,
};
