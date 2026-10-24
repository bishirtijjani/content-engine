// diagrams/layouts/interface/annotated-screenshot.mjs — a screen with callouts.
import { checkLabel, checkCount, MAX_TITLE, MAX_NOTE, playTime } from '../../spec.mjs';
import { titleBlock } from '../_common.mjs';
import { wrapChars } from '../../primitives.mjs';

export default {
  name: 'annotated-screenshot',
  description: 'A real screenshot with labelled callouts',
  frame: 'full',
  fields: ['title', 'image', 'callouts'],

  minDurationFor(n) { return playTime(1.2, 0.35, n); },

  validate(spec) {
    const out = [];
    if (spec?.title != null) checkLabel(spec.title, 'title', out, { max: MAX_TITLE, required: false });
    if (typeof spec?.image !== 'string' || !spec.image.trim()) out.push('image is required (a file path or data URI)');
    const callouts = Array.isArray(spec?.callouts) ? spec.callouts : [];
    checkCount(callouts, 'callouts', out, 1, 5);
    callouts.forEach((c, i) => {
      checkLabel(c?.label, `callouts[${i}].label`, out, { max: MAX_NOTE });
      const x = Number(c?.x); const y = Number(c?.y);
      if (!Number.isFinite(x) || x < 0 || x > 1 || !Number.isFinite(y) || y < 0 || y > 1) out.push(`callouts[${i}] needs x,y between 0 and 1`);
    });
    return out;
  },

  slots(spec) {
    const out = [];
    if (spec?.title) out.push('title');
    out.push('img');
    (Array.isArray(spec?.callouts) ? spec.callouts : []).forEach((_, i) => out.push(`callout-${i}`));
    return out;
  },

  build(spec, c, P) {
    const callouts = Array.isArray(spec?.callouts) ? spec.callouts : [];
    const { node: title, body } = titleBlock(spec, c, P, { ratio: 0.08, landscapeRatio: 0.12 });
    const nodes = [];
    const edges = [];
    const build = [];
    if (title) { nodes.push(title); build.push(['title']); }

    nodes.push(P.image('img', body, { src: spec.image, fit: 'contain', radius: 18 }));
    build.push(['img']);

    callouts.forEach((co, i) => {
      const ax = body.x + Number(co.x) * body.w;
      const ay = body.y + Number(co.y) * body.h;
      const side = co.side ?? 'right';
      const cw = Math.min(body.w * 0.36, P.unit * 0.40);
      const chh = P.unit * 0.075;
      const cx = side === 'left' ? ax - cw - body.w * 0.04 : ax + body.w * 0.04;
      const cy = side === 'above' ? ay - chh - body.h * 0.03 : side === 'below' ? ay + body.h * 0.03 : ay - chh / 2;
      const box = {
        x: Math.max(body.x, Math.min(body.x + body.w - cw, cx)),
        y: Math.max(body.y, Math.min(body.y + body.h - chh, cy)),
        w: cw, h: chh,
      };
      nodes.push(P.card(`callout-${i}`, box, {
        tone: 'amber', r: 16,
        children: [P.text(`callout-${i}-t`, { x: box.x + 12, y: box.y, w: box.w - 24, h: box.h }, {
          value: co.label, size: P.unit * 0.020, weight: 800, font: 'body', color: 'blue',
          align: 'left', valign: 'center', wrap: wrapChars(box.w - 24, P.unit * 0.020), maxLines: 2, slot: false,
        }, box)],
      }));
      build.push([`callout-${i}`]);

      const start = side === 'left' ? { x: box.x + box.w, y: box.y + box.h / 2 }
        : side === 'above' || side === 'below' ? { x: box.x + box.w / 2, y: side === 'above' ? box.y + box.h : box.y }
          : { x: box.x, y: box.y + box.h / 2 };
      edges.push(P.edge(`leader-${i}`, [start, { x: ax, y: ay }], {
        strokeWidth: 3, arrowSize: Math.round(P.unit * 0.020), slot: false,
      }));
      nodes.push(P.shape(`anchor-${i}`, { x: ax - 9, y: ay - 9, w: 18, h: 18 }, {
        shape: 'circle', fill: 'accent', stroke: 'text', strokeWidth: 3, slot: false,
      }));
    });

    return { nodes: [...nodes, ...edges], build };
  },
};
