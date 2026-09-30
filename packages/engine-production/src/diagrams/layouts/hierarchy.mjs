// layouts/hierarchy.mjs — parent/child relationships across levels.
//
// A root node on top, then one row per level of children; orthogonal elbow
// connectors run from each parent down to its children. Levels are clearly
// separated, so depth reads at a glance.
import { text, iconGroup, rect, path, r3, wrap } from '../primitives.mjs';
import { frameBox, svgOpen, svgClose, titleText } from './shared.mjs';

function geometry(spec, box, theme) {
  const levels = spec.levels;
  const fb = frameBox(spec, box);
  const { w, h, usableW, usableH } = fb;
  const rows = [];
  const edges = [];

  const depth = levels.length + 1;
  const rowGap = usableH * 0.06;
  const rowH = (usableH - rowGap * (depth - 1)) / depth;
  const labelSize = Math.max(13, Math.min(rowH * 0.32, 28));

  let y = fb.top + fb.my;
  // root row
  const rootW = Math.min(usableW * 0.42, w * 0.5);
  const rootNode = { x: (w - rootW) / 2, y, w: rootW, h: rowH, label: spec.root?.label ?? '', icon: spec.root?.icon ?? null, key: 'root' };
  const allRows = [[rootNode]];
  y += rowH + rowGap;

  levels.forEach((row, li) => {
    const n = row.length;
    const gap = Math.min(usableW * 0.06, w * 0.03);
    // child width shrinks with count; levels with more children get thinner cards
    const cw = Math.min((usableW - gap * (n - 1)) / n, usableW * (n <= 2 ? 0.4 : 0.32));
    const totalW = n * cw + (n - 1) * gap;
    const startX = (w - totalW) / 2;
    const nodes = row.map((it, ci) => ({
      x: startX + ci * (cw + gap), y, w: cw, h: rowH,
      label: it.label ?? '', icon: it.icon ?? null, key: `L${li}-${ci}`,
    }));
    allRows.push(nodes);
    y += rowH + rowGap;
  });

  // connectors: parent i in row r -> each child in row r+1 (distribute)
  for (let r = 0; r < allRows.length - 1; r++) {
    const parents = allRows[r];
    const children = allRows[r + 1];
    children.forEach((ch, ci) => {
      // map child to a parent proportionally so lines do not all cross
      const pi = parents.length === 1 ? 0 : Math.min(parents.length - 1, Math.floor((ci / children.length) * parents.length));
      const p = parents[pi];
      edges.push(elbow(p.x + p.w / 2, p.y + p.h, ch.x + ch.w / 2, ch.y));
    });
  }

  const filled = allRows.map((row, r) => row.map((nd) => ({ ...nd, row: r })));
  // Size each row's labels so the longest single word fits after the icon.
  // wrap() is word-based and cannot break a word, so a long word left-anchored
  // after an icon can overflow a narrow card (e.g. "Engineering" in a
  // three-across row) and be clipped by the neighbouring card.
  filled.forEach((row) => {
    let rowSize = labelSize;
    for (const nd of row) {
      const iconSize = Math.min(nd.h * 0.44, 30);
      const tx = nd.icon ? nd.w * 0.1 + iconSize + nd.w * 0.06 : nd.w / 2;
      const avail = nd.icon ? nd.w - tx - nd.w * 0.05 : nd.w * 0.9;
      const longest = String(nd.label).split(/\s+/).reduce((m, wd) => Math.max(m, wd.length), 1);
      rowSize = Math.min(rowSize, avail / (longest * 0.56));
    }
    row.forEach((nd) => { nd.labelSize = Math.max(11, rowSize); });
  });
  return { ...fb, orientation: 'hierarchy', rows: filled, edges, labelSize, rowH };
}

function elbow(x0, y0, x1, y1) {
  const my = y0 + (y1 - y0) * 0.5;
  const d = `M${r3(x0)} ${r3(y0)} L${r3(x0)} ${r3(my)} L${r3(x1)} ${r3(my)} L${r3(x1)} ${r3(y1)}`;
  return path({ d, cls: 'dg-line', markerId: '__ARROW__' });
}

function svg(geo, theme, ovId) {
  const [open, arrowId] = svgOpen(geo.w, geo.h, ovId);
  const edges = geo.edges
    .map((e, i) => `<g class="dg-edge dg-edge-${i}">${e.markup.replace('__ARROW__', arrowId)}</g>`)
    .join('');
  let idx = 0;
  const nodes = geo.rows
    .map((row) => row.map((nd) => {
      const i = idx++;
      const isRoot = nd.key === 'root';
      const bg = rect({ w: nd.w, h: nd.h, r: theme.radius, cls: isRoot ? 'dg-panel-accent' : 'dg-panel' });
      const iconSize = Math.min(nd.h * 0.44, 30);
      const ic = nd.icon ? iconGroup({ name: nd.icon, x: nd.w * 0.1, y: (nd.h - iconSize) / 2, size: iconSize }) : '';
      const tx = nd.icon ? nd.w * 0.1 + iconSize + nd.w * 0.06 : nd.w / 2;
      const ls = nd.labelSize ?? geo.labelSize;
      const lines = wrap(nd.label, Math.max(7, Math.floor((nd.w - tx) / (ls * 0.56))), 2);
      const label = text({ x: tx, y: nd.h / 2 - (lines.length - 1) * ls * 0.59 + ls * 0.2, cls: isRoot ? 'dg-heading' : 'dg-sub', anchor: nd.icon ? 'start' : 'middle', size: ls, weight: isRoot ? 800 : 600, lines });
      return `<g class="dg-node dg-node-${i}" transform="translate(${r3(nd.x)} ${r3(nd.y)})"><g class="dg-node-anim">${bg}${ic}${label}</g></g>`;
    }).join(''))
    .join('');
  return open + titleText(geo) + edges + nodes + svgClose;
}

function animate(geo, { t0, dur, ovId }) {
  const s = `#${ovId}`;
  const line = (x) => `      ${x};`;
  const out = [];
  if (geo.title) {
    out.push(line(`tl.set('${s} .dg-title', {y:12}, ${r3(t0)})`));
    out.push(line(`tl.to('${s} .dg-title', {opacity:1, y:0, duration:0.35, ease:'power2.out'}, ${r3(t0)})`));
  }
  const total = geo.rows.flat().length;
  let idx = 0;
  const perRow = geo.rows.map((r) => r.length);
  const step = Math.max(0.22, Math.min(0.4, (dur * 0.5) / total));
  let atCursor = t0 + 0.3;
  geo.rows.forEach((row, r) => {
    row.forEach((nd) => {
      const i = idx++;
      out.push(line(`tl.set('${s} .dg-node-${i} .dg-node-anim', {opacity:0, y:-12}, ${r3(t0)})`));
      out.push(line(`tl.to('${s} .dg-node-${i} .dg-node-anim', {opacity:1, y:0, duration:0.35, ease:'power2.out'}, ${r3(atCursor)})`));
      atCursor += step;
    });
  });
  // edges draw after their rows land (staggered)
  geo.edges.forEach((e, i) => {
    const at = t0 + 0.5 + i * (Math.min(0.3, (dur * 0.4) / Math.max(1, geo.edges.length)));
    out.push(line(`tl.set('${s} .dg-edge-${i} .dg-line', {strokeDashoffset:${r3(e.length)}}, ${r3(t0)})`));
    out.push(line(`tl.to('${s} .dg-edge-${i} .dg-line', {strokeDashoffset:0, duration:0.35, ease:'power2.inOut'}, ${r3(at)})`));
  });
  const exitAt = Math.max(t0 + 0.6, t0 + dur - 0.35);
  out.push(line(`tl.to('${s} .dg-root', {opacity:0, y:-10, duration:0.35, ease:'power2.in'}, ${r3(exitAt)})`));
  return out;
}

export default {
  name: 'hierarchy',
  description: 'A parent/child tree across levels, joined by elbow connectors',
  frame: 'full',
  fields: ['title', 'root', 'levels'],
  minDurationFor: (n) => 1.2 + n * 0.4,
  geometry,
  svg,
  animate,
};
