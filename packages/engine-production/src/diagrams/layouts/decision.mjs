// layouts/decision.mjs — a decision followed by branching outcomes.
//
// A diamond decision node, two elbow connectors branching to result cards
// (Yes / No). The diamond is visually distinct from the rounded result cards,
// so the decision reads as a decision. Landscape branches left/right; portrait
// branches top/down.
import { text, iconGroup, polygon, rect, path, r3, wrap } from '../primitives.mjs';
import { frameBox, svgOpen, svgClose, titleText } from './shared.mjs';

function diamond(cx, cy, rw, rh, cls) {
  return polygon({ points: [[cx, cy - rh], [cx + rw, cy], [cx, cy + rh], [cx - rw, cy]], cls });
}

function geometry(spec, box, theme) {
  const fb = frameBox(spec, box);
  const { w, h, landscape, usableW, usableH } = fb;
  const cx = w / 2;
  const questionSize = Math.max(13, Math.min(h * 0.042, 24));
  const resultSize = Math.max(15, Math.min(h * 0.05, 28));
  const branches = [];
  const results = [];

  if (landscape) {
    const dw = Math.min(usableW * 0.34, h * 0.36);
    const dh = dw * 0.6;
    const dyTop = fb.top + fb.my + usableH * 0.12;
    const dec = { cx, cy: dyTop + dh / 2, rw: dw / 2, rh: dh / 2 };
    const rw = usableW * 0.3;
    const rh = usableH * 0.34;
    const ry = fb.top + fb.my + usableH * 0.6;
    const right = { x: fb.mx + usableW - rw, y: ry, w: rw, h: rh, key: 'yes' };
    const left = { x: fb.mx, y: ry, w: rw, h: rh, key: 'no' };
    branches.push(elbow(dec.cx + dec.rw, dec.cy, right.x, right.y + rh / 2));
    branches.push(elbow(dec.cx - dec.rw, dec.cy, left.x + rw, left.y + rh / 2));
    results.push(right, left);
    return finish(fb, 'landscape', dec, results, branches, questionSize, resultSize);
  }

  const dw = Math.min(usableW * 0.62, h * 0.34);
  const dh = dw * 0.6;
  const dyTop = fb.top + fb.my + usableH * 0.1;
  const dec = { cx, cy: dyTop + dh / 2, rw: dw / 2, rh: dh / 2 };
  const rw = usableW * 0.82;
  const rh = usableH * 0.19;
  const laneY = fb.top + fb.my + usableH * 0.58;
  const gapY = usableH * 0.05;
  const first = { x: (w - rw) / 2, y: laneY, w: rw, h: rh, key: 'yes' };
  const second = { x: (w - rw) / 2, y: laneY + rh + gapY, w: rw, h: rh, key: 'no' };
  branches.push(elbowDown(dec.cx, dec.cy + dec.rh, first.x + rw * 0.5, first.y));
  branches.push(elbowDown(dec.cx, dec.cy + dec.rh, second.x + rw * 0.5, second.y));
  results.push(first, second);
  return finish(fb, 'portrait', dec, results, branches, questionSize, resultSize);
}

/** Curved elbow from a diamond side to a target point (landscape). */
function elbow(x0, y0, x1, y1) {
  const d = `M${r3(x0)} ${r3(y0)} C${r3(x0 + (x1 - x0) * 0.5)} ${r3(y0)} ${r3(x1)} ${r3(y1 - (y1 - y0) * 0.4)} ${r3(x1)} ${r3(y1)}`;
  return path({ d, cls: 'dg-line', markerId: '__ARROW__' });
}

/** Orthogonal elbow from the diamond bottom to a target point (portrait). */
function elbowDown(x0, y0, x1, y1) {
  const my = y0 + (y1 - y0) * 0.5;
  const d = `M${r3(x0)} ${r3(y0)} L${r3(x0)} ${r3(my)} L${r3(x1)} ${r3(my)} L${r3(x1)} ${r3(y1)}`;
  return path({ d, cls: 'dg-line', markerId: '__ARROW__' });
}

function finish(fb, orientation, dec, results, branches, questionSize, resultSize) {
  const sides = [results[0], results[1]];
  return { ...fb, orientation, decision: dec, results: sides, branches, questionSize, resultSize };
}

/** Attach the question, branch labels and result content (done in geometry wrapper). */
function enrich(geo, spec) {
  geo.question = spec.question;
  geo.questionLines = wrap(spec.question, Math.max(8, Math.floor((geo.decision.rw * 1.55) / (geo.questionSize * 0.56))), 3);
  const sides = [
    { content: spec.yes ?? {}, tag: spec.yesLabel ?? 'Yes' },
    { content: spec.no ?? {}, tag: spec.noLabel ?? 'No' },
  ];
  geo.results.forEach((rr, i) => {
    const { content, tag } = sides[i];
    rr.tag = tag;
    rr.label = content.label ?? '';
    rr.icon = content.icon ?? null;
    const iconSize = Math.min(rr.h * 0.46, 32);
    rr.iconSize = iconSize;
    rr.textX = rr.icon ? rr.w * 0.1 + iconSize + rr.w * 0.06 : rr.w / 2;
    rr.labelLines = wrap(rr.label, Math.max(8, Math.floor((rr.w - rr.textX) / (geo.resultSize * 0.56))), 2);
    rr.tagLines = rr.tag;
  });
  return geo;
}

function svg(geo, theme, ovId) {
  const [open, arrowId] = svgOpen(geo.w, geo.h, ovId);
  const dec = geo.decision;
  const diamondBody =
    diamond(dec.cx, dec.cy, dec.rw, dec.rh, 'dg-node-bg') +
    diamond(dec.cx, dec.cy, dec.rw, dec.rh, 'dg-node-ring') +
    text({ x: dec.cx, y: dec.cy - (geo.questionLines.length - 1) * geo.questionSize * 0.59 + geo.questionSize * 0.34, cls: 'dg-heading', anchor: 'middle', size: geo.questionSize, weight: 800, lines: geo.questionLines });
  const decision = `<g class="dg-node dg-node-dec"><g class="dg-node-anim">${diamondBody}</g></g>`;
  const branches = geo.branches
    .map((b, i) => `<g class="dg-edge dg-edge-${i}">${b.markup.replace('__ARROW__', arrowId)}</g>`)
    .join('');
  const results = geo.results
    .map((rr, i) => {
      const bg = rect({ w: rr.w, h: rr.h, r: theme.radius, cls: rr.key === 'yes' ? 'dg-panel-accent' : 'dg-panel' });
      const ic = rr.icon ? iconGroup({ name: rr.icon, x: rr.w * 0.1, y: (rr.h - rr.iconSize) / 2, size: rr.iconSize }) : '';
      const label = text({ x: rr.textX, y: rr.h / 2 - (rr.labelLines.length - 1) * geo.resultSize * 0.59 + geo.resultSize * 0.18, cls: 'dg-heading', anchor: rr.icon ? 'start' : 'middle', size: geo.resultSize, weight: 700, lines: rr.labelLines });
      // branch tag as a small pill just above the card, on the side the branch enters
      const tagSize = rr.h * 0.2;
      const tagText = rr.tag;
      const tagW = Math.max(tagSize * 1.4, tagText.length * tagSize * 0.62 + tagSize);
      const tagCx = rr.key === 'yes' ? rr.w * 0.22 : rr.w * 0.78;
      const tagCy = -tagSize * 0.9;
      const tag = `<g class="dg-tag"><rect class="dg-panel" x="${r3(tagCx - tagW / 2)}" y="${r3(tagCy - tagSize * 0.72)}" width="${r3(tagW)}" height="${r3(tagSize * 1.44)}" rx="${r3(tagSize * 0.72)}"/>` +
        text({ x: tagCx, y: tagCy + tagSize * 0.32, cls: 'dg-accent-text', anchor: 'middle', size: tagSize, weight: 800, lines: [tagText] }) + `</g>`;
      return `<g class="dg-node dg-node-res-${i}" transform="translate(${r3(rr.x)} ${r3(rr.y)})"><g class="dg-node-anim">${bg}${ic}${label}</g>${tag}</g>`;
    })
    .join('');
  return open + titleText(geo) + branches + decision + results + svgClose;
}

function animate(geo, { t0, dur, ovId }) {
  const s = `#${ovId}`;
  const line = (x) => `      ${x};`;
  const out = [];
  if (geo.title) {
    out.push(line(`tl.set('${s} .dg-title', {y:12}, ${r3(t0)})`));
    out.push(line(`tl.to('${s} .dg-title', {opacity:1, y:0, duration:0.35, ease:'power2.out'}, ${r3(t0)})`));
  }
  out.push(line(`tl.set('${s} .dg-node-dec .dg-node-anim', {scale:0.82, transformOrigin:'center center'}, ${r3(t0)})`));
  out.push(line(`tl.to('${s} .dg-node-dec .dg-node-anim', {opacity:1, scale:1, duration:0.45, ease:'back.out(1.6)'}, ${r3(t0 + 0.3)})`));
  geo.branches.forEach((b, i) => {
    out.push(line(`tl.set('${s} .dg-edge-${i} .dg-line', {strokeDashoffset:${r3(b.length)}}, ${r3(t0)})`));
    out.push(line(`tl.to('${s} .dg-edge-${i} .dg-line', {strokeDashoffset:0, duration:0.5, ease:'power2.inOut'}, ${r3(t0 + 0.85 + i * 0.1)})`));
  });
  geo.results.forEach((rr, i) => {
    const at = t0 + 1.35 + i * 0.35;
    out.push(line(`tl.set('${s} .dg-node-res-${i} .dg-node-anim', {opacity:0, scale:0.95}, ${r3(t0)})`));
    out.push(line(`tl.to('${s} .dg-node-res-${i} .dg-node-anim', {opacity:1, scale:1, duration:0.4, ease:'power2.out'}, ${r3(at)})`));
  });
  const exitAt = Math.max(t0 + 0.6, t0 + dur - 0.35);
  out.push(line(`tl.to('${s} .dg-root', {opacity:0, y:-10, duration:0.35, ease:'power2.in'}, ${r3(exitAt)})`));
  return out;
}

export default {
  name: 'decision',
  description: 'A decision with a Yes and a No branch leading to outcomes',
  frame: 'full',
  fields: ['title', 'question', 'yes', 'no', 'yesLabel', 'noLabel'],
  minDurationFor: () => 2.2,
  geometry: (spec, box, theme) => enrich(geometry(spec, box, theme), spec),
  svg,
  animate,
};
