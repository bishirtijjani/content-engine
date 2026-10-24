// diagrams/layouts/charts/table.mjs — a real table (rate card, ledger, data).
import { checkLabel, checkCount, MAX_TITLE, playTime } from '../../spec.mjs';
import { titleBlock } from '../_common.mjs';

export default {
  name: 'table',
  description: 'A ruled table with a header row: rates, ledgers, data',
  frame: 'full',
  fields: ['title', 'columns', 'rows', 'header', 'zebra', 'highlightRow'],

  minDurationFor(n) { return playTime(1.0, 0.25, n); },

  validate(spec) {
    const out = [];
    if (spec?.title != null) checkLabel(spec.title, 'title', out, { max: MAX_TITLE, required: false });
    const cols = Array.isArray(spec?.columns) ? spec.columns : [];
    checkCount(cols, 'columns', out, 2, 6);
    cols.forEach((c, i) => checkLabel(typeof c === 'string' ? c : c?.label, `columns[${i}]`, out, { max: 24 }));
    const rows = Array.isArray(spec?.rows) ? spec.rows : [];
    checkCount(rows, 'rows', out, 2, 8);
    rows.forEach((r, i) => {
      if (!Array.isArray(r)) out.push(`rows[${i}] must be an array of cells`);
      else if (r.length !== cols.length) out.push(`rows[${i}] has ${r.length} cells, expected ${cols.length}`);
    });
    if (spec?.highlightRow != null && !Number.isInteger(spec.highlightRow)) out.push('highlightRow must be an integer index');
    return out;
  },

  slots(spec) {
    const out = [];
    if (spec?.title) out.push('title');
    (Array.isArray(spec?.rows) ? spec.rows : []).forEach((_, i) => out.push(`row-${i}`));
    return out;
  },

  build(spec, c, P) {
    const { node: title, body } = titleBlock(spec, c, P, { ratio: 0.10, landscapeRatio: 0.14 });
    const rows = Array.isArray(spec?.rows) ? spec.rows : [];
    const nodes = [];
    const build = [];
    if (title) { nodes.push(title); build.push(['title']); }

    const cols = (spec?.columns ?? []).map((x) => (typeof x === 'string' ? { label: x } : x));
    nodes.push(P.table('table', body, {
      columns: cols,
      rows,
      header: spec?.header !== false,
      zebra: spec?.zebra === true,
      highlightRow: spec?.highlightRow,
      rowSlots: true,
      slot: false,
      fontSize: Math.round(P.unit * (rows.length > 5 ? 0.023 : 0.026)),
      r: 30,
    }));
    rows.forEach((_, i) => build.push([`row-${i}`]));

    return { nodes, build };
  },
};
