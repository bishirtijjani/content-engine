// layouts/timeline.mjs — events along a time axis.
//
// A real axis line with tick markers. Landscape: horizontal axis, labels
// alternate above/below. Portrait: vertical axis, labels to the right.
import { text, line, tick, circle, r3, wrap } from '../primitives.mjs';
import { frameBox, svgOpen, svgClose, titleText } from './shared.mjs';

function geometry(spec, box, theme) {
  const events = spec.events;
  const n = events.length;
  const fb = frameBox(spec, box);
  const { w, h, landscape, usableW, usableH } = fb;
  const active = Number.isInteger(spec.active) ? Math.max(0, Math.min(n - 1, spec.active)) : n - 1;
  const nodes = [];
  let axis;

  if (landscape) {
    const ax = fb.mx + usableW * 0.08;
    const bx = fb.mx + usableW * 0.92;
    const y = fb.top + fb.my + usableH * 0.44;
    axis = { x1: ax, y1: y, x2: bx, y2: y };
    const span = bx - ax;
    const labelSize = Math.max(15, Math.min(h * 0.055, 30));
    events.forEach((ev, i) => {
      const x = ax + (span * i) / (n - 1 || 1);
      const above = i % 2 === 0;
      const when = ev.when ? String(ev.when) : '';
      const lineGap = labelSize * 1.5;
      const whenY = above ? y - h * 0.08 : y + h * 0.135;
      const labelY = above ? whenY - lineGap : whenY + lineGap;
      nodes.push({
        index: i, x, y, active: i === active,
        lines: wrap(ev.label, Math.max(10, Math.floor(w * 0.2 / (labelSize * 0.56))), 2),
        labelSize, when, above, whenY, labelY,
      });
    });
  } else {
    const x = fb.mx + usableW * 0.28;
    const ay = fb.top + fb.my + usableH * 0.05;
    const by = fb.top + fb.my + usableH * 0.95;
    axis = { x1: x, y1: ay, x2: x, y2: by };
    const span = by - ay;
    const labelSize = Math.max(14, Math.min(w * 0.045, 26));
    events.forEach((ev, i) => {
      const y = ay + (span * i) / (n - 1 || 1);
      const when = ev.when ? String(ev.when) : '';
      nodes.push({
        index: i, x, y, active: i === active,
        lines: wrap(ev.label, Math.max(10, Math.floor(usableW * 0.52 / (labelSize * 0.56))), 2),
        labelSize, when, above: true, whenY: y - 2, labelY: y + labelSize * 1.5,
      });
    });
  }
  return { ...fb, orientation: landscape ? 'landscape' : 'portrait', axis, nodes, active };
}

function svg(geo, theme, ovId) {
  const [open] = svgOpen(geo.w, geo.h, ovId);
  const parts = [];
  parts.push(`<g class="dg-axisg">${line({ x1: geo.axis.x1, y1: geo.axis.y1, x2: geo.axis.x2, y2: geo.axis.y2 })}</g>`);
  const horizontal = geo.orientation === 'landscape';
  geo.nodes.forEach((nd, i) => {
    const tickEl = horizontal
      ? tick({ x: nd.x, y: nd.y, len: geo.h * 0.022 })
      : tick({ x: nd.x, y: nd.y, len: geo.w * 0.022, vertical: true });
    const ring = nd.active
      ? `<circle class="dg-node-ring2" cx="${r3(nd.x)}" cy="${r3(nd.y)}" r="${r3(Math.max(13, geo.h * 0.03))}"/>`
      : '';
    const marker = circle({ cx: nd.x, cy: nd.y, r: Math.max(7, geo.h * 0.014), cls: nd.active ? 'dg-marker' : 'dg-marker-on' });

    let block = '';
    if (horizontal) {
      const when = nd.when
        ? text({ x: nd.x, y: nd.whenY, cls: 'dg-heading', anchor: 'middle', size: nd.labelSize * 1.05, weight: 900, lines: [nd.when] })
        : '';
      const label = text({ x: nd.x, y: nd.labelY, cls: 'dg-sub', anchor: 'middle', size: nd.labelSize * 0.86, weight: 600, lines: nd.lines });
      block = when + label;
    } else {
      const when = nd.when
        ? text({ x: nd.x + geo.w * 0.06, y: nd.y - nd.labelSize * 0.4, cls: 'dg-heading', anchor: 'start', size: nd.labelSize * 0.9, weight: 900, lines: [nd.when] })
        : '';
      const label = text({ x: nd.x + geo.w * 0.06, y: nd.y + nd.labelSize * 0.75, cls: 'dg-sub', anchor: 'start', size: nd.labelSize * 0.82, weight: 600, lines: nd.lines });
      block = when + label;
    }
    parts.push(`<g class="dg-node dg-node-${i}"><g class="dg-node-anim">${ring}${tickEl}${marker}${block}</g></g>`);
  });
  return open + titleText(geo) + parts.join('') + svgClose;
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
  const horiz = geo.orientation === 'landscape';
  // axis draws first
  out.push(line(`tl.set('${s} .dg-axisg', {opacity:0}, ${r3(t0)})`));
  out.push(line(`tl.to('${s} .dg-axisg', {opacity:1, duration:0.3, ease:'power2.out'}, ${r3(t0 + 0.15)})`));
  const step = Math.max(0.28, Math.min(0.5, (dur * 0.55) / n));
  const start = t0 + 0.4;
  geo.nodes.forEach((nd, i) => {
    const at = start + i * step;
    const from = horiz ? { opacity: 0, y: nd.above ? -10 : 10 } : { opacity: 0, x: 12 };
    out.push(line(`tl.set('${s} .dg-node-${i} .dg-node-anim', ${JSON.stringify(from)}, ${r3(t0)})`));
    out.push(line(`tl.to('${s} .dg-node-${i} .dg-node-anim', {opacity:1, y:0, x:0, duration:0.38, ease:'power2.out'}, ${r3(at)})`));
  });
  const exitAt = Math.max(t0 + 0.6, t0 + dur - 0.35);
  out.push(line(`tl.to('${s} .dg-root', {opacity:0, y:-10, duration:0.35, ease:'power2.in'}, ${r3(exitAt)})`));
  return out;
}

export default {
  name: 'timeline',
  description: 'Events placed along a time axis with dated markers',
  frame: 'full',
  fields: ['title', 'events', 'active'],
  minDurationFor: (n) => 1.0 + n * 0.4,
  geometry,
  svg,
  animate,
};
