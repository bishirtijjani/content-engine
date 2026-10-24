// diagrams/layouts/time/calendar.mjs — a month grid with events.
import { checkLabel, checkCount, MAX_TITLE, MAX_NOTE, playTime } from '../../spec.mjs';
import { titleBlock } from '../_common.mjs';
import { wrapChars } from '../../primitives.mjs';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default {
  name: 'calendar',
  description: 'A month grid with events on their days',
  frame: 'full',
  fields: ['title', 'month', 'events'],

  minDurationFor(n) { return playTime(1.1, 0.3, n); },

  validate(spec) {
    const out = [];
    if (spec?.title != null) checkLabel(spec.title, 'title', out, { max: MAX_TITLE, required: false });
    if (spec?.month != null) checkLabel(spec.month, 'month', out, { max: 24, required: false });
    const events = Array.isArray(spec?.events) ? spec.events : [];
    checkCount(events, 'events', out, 1, 8);
    events.forEach((e, i) => {
      checkLabel(e?.label, `events[${i}].label`, out, { max: MAX_NOTE });
      if (!Number.isInteger(e?.day) || e.day < 1 || e.day > 31) out.push(`events[${i}].day must be 1-31`);
    });
    return out;
  },

  slots(spec) {
    const out = [];
    if (spec?.title) out.push('title');
    (Array.isArray(spec?.events) ? spec.events : []).forEach((_, i) => out.push(`event-${i}`));
    return out;
  },

  build(spec, c, P) {
    const events = Array.isArray(spec?.events) ? spec.events : [];
    const { node: title, body } = titleBlock(spec, c, P, { ratio: 0.07, landscapeRatio: 0.11 });
    const nodes = [];
    const build = [];
    if (title) { nodes.push(title); build.push(['title']); }

    if (spec?.month) {
      nodes.push(P.text('month', { x: body.x, y: body.y, w: body.w, h: body.h * 0.06 }, {
        value: spec.month, size: P.unit * 0.024, weight: 800, font: 'body', color: 'surface',
        align: 'left', valign: 'center', caps: true, tracking: 0.14, slot: false,
      }));
    }
    const gridY = body.y + body.h * (spec?.month ? 0.08 : 0.02);
    const gridH = body.y + body.h - gridY;
    const cw = body.w / 7;
    const ch = gridH / 6;

    DAYS.forEach((d, i) => {
      nodes.push(P.text(`day-${i}`, { x: body.x + i * cw, y: gridY, w: cw, h: ch * 0.55 }, {
        value: d, size: P.unit * 0.016, weight: 700, font: 'body', color: 'text',
        align: 'center', valign: 'center', opacity: 0.55, caps: true, tracking: 0.06, slot: false,
      }));
    });

    for (let w = 0; w < 5; w++) {
      for (let d = 0; d < 7; d++) {
        const box = { x: body.x + d * cw + 2, y: gridY + ch * 0.55 + w * ch + 2, w: cw - 4, h: ch - 4 };
        nodes.push(P.shape(`cell-${w}-${d}`, box, {
          shape: 'rect', r: 10, fill: 'rgba(255,255,255,.08)',
          stroke: 'rgba(255,255,255,.10)', strokeWidth: 1, slot: false,
        }));
      }
    }

    events.forEach((e, i) => {
      const dayIndex = Math.max(0, Math.min(34, e.day - 1));
      const w = Math.floor(dayIndex / 7);
      const d = dayIndex % 7;
      const box = {
        x: body.x + d * cw + 6,
        y: gridY + ch * 0.55 + w * ch + 6,
        w: cw - 12,
        h: ch - 12,
      };
      const size = Math.min(P.unit * 0.017, box.h * 0.28);
      nodes.push(P.card(`event-${i}`, box, {
        tone: e.tone ?? 'amber', r: 10,
        children: [P.text(`event-${i}-t`, { x: box.x + 6, y: box.y, w: box.w - 12, h: box.h }, {
          value: e.label, size, weight: 700, font: 'body', color: 'blue',
          align: 'left', valign: 'center', wrap: wrapChars(box.w - 12, size), maxLines: 3, slot: false,
        }, box)],
      }));
      build.push([`event-${i}`]);
    });

    return { nodes, build };
  },
};
