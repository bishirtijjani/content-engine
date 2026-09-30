// layouts/flow.mjs — the first diagram: a sequence of steps joined by arrows.
//
// The layout composes against the actual frame box. A landscape box (16:9 long
// form) lays the steps in a row, left to right. A portrait box (9:16 short)
// stacks them, top to bottom. Same spec, same motion, two arrangements.
//
// Motion language (the reference for every future diagram):
//   title enters -> nodes stagger in -> each connector draws into the next
//   node -> one active node gets an orange ring and a single pulse -> hold ->
//   the whole diagram fades and drifts up on exit. It performs once, then is
//   still. Nothing loops.
import { rect, text, iconGroup, connector, r3 } from '../primitives.mjs';

const LANDSCAPE_RATIO = 1.15;
const STAGGER_MAX = 0.55;
const STAGGER_MIN = 0.28;

/** Wrap a label to at most two lines at a character budget (no DOM measurement). */
function wrap(label, maxChars) {
  const words = String(label).trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (!cur || next.length <= maxChars) cur = next;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > 2) lines.splice(1, lines.length - 1, lines.slice(1).join(' '));
  return lines;
}

/** Compute the whole geometry of the diagram for this frame box. */
function geometry(spec, box, theme) {
  const steps = spec.steps;
  const n = steps.length;
  const active = Number.isInteger(spec.active)
    ? Math.max(0, Math.min(n - 1, spec.active))
    : n - 1;
  const w = box.w;
  const h = box.h;
  const landscape = w / h >= LANDSCAPE_RATIO;
  const hasTitle = typeof spec.title === 'string' && spec.title.trim().length > 0;
  const mx = w * 0.06;
  const my = h * 0.05;
  const titleH = h * (landscape ? 0.16 : 0.12);
  const titleSize = Math.max(16, Math.min(titleH * 0.62, w * 0.05));
  const usableW = w - 2 * mx;
  const usableH = h - (hasTitle ? titleH : 0) - 2 * my;

  const nodes = [];
  const edges = [];

  if (landscape) {
    const gapMin = w * 0.045;
    let nodeH = usableH * 0.68;
    let nodeW = (usableW - (n - 1) * gapMin) / n;
    nodeW = Math.min(nodeW, nodeH * 1.5);
    nodeH = Math.min(nodeH, nodeW * 0.92);
    const gap = n > 1 ? (usableW - n * nodeW) / (n - 1) : 0;
    const totalW = n * nodeW + (n - 1) * gap;
    const startX = (w - totalW) / 2;
    const rowY = (hasTitle ? titleH : 0) + my + (usableH - nodeH) / 2;
    const cy = rowY + nodeH / 2;
    const iconSize = Math.min(nodeH * 0.26, nodeW * 0.34);
    // Size the label so the tallest wrapped label still fits inside the card.
    let labelSize = Math.max(14, Math.min(nodeH * 0.2, 40));
    let chars = Math.max(6, Math.floor((nodeW * 0.88) / (labelSize * 0.56)));
    let maxLines = 1;
    for (const st of steps) maxLines = Math.max(maxLines, wrap(st.label, chars).length);
    if (maxLines > 1) {
      labelSize = Math.max(12, Math.min(labelSize, (nodeH * 0.42) / (maxLines * 1.18)));
      chars = Math.max(6, Math.floor((nodeW * 0.88) / (labelSize * 0.56)));
    }

    steps.forEach((st, i) => {
      const x = startX + i * (nodeW + gap);
      const lines = wrap(st.label, chars);
      const iconX = (nodeW - iconSize) / 2;
      const iconY = nodeH * 0.12;
      const labelX = nodeW / 2;
      const labelY = nodeH * (lines.length > 1 ? 0.5 : 0.56) + labelSize * 0.85;
      nodes.push({
        x, y: rowY, w: nodeW, h: nodeH, active: i === active,
        lines, labelSize, labelX, labelY, labelAnchor: 'middle',
        icon: st.icon ? { name: st.icon, x: iconX, y: iconY, size: iconSize } : null,
      });
      if (i < n - 1) {
        const edge = connector({
          x1: x + nodeW, y1: cy, x2: startX + (i + 1) * (nodeW + gap), y2: cy, markerId: '__ARROW__',
        });
        edges.push({ ...edge, index: i });
      }
    });
  } else {
    const nodeW = usableW * 0.9;
    let nodeH = Math.min(usableH * 0.17, nodeW * 0.32);
    let gap = n > 1 ? (usableH - n * nodeH) / (n - 1) : 0;
    const minGap = h * 0.025;
    if (gap < minGap) {
      nodeH = (usableH - (n - 1) * minGap) / n;
      gap = minGap;
    }
    const totalH = n * nodeH + (n - 1) * gap;
    const startY = (hasTitle ? titleH : 0) + my + (usableH - totalH) / 2;
    const x = (w - nodeW) / 2;
    const labelSize = Math.max(14, Math.min(nodeH * 0.3, 36));
    const iconSize = Math.min(nodeH * 0.46, nodeW * 0.16);
    const iconX = nodeH * 0.28;
    const chars = Math.max(8, Math.floor((nodeW - nodeH * 0.9) / (labelSize * 0.56)));

    steps.forEach((st, i) => {
      const y = startY + i * (nodeH + gap);
      const lines = wrap(st.label, chars);
      const blockH = lines.length * labelSize * 1.18;
      const labelX = iconX + iconSize + nodeH * 0.3;
      const labelY = nodeH / 2 - blockH / 2 + labelSize * 0.85;
      nodes.push({
        x, y, w: nodeW, h: nodeH, active: i === active,
        lines, labelSize, labelX, labelY, labelAnchor: 'start',
        icon: st.icon ? { name: st.icon, x: iconX, y: (nodeH - iconSize) / 2, size: iconSize } : null,
      });
      if (i < n - 1) {
        const cx = w / 2;
        const edge = connector({
          x1: cx, y1: y + nodeH, x2: cx, y2: startY + (i + 1) * (nodeH + gap), markerId: '__ARROW__',
        });
        edges.push({ ...edge, index: i });
      }
    });
  }

  return {
    w,
    h,
    orientation: landscape ? 'landscape' : 'portrait',
    active,
    nodes,
    edges,
    title: hasTitle
      ? { text: spec.title.trim(), x: w / 2, y: my + titleSize, size: titleSize, anchor: 'middle' }
      : null,
  };
}

/** Emit the GSAP timeline lines for this diagram, offset to the overlay start. */
function animate(geo, { t0, dur, ovId }) {
  const s = `#${ovId}`;
  const n = geo.nodes.length;
  const line = (x) => `      ${x};`;
  const out = [];

  if (geo.title) {
    out.push(line(`tl.set('${s} .dg-title', {y:12}, ${r3(t0)})`));
    out.push(line(`tl.to('${s} .dg-title', {opacity:1, y:0, duration:0.35, ease:'power2.out'}, ${r3(t0)})`));
  }

  const step = Math.max(STAGGER_MIN, Math.min(STAGGER_MAX, (dur * 0.55) / n));
  const nodeStart = t0 + 0.25;
  const axis = geo.orientation === 'landscape' ? 'x' : 'y';

  geo.nodes.forEach((nd, i) => {
    const at = nodeStart + i * step;
    const from = JSON.stringify({ scale: 0.94, [axis]: -16 });
    out.push(line(`tl.set('${s} .dg-node-${i} .dg-node-anim', ${from}, ${r3(t0)})`));
    out.push(line(`tl.to('${s} .dg-node-${i} .dg-node-anim', {opacity:1, ${axis}:0, scale:1, duration:0.40, ease:'power2.out'}, ${r3(at)})`));
    if (i < n - 1) {
      const edge = geo.edges[i];
      out.push(line(`tl.set('${s} .dg-edge-${i} .dg-line', {strokeDashoffset:${r3(edge.length)}}, ${r3(t0)})`));
      out.push(line(`tl.to('${s} .dg-edge-${i} .dg-line', {strokeDashoffset:0, duration:0.30, ease:'power2.inOut'}, ${r3(at + 0.22)})`));
    }
  });

  const ringAt = nodeStart + (n - 1) * step + 0.55;
  out.push(line(`tl.to('${s} .dg-node-${geo.active} .dg-node-ring', {opacity:1, duration:0.25, ease:'power2.out'}, ${r3(ringAt)})`));
  out.push(line(`tl.fromTo('${s} .dg-node-${geo.active} .dg-node-anim', {scale:1}, {scale:1.05, duration:0.18, yoyo:true, repeat:1, ease:'power2.inOut'}, ${r3(ringAt)})`));

  const exitAt = Math.max(t0 + 0.6, t0 + dur - 0.35);
  out.push(line(`tl.to('${s} .dg-root', {opacity:0, y:-10, duration:0.35, ease:'power2.in'}, ${r3(exitAt)})`));

  return out;
}

export default {
  name: 'flow',
  description: 'Steps joined by arrows, revealed in order with one step highlighted',
  frame: 'full',
  steps: { min: 2, max: 5 },
  fields: ['title', 'steps', 'active'],
  minDurationFor: (n) => 1.0 + n * 0.45,
  geometry,
  animate,
};
