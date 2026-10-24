// diagrams/layouts/structure/erd.mjs — entities, fields and relationships.
import { checkLabel, checkCount, MAX_TITLE, MAX_LABEL, MAX_NOTE, playTime } from '../../spec.mjs';
import { titleBlock } from '../_common.mjs';

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
  name: 'erd',
  description: 'Entities with fields, joined by cardinality relationships',
  frame: 'full',
  fields: ['title', 'entities', 'relations'],

  minDurationFor(n) { return playTime(1.3, 0.35, n); },

  validate(spec) {
    const out = [];
    if (spec?.title != null) checkLabel(spec.title, 'title', out, { max: MAX_TITLE, required: false });
    const entities = Array.isArray(spec?.entities) ? spec.entities : [];
    checkCount(entities, 'entities', out, 1, 4);
    entities.forEach((e, i) => {
      checkLabel(e?.name, `entities[${i}].name`, out, { max: 20 });
      const fields = Array.isArray(e?.fields) ? e.fields : [];
      if (fields.length < 1 || fields.length > 6) out.push(`entities[${i}] needs 1-6 fields`);
      fields.forEach((f, j) => checkLabel(f?.name, `entities[${i}].fields[${j}].name`, out, { max: 20 }));
    });
    const relations = Array.isArray(spec?.relations) ? spec.relations : [];
    relations.forEach((r, i) => {
      if (!Number.isInteger(r?.from) || r.from < 0 || r.from >= entities.length) out.push(`relations[${i}].from must be an entity index`);
      if (!Number.isInteger(r?.to) || r.to < 0 || r.to >= entities.length) out.push(`relations[${i}].to must be an entity index`);
      if (r?.cardinality != null) checkLabel(String(r.cardinality), `relations[${i}].cardinality`, out, { max: 12, required: false });
    });
    return out;
  },

  slots(spec) {
    const out = [];
    if (spec?.title) out.push('title');
    (Array.isArray(spec?.entities) ? spec.entities : []).forEach((_, i) => out.push(`entity-${i}`));
    (Array.isArray(spec?.relations) ? spec.relations : []).forEach((_, i) => out.push(`rel-${i}`));
    return out;
  },

  build(spec, c, P) {
    const entities = Array.isArray(spec?.entities) ? spec.entities : [];
    const relations = Array.isArray(spec?.relations) ? spec.relations : [];
    const { node: title, body } = titleBlock(spec, c, P, { ratio: 0.09, landscapeRatio: 0.13 });
    const nodes = [];
    const edges = [];
    const build = [];
    if (title) { nodes.push(title); build.push(['title']); }

    const cols = c.landscape ? Math.min(entities.length, entities.length <= 2 ? entities.length : 2) : 2;
    const rows = Math.ceil(entities.length / cols);
    const gapX = body.w * 0.10;
    const gapY = body.h * 0.10;
    const w = (body.w - gapX * (cols - 1)) / cols;
    const rowH = (body.h - gapY * (rows - 1)) / rows;
    const h = Math.min(rowH, P.unit * 0.46);
    const padY = (rowH - h) / 2;
    const boxes = [];

    entities.forEach((e, i) => {
      const r = Math.floor(i / cols);
      const k = i % cols;
      const box = { x: body.x + k * (w + gapX), y: body.y + padY + r * (rowH + gapY), w, h };
      boxes.push(box);
      const fields = Array.isArray(e.fields) ? e.fields : [];
      const content = P.cardContent(box, {
        header: e.name,
        rows: fields.map((f) => ({
          left: `${f.pk ? '● ' : f.fk ? '○ ' : ''}${f.name}`,
          right: f.type ?? '',
        })),
      }, {
        id: `entity-${i}`, fg: 'blue', mode: 'list',
        headerSize: P.theme.type.node * P.unit * 0.68,
        rowSize: P.unit * 0.021,
        headerColor: 'blue', rowColor: 'blue',
        headerFont: 'display', rowFont: 'mono', rightFont: 'mono',
      });
      nodes.push(P.card(`entity-${i}`, box, { tone: 'amber', r: 22, children: content.children, meta: content.meta }));
      build.push([`entity-${i}`]);
    });

    relations.forEach((r, i) => {
      const a = boxes[r.from];
      const b = boxes[r.to];
      if (!a || !b) return;
      const pts = trim(a, b);
      edges.push(P.edge(`rel-${i}`, pts, {
        strokeWidth: 3, arrowSize: Math.round(P.unit * 0.020),
        label: r.cardinality, labelSize: P.unit * 0.016,
      }));
      build.push([`rel-${i}`]);
    });

    return { nodes: [...nodes, ...edges], build };
  },
};
