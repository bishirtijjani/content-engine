// layouts/funnel.mjs — stages that narrow, e.g. 1,000 visitors -> 20 customers.
//
// Real funnel geometry: each stage is a trapezoid narrower than the one above,
// stacked vertically. The stage value (if given) is prominent, the label under
// it. The narrowing is the whole point, so the shape carries the meaning.
import { text, polygon, r3, wrap } from '../primitives.mjs';
import { frameBox, svgOpen, svgClose, titleText } from './shared.mjs';

function geometry(spec, box, theme) {
  const stages = spec.stages;
  const n = stages.length;
  const fb = frameBox(spec, box);
  const { w, h, usableW, usableH } = fb;
  const gap = usableH * 0.03;
  const bandH = (usableH - gap * (n - 1)) / n;
  const topW = usableW;
  const bottomW = usableW * 0.26; // the funnel narrows to ~a quarter
  const cx = w / 2;
  const y0 = fb.top + fb.my;

  const bands = [];
  for (let i = 0; i < n; i++) {
    const yA = y0 + i * (bandH + gap);
    const yB = yA + bandH;
    const tA = n === 1 ? 0 : i / n;
    const tB = n === 1 ? 1 : (i + 1) / n;
    const wA = topW + (bottomW - topW) * tA;
    const wB = topW + (bottomW - topW) * tB;
    bands.push({
      i, yA, yB, wA, wB,
      points: [[cx - wA / 2, yA], [cx + wA / 2, yA], [cx + wB / 2, yB], [cx - wB / 2, yB]],
      label: stages[i].label ?? '',
      value: stages[i].value ?? null,
      icon: stages[i].icon ?? null,
      top: i === 0,
    });
  }
  const labelSize = Math.max(13, Math.min(bandH * 0.3, 26));
  const valueSize = Math.max(18, Math.min(bandH * 0.5, 40));
  return { ...fb, orientation: 'funnel', bands, labelSize, valueSize, cx };
}

function svg(geo, theme, ovId) {
  const [open] = svgOpen(geo.w, geo.h, ovId);
  const bands = geo.bands
    .map((b, i) => {
      const cls = i === 0 ? 'dg-funnel dg-funnel-accent' : 'dg-funnel';
      const shape = polygon({ points: b.points, cls });
      const midY = (b.yA + b.yB) / 2;
      const narrowW = Math.min(b.wA, b.wB);
      let textBlock = '';
      if (b.value) {
        // value prominent, label under it, both centred in the band
        textBlock += text({ x: geo.cx, y: midY - geo.labelSize * 0.4, cls: i === 0 ? 'dg-heading' : 'dg-value', anchor: 'middle', size: geo.valueSize, weight: 900, lines: [String(b.value)] });
        textBlock += text({ x: geo.cx, y: midY + geo.valueSize * 0.9, cls: 'dg-sub', anchor: 'middle', size: geo.labelSize, weight: 600, lines: wrap(b.label, Math.max(8, Math.floor((narrowW * 0.92) / (geo.labelSize * 0.56))), 1) });
      } else {
        textBlock += text({ x: geo.cx, y: midY + geo.labelSize * 0.2, cls: 'dg-heading', anchor: 'middle', size: geo.labelSize * 1.1, weight: 800, lines: wrap(b.label, Math.max(8, Math.floor((narrowW * 0.92) / (geo.labelSize * 0.56))), 1) });
      }
      return `<g class="dg-node dg-node-${i}"><g class="dg-node-anim">${shape}${textBlock}</g></g>`;
    })
    .join('');
  return open + titleText(geo) + bands + svgClose;
}

function animate(geo, { t0, dur, ovId }) {
  const s = `#${ovId}`;
  const line = (x) => `      ${x};`;
  const out = [];
  if (geo.title) {
    out.push(line(`tl.set('${s} .dg-title', {y:12}, ${r3(t0)})`));
    out.push(line(`tl.to('${s} .dg-title', {opacity:1, y:0, duration:0.35, ease:'power2.out'}, ${r3(t0)})`));
  }
  const n = geo.bands.length;
  const step = Math.max(0.3, Math.min(0.48, (dur * 0.5) / n));
  geo.bands.forEach((b, i) => {
    const at = t0 + 0.25 + i * step;
    out.push(line(`tl.set('${s} .dg-node-${i} .dg-node-anim', {opacity:0, y:-14, transformOrigin:'center center'}, ${r3(t0)})`));
    out.push(line(`tl.to('${s} .dg-node-${i} .dg-node-anim', {opacity:1, y:0, duration:0.4, ease:'power2.out'}, ${r3(at)})`));
  });
  const exitAt = Math.max(t0 + 0.6, t0 + dur - 0.35);
  out.push(line(`tl.to('${s} .dg-root', {opacity:0, y:-10, duration:0.35, ease:'power2.in'}, ${r3(exitAt)})`));
  return out;
}

export default {
  name: 'funnel',
  description: 'Stages that narrow like a funnel, with the count at each stage',
  frame: 'full',
  fields: ['title', 'stages'],
  minDurationFor: (n) => 1.1 + n * 0.45,
  geometry,
  svg,
  animate,
};
