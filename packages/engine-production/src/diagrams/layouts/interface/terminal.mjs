// diagrams/layouts/interface/terminal.mjs — a terminal window.
import { checkLabel, checkCount, MAX_TITLE, playTime } from '../../spec.mjs';
import { titleBlock } from '../_common.mjs';

export default {
  name: 'terminal',
  description: 'A terminal window with command output',
  frame: 'full',
  fields: ['title', 'lines'],

  minDurationFor(n) { return playTime(1.0, 0.2, n); },

  validate(spec) {
    const out = [];
    if (spec?.title != null) checkLabel(spec.title, 'title', out, { max: MAX_TITLE, required: false });
    const lines = Array.isArray(spec?.lines) ? spec.lines : [];
    checkCount(lines, 'lines', out, 2, 10);
    lines.forEach((l, i) => {
      if (typeof l !== 'string' && typeof l?.text !== 'string') out.push(`lines[${i}] needs text`);
    });
    return out;
  },

  slots(spec) {
    const out = [];
    if (spec?.title) out.push('title');
    out.push('terminal');
    return out;
  },

  build(spec, c, P) {
    const { node: title, body } = titleBlock(spec, c, P, { ratio: 0.09, landscapeRatio: 0.13 });
    const nodes = [];
    const build = [];
    if (title) { nodes.push(title); build.push(['title']); }

    nodes.push(P.terminal('terminal', body, {
      title: spec?.titleBar ?? 'terminal',
      lines: Array.isArray(spec?.lines) ? spec.lines : [],
      fontSize: Math.round(P.unit * 0.0215),
    }));
    build.push(['terminal']);

    return { nodes, build };
  },
};
