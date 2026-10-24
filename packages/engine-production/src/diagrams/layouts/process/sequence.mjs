// diagrams/layouts/process/sequence.mjs — messages between actors over time.
import { checkLabel, checkCount, MAX_TITLE, MAX_LABEL, MAX_NOTE, playTime } from '../../spec.mjs';
import { titleBlock, itemsOf } from '../_common.mjs';

export default {
  name: 'sequence',
  description: 'Actors as columns, messages as time-ordered arrows',
  frame: 'full',
  fields: ['title', 'actors', 'messages'],

  minDurationFor(n) { return playTime(1.2, 0.4, n); },

  validate(spec) {
    const out = [];
    if (spec?.title != null) checkLabel(spec.title, 'title', out, { max: MAX_TITLE, required: false });
    const actors = itemsOf(spec, 'actors');
    checkCount(actors, 'actors', out, 2, 4);
    actors.forEach((a, i) => checkLabel(a.label, `actors[${i}]`, out, { max: MAX_LABEL }));
    const messages = Array.isArray(spec?.messages) ? spec.messages : [];
    checkCount(messages, 'messages', out, 1, 6);
    messages.forEach((m, i) => {
      checkLabel(m?.label, `messages[${i}].label`, out, { max: MAX_NOTE });
      for (const k of ['from', 'to']) {
        if (!Number.isInteger(m?.[k]) || m[k] < 0 || m[k] >= actors.length) out.push(`messages[${i}].${k} must be an actor index`);
      }
    });
    return out;
  },

  slots(spec) {
    const out = [];
    if (spec?.title) out.push('title');
    itemsOf(spec, 'actors').forEach((_, i) => out.push(`actor-${i}`));
    (Array.isArray(spec?.messages) ? spec.messages : []).forEach((_, i) => out.push(`msg-${i}`));
    return out;
  },

  build(spec, c, P) {
    const actors = itemsOf(spec, 'actors');
    const messages = Array.isArray(spec?.messages) ? spec.messages : [];
    const { node: title, body } = titleBlock(spec, c, P, { ratio: 0.09, landscapeRatio: 0.13 });
    const nodes = [];
    const build = [];
    if (title) { nodes.push(title); build.push(['title']); }

    const actorW = Math.min(body.w / actors.length * 0.74, P.unit * 0.30);
    const actorH = body.h * 0.13;
    const xs = actors.map((_, i) => body.x + (body.w * (i + 0.5)) / actors.length);

    actors.forEach((a, i) => {
      const box = { x: xs[i] - actorW / 2, y: body.y, w: actorW, h: actorH };
      nodes.push(P.card(`actor-${i}`, box, {
        tone: i === 0 ? 'amber' : 'blue', r: 22,
        children: [P.text(`actor-${i}-t`, { x: box.x + 8, y: box.y, w: box.w - 16, h: box.h }, {
          value: a.label, size: P.theme.type.node * P.unit * 0.72, weight: 800, font: 'display',
          color: i === 0 ? 'blue' : 'text', align: 'center', valign: 'center', wrap: 14, maxLines: 2, slot: false,
        }, box)],
      }));
      nodes.push(P.shape(`lifeline-${i}`, { x: xs[i] - 1, y: body.y + actorH, w: 2, h: body.h - actorH - body.h * 0.04 }, {
        shape: 'rect', fill: 'rgba(255,255,255,.28)', slot: false,
      }));
      build.push([`actor-${i}`]);
    });

    const startY = body.y + actorH + body.h * 0.07;
    const step = (body.h - actorH - body.h * 0.12) / Math.max(1, messages.length);
    messages.forEach((m, i) => {
      const y = startY + i * step;
      const x0 = xs[m.from];
      const x1 = xs[m.to];
      const dir = x1 >= x0 ? 1 : -1;
      nodes.push(P.edge(`msg-${i}`, [{ x: x0 + dir * 6, y }, { x: x1 - dir * 6, y }], {
        strokeWidth: 3, dashed: m.dashed === true, arrowSize: Math.round(P.unit * 0.024),
      }));
      nodes.push(P.text(`msg-${i}-t`, {
        x: Math.min(x0, x1), y: y - P.unit * 0.042, w: Math.abs(x1 - x0), h: P.unit * 0.036,
      }, {
        value: m.label, size: P.unit * 0.019, weight: 700, font: 'body', color: 'text',
        align: 'center', valign: 'bottom', slot: false,
      }));
      build.push([`msg-${i}`]);
    });

    return { nodes, build };
  },
};
