// diagrams/layouts/process/state-machine.mjs — states and labelled transitions.
import { checkLabel, checkCount, MAX_TITLE, MAX_LABEL, MAX_NOTE, playTime } from '../../spec.mjs';
import { titleBlock } from '../_common.mjs';
import { wrapChars } from '../../primitives.mjs';

function trim(from, to) {
  const ca = { x: from.x + from.w / 2, y: from.y + from.h / 2 };
  const cb = { x: to.x + to.w / 2, y: to.y + to.h / 2 };
  const dx = cb.x - ca.x;
  const dy = cb.y - ca.y;
  const hit = (b, ox, oy, vx, vy) => {
    const tx = vx > 0 ? (b.x + b.w - ox) / vx : vx < 0 ? (b.x - ox) / vx : Infinity;
    const ty = vy > 0 ? (b.y + b.h - oy) / vy : vy < 0 ? (b.y - oy) / vy : Infinity;
    const t = Math.min(tx, ty);
    return { x: ox + vx * t, y: oy + vy * t };
  };
  return [hit(from, ca.x, ca.y, dx, dy), hit(to, cb.x, cb.y, -dx, -dy)];
}

export default {
  name: 'state-machine',
  description: 'States and the transitions between them',
  frame: 'full',
  fields: ['title', 'states', 'transitions'],

  minDurationFor(n) { return playTime(1.3, 0.35, n); },

  validate(spec) {
    const out = [];
    if (spec?.title != null) checkLabel(spec.title, 'title', out, { max: MAX_TITLE, required: false });
    const states = Array.isArray(spec?.states) ? spec.states : [];
    checkCount(states, 'states', out, 2, 6);
    const ids = new Set();
    states.forEach((s, i) => {
      if (!s?.id) out.push(`states[${i}] needs an id`);
      else if (ids.has(s.id)) out.push(`states[${i}] id "${s.id}" is used twice`);
      else ids.add(s.id);
      checkLabel(s?.label, `states[${i}].label`, out, { max: MAX_LABEL });
    });
    const trans = Array.isArray(spec?.transitions) ? spec.transitions : [];
    checkCount(trans, 'transitions', out, 1, 8);
    trans.forEach((t, i) => {
      if (!ids.has(t?.from)) out.push(`transitions[${i}].from must be a state id`);
      if (!ids.has(t?.to)) out.push(`transitions[${i}].to must be a state id`);
      if (t?.label != null) checkLabel(t.label, `transitions[${i}].label`, out, { max: MAX_NOTE, required: false });
    });
    return out;
  },

  slots(spec) {
    const out = [];
    if (spec?.title) out.push('title');
    (Array.isArray(spec?.states) ? spec.states : []).forEach((s) => out.push(`state-${s.id}`));
    (Array.isArray(spec?.transitions) ? spec.transitions : []).forEach((_, i) => out.push(`trans-${i}`));
    return out;
  },

  build(spec, c, P) {
    const states = Array.isArray(spec?.states) ? spec.states : [];
    const trans = Array.isArray(spec?.transitions) ? spec.transitions : [];
    const { node: title, body } = titleBlock(spec, c, P, { ratio: 0.09, landscapeRatio: 0.13 });
    const nodes = [];
    const edges = [];
    const build = [];
    if (title) { nodes.push(title); build.push(['title']); }

    const cols = c.landscape ? Math.min(states.length, states.length <= 3 ? states.length : 3) : 2;
    const rows = Math.ceil(states.length / cols);
    const gapX = body.w * 0.08;
    const gapY = body.h * 0.10;
    const w = (body.w - gapX * (cols - 1)) / cols;
    const rowH = (body.h - gapY * (rows - 1)) / rows;
    const h = Math.min(rowH, P.unit * 0.42);
    const padY = (rowH - h) / 2;
    const boxes = new Map();

    states.forEach((s, i) => {
      const r = Math.floor(i / cols);
      const k = i % cols;
      const box = { x: body.x + k * (w + gapX), y: body.y + padY + r * (rowH + gapY), w, h };
      boxes.set(s.id, box);
      const tone = s.tone ?? (i === 0 ? 'amber' : 'blue');
      const fg = tone === 'amber' ? 'blue' : 'text';
      const size = P.theme.type.node * P.unit * 0.82;
      nodes.push(P.card(`state-${s.id}`, box, {
        tone, r: 34,
        children: [P.text(`state-${s.id}-t`, { x: box.x + 18, y: box.y, w: box.w - 36, h: box.h }, {
          value: s.label, size, weight: 800, font: 'display', color: fg,
          align: 'center', valign: 'center', wrap: wrapChars(box.w - 36, size), maxLines: 2, slot: false,
        }, box)],
      }));
      build.push([`state-${s.id}`]);
    });

    // Bidirectional pairs get parallel offsets so both arrows and labels read.
    const pairKey = (a, b) => [a, b].sort().join('|');
    const pairCount = new Map();
    trans.forEach((t) => {
      const k = pairKey(t.from, t.to);
      pairCount.set(k, (pairCount.get(k) ?? 0) + 1);
    });
    const pairSeen = new Map();
    trans.forEach((t, i) => {
      const from = boxes.get(t.from);
      const to = boxes.get(t.to);
      if (!from || !to) return;
      const pts = trim(from, to);
      const k = pairKey(t.from, t.to);
      const dual = pairCount.get(k) > 1;
      const idx = pairSeen.get(k) ?? 0;
      if (dual) pairSeen.set(k, idx + 1);
      const len = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) || 1;
      edges.push(P.edge(`trans-${i}`, pts, {
        // Two transitions between the same pair bend opposite ways and carry
        // labels on opposite sides, so both stay readable.
        curve: dual ? 'arc' : 'polyline',
        bend: dual ? ((idx % 2 === 0 ? 1 : -1) * P.unit * 0.05) / len : 0.18,
        labelOffset: dual ? { dx: 0, dy: idx % 2 === 0 ? 0.030 : -0.030 } : undefined,
        strokeWidth: 3, arrowSize: Math.round(P.unit * 0.022),
        label: t.label, labelSize: P.unit * 0.017,
      }));
      build.push([`trans-${i}`]);
    });

    return { nodes: [...nodes, ...edges], build };
  },
};
