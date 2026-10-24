// diagrams/layouts/process/swimlane.mjs — who does what, across lanes.
import { checkLabel, checkCount, MAX_TITLE, MAX_LABEL, MAX_NOTE, playTime } from '../../spec.mjs';
import { titleBlock, itemsOf } from '../_common.mjs';
import { wrapChars } from '../../primitives.mjs';

export default {
  name: 'swimlane',
  description: 'Steps placed in the lane that owns them',
  frame: 'full',
  fields: ['title', 'lanes', 'steps'],

  minDurationFor(n) { return playTime(1.2, 0.4, n); },

  validate(spec) {
    const out = [];
    if (spec?.title != null) checkLabel(spec.title, 'title', out, { max: MAX_TITLE, required: false });
    const lanes = itemsOf(spec, 'lanes');
    checkCount(lanes, 'lanes', out, 2, 4);
    lanes.forEach((l, i) => checkLabel(l.label, `lanes[${i}]`, out, { max: MAX_LABEL }));
    const steps = Array.isArray(spec?.steps) ? spec.steps : [];
    checkCount(steps, 'steps', out, 2, 8);
    steps.forEach((s, i) => {
      checkLabel(s?.label, `steps[${i}].label`, out, { max: MAX_NOTE });
      if (!Number.isInteger(s?.lane) || s.lane < 0 || s.lane >= lanes.length) out.push(`steps[${i}].lane must be a lane index`);
    });
    return out;
  },

  slots(spec) {
    const out = [];
    if (spec?.title) out.push('title');
    itemsOf(spec, 'lanes').forEach((_, i) => out.push(`lane-${i}`));
    (Array.isArray(spec?.steps) ? spec.steps : []).forEach((_, i) => out.push(`step-${i}`));
    return out;
  },

  build(spec, c, P) {
    const lanes = itemsOf(spec, 'lanes');
    const steps = Array.isArray(spec?.steps) ? spec.steps : [];
    const { node: title, body } = titleBlock(spec, c, P, { ratio: 0.10, landscapeRatio: 0.14 });
    const nodes = [];
    const build = [];
    if (title) { nodes.push(title); build.push(['title']); }

    const labelW = body.w * 0.20;
    const gap = body.h * 0.02;
    const laneH = (body.h - gap * (lanes.length - 1)) / lanes.length;
    lanes.forEach((lane, i) => {
      const box = { x: body.x, y: body.y + i * (laneH + gap), w: body.w, h: laneH };
      // A lane is a header strip, not a node card: the label owns the left
      // column and the icon sits inside that column, never over the steps.
      const laneLabelSize = P.theme.type.node * P.unit * 0.52;
      const laneIcon = Math.min(box.h * 0.22, labelW * 0.20);
      nodes.push(P.card(`lane-${i}`, box, {
        tone: 'ghost', r: 24,
        children: [
          P.text(`lane-${i}-label`, { x: box.x + body.w * 0.02, y: box.y, w: labelW * 0.64, h: box.h }, {
            value: lane.label, size: laneLabelSize, weight: 800, font: 'display',
            color: 'text', align: 'left', valign: 'center', wrap: wrapChars(labelW * 0.64, laneLabelSize), maxLines: 1, slot: false,
          }, box),
          P.icon(`lane-${i}-icon`, { x: box.x + labelW * 0.70, y: box.y + (box.h - laneIcon) / 2, w: laneIcon, h: laneIcon }, {
            name: lane.icon || 'users', size: laneIcon, color: 'surface', slot: false,
          }, box),
        ],
      }));
      build.push([`lane-${i}`]);
    });

    const perLane = lanes.map(() => 0);
    steps.forEach((s, i) => { perLane[s.lane] = (perLane[s.lane] ?? 0) + 1; });
    const seen = lanes.map(() => 0);
    steps.forEach((s, i) => {
      const idx = seen[s.lane]++;
      const count = perLane[s.lane];
      const laneY = body.y + s.lane * (laneH + gap);
      const availW = body.w - labelW - body.w * 0.04;
      const stepW = Math.min(availW / count - body.w * 0.02, P.unit * 0.34);
      const x = body.x + labelW + body.w * 0.02 + idx * (availW / count);
      const stepH = Math.min(laneH * 0.68, P.unit * 0.16);
      const box = { x, y: laneY + (laneH - stepH) / 2, w: stepW, h: stepH };
      const content = P.cardContent(box, { label: s.label }, {
        id: `step-${i}`, fg: 'text', mode: 'stack',
        labelSize: P.theme.type.node * P.unit * 0.66,
      });
      nodes.push(P.card(`step-${i}`, box, { tone: 'blue', r: 20, children: content.children, meta: content.meta }));
      build.push([`step-${i}`]);
    });

    return { nodes, build };
  },
};
