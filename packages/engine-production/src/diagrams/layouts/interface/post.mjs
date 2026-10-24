// diagrams/layouts/interface/post.mjs — a social post card.
import { checkLabel, MAX_TITLE, MAX_NOTE } from '../../spec.mjs';
import { titleBlock } from '../_common.mjs';

export default {
  name: 'post',
  description: 'A social post card with author, text and metrics',
  frame: 'full',
  fields: ['title', 'platform', 'author', 'handle', 'text', 'metrics'],

  minDurationFor() { return 2.0; },

  validate(spec) {
    const out = [];
    if (spec?.title != null) checkLabel(spec.title, 'title', out, { max: MAX_TITLE, required: false });
    checkLabel(spec?.author, 'author', out, { max: MAX_NOTE });
    if (spec?.handle != null) checkLabel(spec.handle, 'handle', out, { max: MAX_NOTE, required: false });
    checkLabel(spec?.text, 'text', out, { max: 220 });
    if (spec?.metrics != null && !Array.isArray(spec.metrics)) out.push('metrics must be an array');
    return out;
  },

  slots(spec) {
    const out = [];
    if (spec?.title) out.push('title');
    out.push('post');
    return out;
  },

  build(spec, c, P) {
    const { node: title, body } = titleBlock(spec, c, P, { ratio: 0.08, landscapeRatio: 0.12 });
    const nodes = [];
    const build = [];
    if (title) { nodes.push(title); build.push(['title']); }

    const w = Math.min(body.w, P.unit * 0.72);
    const box = { x: body.x + (body.w - w) / 2, y: body.y, w, h: Math.min(body.h, P.unit * 0.62) };
    nodes.push(P.post('post', box, {
      platform: spec?.platform,
      author: spec?.author,
      handle: spec?.handle,
      text: spec?.text,
      metrics: spec?.metrics,
      fontSize: Math.round(P.unit * 0.027),
    }));
    build.push(['post']);

    return { nodes, build };
  },
};
