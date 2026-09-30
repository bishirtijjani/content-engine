// layouts/layers.mjs — conceptual or technical layers stacked together.
//
// Horizontal bands stacked top to bottom, each inset a little less than the one
// above so the stack reads as a tower. An up/down arrow and a "stack" bracket
// reinforce the layered idea. Top layer is the accent (what the user touches).
import { text, iconGroup, rect, path, r3, wrap } from '../primitives.mjs';
import { frameBox, svgOpen, svgClose, titleText } from './shared.mjs';

function geometry(spec, box, theme) {
  const layers = spec.layers;
  const n = layers.length;
  const fb = frameBox(spec, box);
  const { w, h, usableW, usableH } = fb;
  const gap = usableH * 0.025;
  const bandH = (usableH - gap * (n - 1)) / n;
  const minW = usableW * 0.7;
  const maxW = usableW;
  const labelSize = Math.max(14, Math.min(bandH * 0.34, 30));

  const bands = [];
  for (let i = 0; i < n; i++) {
    // inset: top band widest? No — a tower narrows to the top. Top layer higher.
    const t = n === 1 ? 0 : i / (n - 1); // 0 top .. 1 bottom
    const bw = minW + (maxW - minW) * t; // bottom (t=1) widest, top narrowest
    const x = (w - bw) / 2;
    const y = fb.top + fb.my + i * (bandH + gap);
    bands.push({ i, x, y, w: bw, h: bandH, top: i === 0, label: layers[i].label ?? '', icon: layers[i].icon ?? null, points: (layers[i].points ?? []).slice(0, 3) });
  }
  return { ...fb, orientation: 'layers', bands, labelSize, bandH };
}

function svg(geo, theme, ovId) {
  const [open] = svgOpen(geo.w, geo.h, ovId);
  const bands = geo.bands
    .map((b, i) => {
      const cls = i === 0 ? 'dg-panel-accent' : 'dg-band';
      const bg = rect({ w: b.w, h: b.h, r: theme.radius, cls });
      const iconSize = Math.min(b.h * 0.5, 34);
      const hasIcon = !!b.icon;
      const ic = hasIcon ? iconGroup({ name: b.icon, x: b.w * 0.07, y: (b.h - iconSize) / 2, size: iconSize }) : '';
      const tx = hasIcon ? b.w * 0.07 + iconSize + b.w * 0.04 : b.w * 0.06;
      const label = text({ x: tx, y: b.h / 2 + geo.labelSize * 0.2, cls: 'dg-heading', anchor: 'start', size: geo.labelSize, weight: 800, lines: [b.label] });
      // point chips on the right
      const chips = b.points.map((pt, k) => {
        const chipH = Math.min(b.h * 0.4, 34);
        const chipW = Math.min(pt.length * (geo.labelSize * 0.36) + 24, b.w * 0.3);
        const chipX = b.w - 18 - chipW;
        const chipY = (b.h - chipH) / 2 + (k - (b.points.length - 1) / 2) * (chipH + 8);
        return `<g class="dg-chip"><rect class="dg-chip-bg" x="${r3(chipX)}" y="${r3(chipY)}" width="${r3(chipW)}" height="${r3(chipH)}" rx="${r3(chipH / 2)}"/>` +
          text({ x: chipX + chipW / 2, y: chipY + chipH / 2 + geo.labelSize * 0.16, cls: 'dg-sub', anchor: 'middle', size: Math.min(geo.labelSize * 0.6, chipH * 0.5), weight: 600, lines: [pt] }) + `</g>`;
      }).join('');
      return `<g class="dg-node dg-node-${i}" transform="translate(${r3(b.x)} ${r3(b.y)})"><g class="dg-node-anim">${bg}${ic}${label}${chips}</g></g>`;
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
  const step = Math.max(0.28, Math.min(0.45, (dur * 0.5) / n));
  geo.bands.forEach((b, i) => {
    const at = t0 + 0.25 + i * step;
    out.push(line(`tl.set('${s} .dg-node-${i} .dg-node-anim', {opacity:0, x:-18}, ${r3(t0)})`));
    out.push(line(`tl.to('${s} .dg-node-${i} .dg-node-anim', {opacity:1, x:0, duration:0.4, ease:'power2.out'}, ${r3(at)})`));
  });
  const exitAt = Math.max(t0 + 0.6, t0 + dur - 0.35);
  out.push(line(`tl.to('${s} .dg-root', {opacity:0, y:-10, duration:0.35, ease:'power2.in'}, ${r3(exitAt)})`));
  return out;
}

export default {
  name: 'layers',
  description: 'Layers stacked top to bottom, each a band of one system tier',
  frame: 'full',
  fields: ['title', 'layers'],
  minDurationFor: (n) => 1.1 + n * 0.45,
  geometry,
  svg,
  animate,
};
