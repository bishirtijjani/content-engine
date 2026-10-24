// diagrams/layouts/charts/sankey.mjs — flow bands between columns.
import { checkLabel, checkCount, MAX_TITLE, playTime } from '../../spec.mjs';
import { titleBlock } from '../_common.mjs';
import { bandPath } from '../../charts/scales.mjs';
import { PALETTE } from '../../charts/palette.mjs';

export default {
  name: 'sankey',
  description: 'Flows between nodes, band width carrying the value',
  frame: 'full',
  fields: ['title', 'nodes', 'links'],

  minDurationFor(n) { return playTime(1.4, 0.35, n); },

  validate(spec) {
    const out = [];
    if (spec?.title != null) checkLabel(spec.title, 'title', out, { max: MAX_TITLE, required: false });
    const nodes = Array.isArray(spec?.nodes) ? spec.nodes : [];
    checkCount(nodes, 'nodes', out, 2, 8);
    const ids = new Set();
    nodes.forEach((n, i) => {
      if (!n?.id) out.push(`nodes[${i}] needs an id`);
      else if (ids.has(n.id)) out.push(`nodes[${i}] id "${n.id}" is used twice`);
      else ids.add(n.id);
      checkLabel(n?.label, `nodes[${i}].label`, out, { max: 20 });
    });
    const links = Array.isArray(spec?.links) ? spec.links : [];
    checkCount(links, 'links', out, 1, 10);
    links.forEach((l, i) => {
      if (!ids.has(l?.from)) out.push(`links[${i}].from must be a node id`);
      if (!ids.has(l?.to)) out.push(`links[${i}].to must be a node id`);
      if (!(Number(l?.value) > 0)) out.push(`links[${i}].value must be positive`);
    });
    return out;
  },

  slots(spec) {
    const out = [];
    if (spec?.title) out.push('title');
    (Array.isArray(spec?.nodes) ? spec.nodes : []).forEach((n) => out.push(`node-${n.id}`));
    (Array.isArray(spec?.links) ? spec.links : []).forEach((_, i) => out.push(`flow-${i}`));
    return out;
  },

  build(spec, c, P) {
    const nodesData = Array.isArray(spec?.nodes) ? spec.nodes : [];
    const links = (Array.isArray(spec?.links) ? spec.links : []).map((l) => ({ ...l, value: Number(l.value) }));
    const { node: title, body } = titleBlock(spec, c, P, { ratio: 0.09, landscapeRatio: 0.13 });
    const nodes = [];
    const bands = [];
    const build = [];
    if (title) { nodes.push(title); build.push(['title']); }

    const plot = { x: body.x + body.w * 0.04, y: body.y + body.h * 0.06, w: body.w * 0.92, h: body.h * 0.88 };
    const depth = new Map(nodesData.map((n) => [n.id, 0]));
    for (let k = 0; k < nodesData.length; k++) {
      for (const l of links) {
        if (depth.has(l.from) && depth.has(l.to)) depth.set(l.to, Math.max(depth.get(l.to), depth.get(l.from) + 1));
      }
    }
    const maxDepth = Math.max(...depth.values());
    const columns = new Map();
    for (const n of nodesData) {
      const d = depth.get(n.id);
      if (!columns.has(d)) columns.set(d, []);
      columns.get(d).push(n);
    }

    const inSum = new Map(nodesData.map((n) => [n.id, 0]));
    const outSum = new Map(nodesData.map((n) => [n.id, 0]));
    links.forEach((l) => {
      outSum.set(l.from, outSum.get(l.from) + l.value);
      inSum.set(l.to, inSum.get(l.to) + l.value);
    });
    const through = new Map(nodesData.map((n) => [n.id, Math.max(inSum.get(n.id), outSum.get(n.id), 1)]));
    let maxColSum = 0;
    for (const list of columns.values()) maxColSum = Math.max(maxColSum, list.reduce((s, n) => s + through.get(n.id), 0));
    const nodeW = Math.min(plot.w * 0.16, P.unit * 0.15);
    const gap = P.unit * 0.022;
    const scale = (plot.h - gap * (Math.max(...[...columns.values()].map((x) => x.length), 1) - 1)) / Math.max(1, maxColSum);

    const boxes = new Map();
    const cursorY = new Map();
    for (const [d, list] of [...columns.entries()].sort((a, b) => a[0] - b[0])) {
      const total = list.reduce((s, n) => s + through.get(n.id) * scale, 0) + gap * (list.length - 1);
      let y = plot.y + (plot.h - total) / 2;
      const x = maxDepth === 0 ? plot.x : plot.x + (d * (plot.w - nodeW)) / maxDepth;
      for (const n of list) {
        const h = through.get(n.id) * scale;
        const box = { x, y, w: nodeW, h: Math.max(h, P.unit * 0.06) };
        boxes.set(n.id, box);
        cursorY.set(n.id, { out: y, in: y });
        y += box.h + gap;
      }
    }

    const palette = (i) => PALETTE[i % PALETTE.length];
    links.forEach((l, i) => {
      const a = boxes.get(l.from);
      const b = boxes.get(l.to);
      if (!a || !b) return;
      const thick = l.value * scale;
      const ca = cursorY.get(l.from);
      const cb = cursorY.get(l.to);
      const y0 = ca.out;
      const y1 = cb.in;
      ca.out += thick;
      cb.in += thick;
      bands.push(P.shape(`flow-${i}`, plot, {
        shape: 'path',
        d: bandPath(a.x + a.w, y0 - plot.y, y0 + thick - plot.y, b.x, y1 - plot.y, y1 + thick - plot.y),
        fill: palette(i), opacity: 0.28,
      }));
    });

    nodesData.forEach((n, i) => {
      const box = boxes.get(n.id);
      const tone = i === 0 ? 'amber' : 'blue';
      const fg = i === 0 ? 'blue' : 'text';
      nodes.push(P.card(`node-${n.id}`, box, {
        tone, r: 14,
        children: [P.text(`node-${n.id}-t`, { x: box.x + 10, y: box.y, w: box.w - 20, h: box.h }, {
          value: n.label, size: P.unit * 0.021, weight: 800, font: 'display', color: fg,
          align: 'center', valign: 'center', wrap: 14, maxLines: 2, slot: false,
        }, box)],
      }));
      build.push([`node-${n.id}`]);
    });
    links.forEach((_, i) => build.push([`flow-${i}`]));

    return { nodes: [...bands, ...nodes], build };
  },
};
