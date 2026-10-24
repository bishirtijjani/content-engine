// diagrams/layouts/structure/data-flow.mjs — sources, process, stores, sinks.
import { checkLabel, MAX_TITLE, MAX_LABEL, playTime } from '../../spec.mjs';
import { titleBlock, itemsOf } from '../_common.mjs';
import { wrapChars } from '../../primitives.mjs';

export default {
  name: 'data-flow',
  description: 'Where data comes from, what processes it and where it lands',
  frame: 'full',
  fields: ['title', 'sources', 'process', 'stores', 'sinks'],

  minDurationFor(n) { return playTime(1.2, 0.35, n); },

  validate(spec) {
    const out = [];
    if (spec?.title != null) checkLabel(spec.title, 'title', out, { max: MAX_TITLE, required: false });
    const sources = itemsOf(spec, 'sources');
    if (sources.length < 1 || sources.length > 3) out.push('sources needs 1-3 items');
    sources.forEach((s, i) => checkLabel(s.label, `sources[${i}]`, out, { max: MAX_LABEL }));
    checkLabel(typeof spec?.process === 'string' ? spec.process : spec?.process?.label, 'process', out, { max: MAX_LABEL });
    const stores = itemsOf(spec, 'stores');
    if (stores.length < 1 || stores.length > 3) out.push('stores needs 1-3 items');
    stores.forEach((s, i) => checkLabel(s.label, `stores[${i}]`, out, { max: MAX_LABEL }));
    const sinks = itemsOf(spec, 'sinks');
    sinks.forEach((s, i) => checkLabel(s.label, `sinks[${i}]`, out, { max: MAX_LABEL }));
    return out;
  },

  slots(spec) {
    const out = [];
    if (spec?.title) out.push('title');
    itemsOf(spec, 'sources').forEach((_, i) => out.push(`source-${i}`));
    out.push('process');
    itemsOf(spec, 'stores').forEach((_, i) => out.push(`store-${i}`));
    itemsOf(spec, 'sinks').forEach((_, i) => out.push(`sink-${i}`));
    return out;
  },

  build(spec, c, P) {
    const sources = itemsOf(spec, 'sources');
    const stores = itemsOf(spec, 'stores');
    const sinks = itemsOf(spec, 'sinks');
    const processLabel = typeof spec?.process === 'string' ? spec.process : spec?.process?.label ?? '';
    const { node: title, body } = titleBlock(spec, c, P, { ratio: 0.09, landscapeRatio: 0.13 });
    const nodes = [];
    const edges = [];
    const build = [];
    if (title) { nodes.push(title); build.push(['title']); }

    const row = (items, y, h, prefix, tone, fg) => items.map((it, i) => {
      const gap = body.w * 0.03;
      const w = Math.min((body.w - gap * (items.length - 1)) / items.length, P.unit * 0.30);
      const total = w * items.length + gap * (items.length - 1);
      const box = { x: body.x + (body.w - total) / 2 + i * (w + gap), y, w, h };
      const size = P.theme.type.node * P.unit * 0.70;
      nodes.push(P.card(`${prefix}-${i}`, box, {
        tone, r: 22,
        children: [
          P.icon(`${prefix}-${i}-icon`, { x: box.x + 12, y: box.y + box.h * 0.28, w: box.h * 0.40, h: box.h * 0.40 }, {
            name: it.icon || 'database', size: box.h * 0.40, color: fg, slot: false,
          }, box),
          P.text(`${prefix}-${i}-t`, { x: box.x + box.h * 0.56, y: box.y, w: box.w - box.h * 0.56 - 10, h: box.h }, {
            value: it.label, size, weight: 700, font: 'display', color: fg,
            align: 'left', valign: 'center', wrap: wrapChars(box.w - box.h * 0.56 - 10, size), maxLines: 2, slot: false,
          }, box),
        ],
      }));
      build.push([`${prefix}-${i}`]);
      return box;
    });

    const rowH = body.h * 0.14;
    const sourceBoxes = row(sources, body.y, rowH, 'source', 'ghost', 'text');
    const procW = Math.min(body.w * 0.44, P.unit * 0.44);
    const procH = body.h * 0.18;
    const procBox = { x: body.x + (body.w - procW) / 2, y: body.y + body.h * 0.30, w: procW, h: procH };
    const pSize = P.theme.type.node * P.unit * 0.86;
    nodes.push(P.card('process', procBox, {
      tone: 'amber', r: 30,
      children: [P.text('process-t', { x: procBox.x + 16, y: procBox.y, w: procBox.w - 32, h: procBox.h }, {
        value: processLabel, size: pSize, weight: 900, font: 'display', color: 'blue',
        align: 'center', valign: 'center', wrap: wrapChars(procBox.w - 32, pSize), maxLines: 2, slot: false,
      }, procBox)],
    }));
    build.push(['process']);

    const storeBoxes = row(stores, body.y + body.h * 0.62, rowH, 'store', 'blue', 'text');
    const sinkBoxes = row(sinks, body.y + body.h * 0.82, rowH, 'sink', 'ghost', 'text');

    const link = (id, a, b) => {
      edges.push(P.edge(id, [
        { x: a.x + a.w / 2, y: a.y + a.h },
        { x: b.x + b.w / 2, y: b.y },
      ], { strokeWidth: 3, arrowSize: Math.round(P.unit * 0.024), slot: false }));
    };
    sourceBoxes.forEach((b, i) => link(`flow-in-${i}`, b, procBox));
    storeBoxes.forEach((b, i) => link(`flow-store-${i}`, procBox, b));
    sinkBoxes.forEach((b, i) => link(`flow-sink-${i}`, procBox, b));

    return { nodes: [...nodes, ...edges], build };
  },
};
