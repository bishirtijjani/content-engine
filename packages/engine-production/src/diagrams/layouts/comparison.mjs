// layouts/comparison.mjs — two or three alternatives side by side.
//
// Editorial panels: a heading, an optional icon, and a short list of points.
// One column can be highlighted (the recommended choice). A "vs" divider sits
// between panels. Landscape: columns. Portrait: stacked cards.
import { rect, text, iconGroup, circle, r3, wrap } from '../primitives.mjs';
import { frameBox, svgOpen, svgClose, titleText } from './shared.mjs';

function geometry(spec, box, theme) {
  const cols = spec.columns;
  const n = cols.length;
  const fb = frameBox(spec, box);
  const { w, h, landscape, usableW, usableH } = fb;
  const highlight = Number.isInteger(spec.highlight) ? Math.max(0, Math.min(n - 1, spec.highlight)) : -1;
  const panels = [];
  const labelSize = Math.max(16, Math.min(h * 0.055, 32));
  const pointSize = Math.max(12, Math.min(h * 0.036, 22));
  const maxPoints = Math.max(1, ...cols.map((c) => (Array.isArray(c.points) ? c.points.length : 0)));

  if (landscape) {
    const gap = w * 0.06;
    const pw = (usableW - gap * (n - 1)) / n;
    const ph = usableH * 0.9;
    const py = fb.top + fb.my + (usableH - ph) / 2;
    cols.forEach((c, i) => {
      panels.push({
        i, x: fb.mx + i * (pw + gap), y: py, w: pw, h: ph, highlight: i === highlight,
        label: c.label, icon: c.icon ?? null, points: (c.points ?? []).slice(0, 4),
      });
    });
  } else {
    const pw = usableW * 0.9;
    const gap = h * 0.03;
    const ph = (usableH - gap * (n - 1)) / n;
    cols.forEach((c, i) => {
      panels.push({
        i, x: (w - pw) / 2, y: fb.top + fb.my + i * (ph + gap), w: pw, h: ph, highlight: i === highlight,
        label: c.label, icon: c.icon ?? null, points: (c.points ?? []).slice(0, 4),
      });
    });
  }
  panels.forEach((p) => {
    p.labelSize = labelSize;
    p.pointSize = pointSize;
    p.chars = Math.max(10, Math.floor((p.w - p.h * 0.5) / (pointSize * 0.56)));
  });
  return { ...fb, orientation: landscape ? 'landscape' : 'portrait', panels, highlight, maxPoints, labelSize };
}

function panelSvg(p, theme) {
  const bg = rect({ w: p.w, h: p.h, r: theme.radius, cls: p.highlight ? 'dg-panel-accent' : 'dg-panel' });
  const edge = p.highlight ? rect({ w: p.w, h: p.h, r: theme.radius + 2, cls: 'dg-panel-edge' }) : '';
  const iconSize = Math.min(p.h * 0.16, 40);
  const padX = p.w * 0.1;
  const ic = p.icon ? iconGroup({ name: p.icon, x: padX, y: p.h * 0.14, size: iconSize }) : '';
  const titleX = p.icon ? padX + iconSize + p.w * 0.05 : p.w / 2;
  const titleAnchor = p.icon ? 'start' : 'middle';
  const head = text({ x: titleX, y: p.h * 0.14 + (p.icon ? iconSize * 0.85 : p.h * 0.12), cls: 'dg-heading', anchor: titleAnchor, size: p.labelSize, weight: 800, lines: wrap(p.label, Math.max(8, Math.floor((p.w - titleX - padX) / (p.labelSize * 0.56))), 2) });
  // divider under the heading
  const divY = p.h * 0.34;
  const divider = `<line class="dg-axis" x1="${r3(padX)}" y1="${r3(divY)}" x2="${r3(p.w - padX)}" y2="${r3(divY)}" style="stroke-opacity:.4"/>`;
  const points = p.points.map((pt, i) => {
    const yy = divY + p.pointSize * 1.9 + i * p.pointSize * 1.9;
    const dot = circle({ cx: padX + p.pointSize * 0.35, cy: yy - p.pointSize * 0.32, r: Math.max(3, p.pointSize * 0.16), cls: p.highlight ? 'dg-funnel-accent' : 'dg-marker' });
    const lines = wrap(pt, p.chars, 2);
    const txt = text({ x: padX + p.pointSize * 1.1, y: yy, cls: 'dg-sub', anchor: 'start', size: p.pointSize, weight: 500, lines });
    return dot + txt;
  }).join('');
  return bg + edge + ic + head + divider + points;
}

function svg(geo, theme, ovId) {
  const [open] = svgOpen(geo.w, geo.h, ovId);
  const panels = geo.panels
    .map((p, i) => `<g class="dg-node dg-node-${i}" transform="translate(${r3(p.x)} ${r3(p.y)})"><g class="dg-node-anim">${panelSvg(p, theme)}</g></g>`)
    .join('');
  // "vs" dividers between panels (landscape) — small circles with a dot
  const dividers = [];
  if (geo.orientation === 'landscape') {
    for (let i = 0; i < geo.panels.length - 1; i++) {
      const a = geo.panels[i];
      const b = geo.panels[i + 1];
      const cx = (a.x + a.w + b.x) / 2;
      const cy = a.y + a.h / 2;
      const r = Math.min(a.h * 0.08, 26);
      dividers.push(`<g class="dg-vs dg-vs-${i}"><circle class="dg-band-quiet" cx="${r3(cx)}" cy="${r3(cy)}" r="${r3(r)}"/><text x="${r3(cx)}" y="${r3(cy + r * 0.34)}" text-anchor="middle" class="dg-heading" style="font-size:${r3(r * 1.05)}px;font-weight:800">vs</text></g>`);
    }
  }
  return open + titleText(geo) + dividers.join('') + panels + svgClose;
}

function animate(geo, { t0, dur, ovId }) {
  const s = `#${ovId}`;
  const n = geo.panels.length;
  const line = (x) => `      ${x};`;
  const out = [];
  if (geo.title) {
    out.push(line(`tl.set('${s} .dg-title', {y:12}, ${r3(t0)})`));
    out.push(line(`tl.to('${s} .dg-title', {opacity:1, y:0, duration:0.35, ease:'power2.out'}, ${r3(t0)})`));
  }
  const horiz = geo.orientation === 'landscape';
  const step = Math.max(0.3, Math.min(0.5, (dur * 0.55) / n));
  const start = t0 + 0.3;
  geo.panels.forEach((p, i) => {
    const at = start + i * step;
    const from = JSON.stringify({ opacity: 0, scale: 0.96, [horiz ? 'y' : 'x']: horiz ? 16 : 16 });
    out.push(line(`tl.set('${s} .dg-node-${i} .dg-node-anim', ${from}, ${r3(t0)})`));
    out.push(line(`tl.to('${s} .dg-node-${i} .dg-node-anim', {opacity:1, y:0, x:0, scale:1, duration:0.45, ease:'power2.out'}, ${r3(at)})`));
  });
  // vs divider pops on the highlighted beat
  if (geo.orientation === 'landscape') {
    for (let i = 0; i < n - 1; i++) {
      out.push(line(`tl.fromTo('${s} .dg-vs-${i}', {opacity:0, scale:0.6, transformOrigin:'center center'}, {opacity:1, scale:1, duration:0.3, ease:'back.out(2)'}, ${r3(start + i * step + 0.3)})`));
    }
  }
  const exitAt = Math.max(t0 + 0.6, t0 + dur - 0.35);
  out.push(line(`tl.to('${s} .dg-root', {opacity:0, y:-10, duration:0.35, ease:'power2.in'}, ${r3(exitAt)})`));
  return out;
}

export default {
  name: 'comparison',
  description: 'Two or three alternatives compared as editorial panels, one highlighted',
  frame: 'full',
  fields: ['title', 'columns', 'highlight'],
  minDurationFor: (n) => 1.1 + n * 0.5,
  geometry,
  svg,
  animate,
};
