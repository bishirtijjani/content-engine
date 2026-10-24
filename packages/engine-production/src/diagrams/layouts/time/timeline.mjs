// diagrams/layouts/time/timeline.mjs — events on a real time axis.
import { checkLabel, checkCount, MAX_TITLE, playTime } from '../../spec.mjs';
import { titleBlock, itemsOf } from '../_common.mjs';
import { wrapChars } from '../../primitives.mjs';

export default {
  name: 'timeline',
  description: 'Events placed along a time axis with dated markers',
  frame: 'full',
  fields: ['title', 'events', 'active'],

  minDurationFor(n) { return playTime(1.0, 0.4, n); },

  validate(spec) {
    const out = [];
    if (spec?.title != null) checkLabel(spec.title, 'title', out, { max: MAX_TITLE, required: false });
    const events = itemsOf(spec, 'events');
    checkCount(events, 'events', out, 2, 6);
    events.forEach((e, i) => {
      checkLabel(e.label, `events[${i}]`, out);
      if (e.date != null) checkLabel(String(e.date), `events[${i}].date`, out, { max: 18, required: false });
    });
    if (spec?.active != null && !Number.isInteger(spec.active)) out.push('active must be an integer index');
    return out;
  },

  slots(spec) {
    const n = itemsOf(spec, 'events').length;
    const out = [];
    if (spec?.title) out.push('title');
    for (let i = 0; i < n; i++) { out.push(`marker-${i}`); out.push(`label-${i}`); }
    return out;
  },

  build(spec, c, P) {
    const events = itemsOf(spec, 'events');
    const n = events.length;
    const active = Number.isInteger(spec?.active) ? Math.max(0, Math.min(n - 1, spec.active)) : n - 1;
    const { node: title, body } = titleBlock(spec, c, P, { ratio: 0.11, landscapeRatio: 0.15 });
    const nodes = [];
    const build = [];
    if (title) { nodes.push(title); build.push(['title']); }

    const markerD = Math.min(P.unit * 0.060, body.h * 0.10);
    const at = (i) => (n === 1 ? 0.5 : 0.08 + (0.84 * i) / (n - 1));

    if (c.landscape) {
      const ay = body.y + body.h * 0.52;
      nodes.push(P.shape('axis', { x: body.x, y: ay - 2, w: body.w, h: 4 }, {
        shape: 'rect', r: 2, fill: 'hairline', slot: false,
      }));
      for (let i = 0; i < n; i++) {
        const x = body.x + body.w * at(i);
        const isActive = i === active;
        const marker = { x: x - markerD / 2, y: ay - markerD / 2, w: markerD, h: markerD };
        nodes.push(P.group(`marker-${i}`, marker, {
          children: [
            P.shape(`marker-${i}-dot`, marker, { shape: 'circle', fill: isActive ? 'surface' : 'blue', stroke: isActive ? 'orange' : 'text', strokeWidth: isActive ? 5 : 3, slot: false }, marker),
            P.icon(`marker-${i}-icon`, {
              x: marker.x + markerD * 0.28, y: marker.y + markerD * 0.28, w: markerD * 0.44, h: markerD * 0.44,
            }, { name: events[i].icon || 'point', size: markerD * 0.44, color: isActive ? 'blue' : 'text', slot: false }, marker),
          ],
        }));
        build.push([`marker-${i}`]);

        const above = i % 2 === 0;
        const lw = Math.min(body.w / n * 0.92, P.unit * 0.34);
        const lh = body.h * 0.30;
        const lx = Math.max(body.x, Math.min(body.x + body.w - lw, x - lw / 2));
        const ly = above ? ay - markerD / 2 - lh - body.h * 0.04 : ay + markerD / 2 + body.h * 0.04;
        const box = { x: lx, y: ly, w: lw, h: lh };
        const size = P.theme.type.node * P.unit * 0.82;
        nodes.push(P.card(`label-${i}`, box, {
          tone: isActive ? 'amber' : 'ghost', r: 26,
          children: [
            ...(events[i].date ? [P.text(`label-${i}-date`, { x: box.x + 20, y: box.y + box.h * 0.16, w: box.w - 40, h: box.h * 0.24 }, {
              value: String(events[i].date), size: size * 0.72, weight: 800, font: 'body', color: isActive ? 'blue' : 'text',
              align: above ? 'left' : 'left', valign: 'center', opacity: 0.72, caps: true, tracking: 0.12, slot: false,
            }, box)] : []),
            P.text(`label-${i}-t`, { x: box.x + 20, y: box.y + box.h * (events[i].date ? 0.40 : 0.10), w: box.w - 40, h: box.h * (events[i].date ? 0.50 : 0.80) }, {
              value: events[i].label, size, weight: 800, font: 'display', color: isActive ? 'blue' : 'text',
              align: 'left', valign: 'center', wrap: wrapChars(box.w - 40, size), maxLines: 2, slot: false,
            }, box),
          ],
        }));
        build.push([`label-${i}`]);
      }
    } else {
      const ax = body.x + body.w * 0.18;
      nodes.push(P.shape('axis', { x: ax - 2, y: body.y, w: 4, h: body.h }, {
        shape: 'rect', r: 2, fill: 'hairline', slot: false,
      }));
      for (let i = 0; i < n; i++) {
        const y = body.y + body.h * at(i);
        const isActive = i === active;
        const marker = { x: ax - markerD / 2, y: y - markerD / 2, w: markerD, h: markerD };
        nodes.push(P.group(`marker-${i}`, marker, {
          children: [
            P.shape(`marker-${i}-dot`, marker, { shape: 'circle', fill: isActive ? 'surface' : 'blue', stroke: isActive ? 'orange' : 'text', strokeWidth: isActive ? 5 : 3, slot: false }, marker),
            P.icon(`marker-${i}-icon`, {
              x: marker.x + markerD * 0.28, y: marker.y + markerD * 0.28, w: markerD * 0.44, h: markerD * 0.44,
            }, { name: events[i].icon || 'point', size: markerD * 0.44, color: isActive ? 'blue' : 'text', slot: false }, marker),
          ],
        }));
        build.push([`marker-${i}`]);

        const box = { x: ax + markerD * 0.9, y: y - body.h * 0.09, w: body.x + body.w - (ax + markerD * 0.9), h: body.h * 0.18 };
        const size = P.theme.type.node * P.unit * 0.86;
        nodes.push(P.card(`label-${i}`, box, {
          tone: isActive ? 'amber' : 'ghost', r: 24,
          children: [
            P.text(`label-${i}-t`, { x: box.x + 24, y: box.y, w: box.w - 48, h: box.h }, {
              value: events[i].label, size, weight: 800, font: 'display', color: isActive ? 'blue' : 'text',
              align: 'left', valign: 'center', wrap: wrapChars(box.w - 48, size), maxLines: 2, slot: false,
            }, box),
            ...(events[i].date ? [P.text(`label-${i}-date`, { x: box.x + 24, y: box.y, w: box.w - 48, h: box.h * 0.30 }, {
              value: String(events[i].date), size: size * 0.62, weight: 800, font: 'body', color: isActive ? 'blue' : 'text',
              align: 'right', valign: 'center', opacity: 0.68, caps: true, tracking: 0.10, slot: false,
            }, box)] : []),
          ],
        }));
        build.push([`label-${i}`]);
      }
    }

    return { nodes, build };
  },
};
