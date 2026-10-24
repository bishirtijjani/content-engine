// diagrams/layouts/structure/hierarchy.mjs — parent/child relationships.
import { checkLabel, checkCount, MAX_TITLE, MAX_LABEL, playTime } from '../../spec.mjs';
import { titleBlock, itemsOf } from '../_common.mjs';
import { wrapChars } from '../../primitives.mjs';

const defaultIcon = (i) => ['building', 'users', 'user', 'settings'][i % 4];

export default {
  name: 'hierarchy',
  description: 'A parent/child tree across levels, joined by elbow connectors',
  frame: 'full',
  fields: ['title', 'root', 'levels'],

  minDurationFor(n) { return playTime(1.2, 0.4, n); },

  validate(spec) {
    const out = [];
    if (spec?.title != null) checkLabel(spec.title, 'title', out, { max: MAX_TITLE, required: false });
    checkLabel(typeof spec?.root === 'string' ? spec.root : spec?.root?.label, 'root', out, { max: MAX_LABEL });
    const levels = Array.isArray(spec?.levels) ? spec.levels : [];
    checkCount(levels, 'levels', out, 1, 3);
    levels.forEach((row, i) => {
      const items = itemsOf({ row }, 'row');
      checkCount(items, `levels[${i}]`, out, 1, 4);
      items.forEach((item, j) => checkLabel(item.label, `levels[${i}][${j}]`, out));
    });
    return out;
  },

  slots(spec) {
    const out = [];
    if (spec?.title) out.push('title');
    out.push('node-root');
    (Array.isArray(spec?.levels) ? spec.levels : []).forEach((row, i) => {
      itemsOf({ row }, 'row').forEach((_, j) => {
        out.push(`node-${i}-${j}`);
        out.push(`edge-${i}-${j}`);
      });
    });
    return out;
  },

  build(spec, c, P) {
    const { node: title, body } = titleBlock(spec, c, P, { ratio: 0.10, landscapeRatio: 0.14 });
    const levels = (Array.isArray(spec?.levels) ? spec.levels : []).map((row) => (
      Array.isArray(row) ? row.map((r) => (typeof r === 'string' ? { label: r } : { ...r, label: r.label ?? r.text ?? '' })) : []
    ));
    const nodes = [];
    const edges = [];
    const build = [];
    if (title) { nodes.push(title); build.push(['title']); }

    const rootH = body.h * 0.16;
    const rootW = Math.min(body.w * 0.42, P.unit * 0.50);
    const rootBox = { x: body.x + (body.w - rootW) / 2, y: body.y, w: rootW, h: rootH };
    const rootLabel = typeof spec?.root === 'string' ? spec.root : spec?.root?.label ?? '';
    const rootContent = P.cardContent(rootBox, { label: rootLabel }, {
      id: 'node-root', fg: 'blue', mode: 'stack', labelSize: P.theme.type.node * P.unit * 0.92,
    });
    nodes.push(P.card('node-root', rootBox, {
      tone: 'amber', r: 30, children: rootContent.children, meta: rootContent.meta,
    }));
    build.push(['node-root']);

    const levelGap = body.h * 0.10;
    const levelH = (body.h - rootH - levelGap * levels.length) / Math.max(1, levels.length);
    let prevBoxes = [rootBox];
    const boxes = [];

    levels.forEach((row, li) => {
      const y = body.y + rootH + levelGap * (li + 1) + levelH * li;
      const gap = body.w * 0.03;
      const w = (body.w - gap * (row.length - 1)) / row.length;
      const rowBoxes = row.map((item, ci) => ({
        x: body.x + ci * (w + gap), y, w, h: levelH,
        label: item.label, icon: item.icon,
      }));
      boxes.push(rowBoxes);
      rowBoxes.forEach((box, ci) => {
        const content = P.cardContent(box, {
          icon: box.icon || defaultIcon(ci),
          label: box.label,
        }, {
          id: `node-${li}-${ci}`, fg: 'text', mode: 'auto',
          labelSize: P.theme.type.node * P.unit * 0.78,
        });
        nodes.push(P.card(`node-${li}-${ci}`, box, {
          tone: item_tone(levels[li][ci]), r: 28, children: content.children, meta: content.meta,
        }));
        build.push([`node-${li}-${ci}`]);
      });

      // Elbow connectors from each parent to its proportional children.
      rowBoxes.forEach((child, ci) => {
        const parent = prevBoxes.length === 1
          ? prevBoxes[0]
          : prevBoxes[Math.min(prevBoxes.length - 1, Math.round((ci * (prevBoxes.length - 1)) / Math.max(1, rowBoxes.length - 1)))];
        const px = parent.x + parent.w / 2;
        const cx = child.x + child.w / 2;
        const midY = y - levelGap / 2;
        edges.push(P.edge(`edge-${li}-${ci}`, [
          { x: px, y: parent.y + parent.h },
          { x: px, y: midY },
          { x: cx, y: midY },
          { x: cx, y },
        ], { strokeWidth: 3 }));
        build.push([`edge-${li}-${ci}`]);
      });
      prevBoxes = rowBoxes;
    });

    return { nodes: [...nodes, ...edges], build };
  },
};

function item_tone(item) {
  return item && item.tone ? item.tone : 'blue';
}
