// diagrams/layouts/interface/code.mjs — a short code snippet or diff.
import { checkLabel, checkCount, MAX_TITLE, playTime } from '../../spec.mjs';
import { titleBlock } from '../_common.mjs';
import { tokenizeLine } from '../../code/tokenize.mjs';

export default {
  name: 'code',
  description: 'A short code block, optionally as a diff',
  frame: 'full',
  fields: ['title', 'language', 'lines', 'diff'],

  minDurationFor(n) { return playTime(1.0, 0.2, n); },

  validate(spec) {
    const out = [];
    if (spec?.title != null) checkLabel(spec.title, 'title', out, { max: MAX_TITLE, required: false });
    const lines = Array.isArray(spec?.lines) ? spec.lines : [];
    checkCount(lines, 'lines', out, 2, 14);
    lines.forEach((l, i) => { if (typeof l !== 'string') out.push(`lines[${i}] must be a string`); });
    if (spec?.language != null && !['js', 'ts', 'bash', 'json', 'css', 'html'].includes(spec.language)) {
      out.push('language must be js, ts, bash, json, css or html');
    }
    return out;
  },

  slots(spec) {
    const out = [];
    if (spec?.title) out.push('title');
    out.push('code');
    return out;
  },

  build(spec, c, P) {
    const { node: title, body } = titleBlock(spec, c, P, { ratio: 0.09, landscapeRatio: 0.13 });
    const nodes = [];
    const build = [];
    if (title) { nodes.push(title); build.push(['title']); }

    const language = spec?.language ?? 'js';
    const lines = (Array.isArray(spec?.lines) ? spec.lines : []).map((line) => {
      if (!spec?.diff) return { tokens: tokenizeLine(line, language) };
      const m = /^([+-])\s?(.*)$/.exec(line);
      if (!m) return { tokens: tokenizeLine(line, language) };
      return { tokens: tokenizeLine(m[2], language), tone: m[1] === '+' ? 'add' : 'del' };
    });

    nodes.push(P.code('code', body, {
      lines,
      language,
      diff: spec?.diff === true,
      fontSize: Math.round(P.unit * (lines.length > 10 ? 0.018 : 0.021)),
      gutter: spec?.gutter !== false,
    }));
    build.push(['code']);

    return { nodes, build };
  },
};
