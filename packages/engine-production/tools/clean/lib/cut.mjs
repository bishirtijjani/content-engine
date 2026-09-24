// cut.mjs — turn a word-timed transcript into a cut list.
//
// Everything here is pure: words + span + config in, keeps + cuts out. The
// caller shows the cut list to the human; nothing is cut without approval.
//
// Three kinds of cut:
//   pause  — dead air between words longer than gapMin, trimmed to gapKeep
//   filler — a disfluency ("um", "uh", ...), cut with a small pad
//   retake — a repeated or flubbed take; the earlier one goes
// plus lead/tail trims for dead air at the very start and end.

export const DEFAULT_CLEAN = {
  gapMin: 0.9,     // a silence longer than this is a pause to trim
  gapKeep: 0.3,    // silence kept after the previous word
  minCut: 0.3,     // never make a pause cut shorter than this
  cutPadEnd: 0.02, // silence kept before the next word
  edgeKeep: 0.3,   // silence kept at the very start and end
  pad: 0.05,       // padding around a filler or retake cut
  minKeep: 0.4,    // a kept clip shorter than this is absorbed into a cut
  utteranceGap: 0.35, // gap that ends an utterance
  fillers: ['um', 'uh', 'erm', 'er', 'uhm', 'hmm', 'mm', 'ah', 'eh', 'huh'],
  retake: {
    maxGap: 2.0,      // seconds between two takes to compare them
    similarity: 0.7,  // token-overlap ratio that marks a retake
    maxWords: 8,      // words compared per utterance
    shortStart: 4,    // an utterance this short that the next one repeats
  },
  frameFps: null,  // when set, cut points snap to this frame grid
};

export function normalizeToken(text) {
  return String(text ?? '').toLowerCase().replace(/[^a-z']/g, '');
}

/** Group consecutive words into utterances, split on gaps over `gap`. */
export function splitUtterances(words, gap = DEFAULT_CLEAN.utteranceGap) {
  const utts = [];
  let cur = null;
  for (const w of words) {
    if (!cur || w.start - cur.end > gap) {
      if (cur) utts.push(finish(cur));
      cur = { start: w.start, end: w.end, texts: [w.text] };
    } else {
      cur.end = w.end;
      cur.texts.push(w.text);
    }
  }
  if (cur) utts.push(finish(cur));
  return utts;
}

function finish(u) {
  const tokens = u.texts.map(normalizeToken).filter(Boolean);
  return { start: u.start, end: u.end, tokens, text: u.texts.join(' ') };
}

function lcs(a, b) {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[n][m];
}

/** Token-overlap ratio of the first `maxWords` words of two takes (0..1). */
export function similarity(aTokens, bTokens, maxWords = 8) {
  const a = aTokens.slice(0, maxWords);
  const b = bTokens.slice(0, maxWords);
  if (!a.length || !b.length) return 0;
  return (2 * lcs(a, b)) / (a.length + b.length);
}

function mergeSpans(spans, joinGap = 0.08) {
  const out = [];
  for (const s of [...spans].sort((x, y) => x.start - y.start)) {
    const last = out[out.length - 1];
    if (last && s.start - last.end <= joinGap) {
      last.end = Math.max(last.end, s.end);
      if (!last.reasons.includes(s.reason)) last.reasons.push(s.reason);
    } else {
      out.push({ start: s.start, end: s.end, reason: s.reason, reasons: [s.reason], detail: s.detail });
    }
  }
  return out;
}

/** Complement of `cuts` inside [start, end]. */
export function invertSpans(cuts, start, end) {
  const keeps = [];
  let cur = start;
  for (const c of cuts) {
    if (c.start - cur > 1e-6) keeps.push({ start: cur, end: c.start });
    cur = Math.max(cur, c.end);
  }
  if (end - cur > 1e-6) keeps.push({ start: cur, end });
  return keeps;
}

function snapTime(t, fps) {
  return Math.round(t * fps) / fps;
}

function reasonFor(span, cuts) {
  let best = null;
  let bestOverlap = 0;
  for (const c of cuts) {
    const o = Math.min(span.end, c.end) - Math.max(span.start, c.start);
    if (o > bestOverlap) { bestOverlap = o; best = c; }
  }
  if (!best) return 'tight';
  return best.reasons ? best.reasons.join('+') : best.reason;
}

/**
 * Build the cut list.
 *
 * `silences` are audio-measured silent spans. When given, pauses come from them
 * and never from transcript gaps — so a word the model missed is never cut.
 * When omitted, pauses fall back to transcript gaps (used by the tests).
 *
 * @returns {{ keeps: {start,end}[], cuts: {start,end,reason,detail?}[], stats: object }}
 */
export function buildCuts({ words = [], span = null, silences = null, config = {} } = {}) {
  const cfg = {
    ...DEFAULT_CLEAN,
    ...config,
    retake: { ...DEFAULT_CLEAN.retake, ...(config.retake ?? {}) },
  };
  const list = [...words].filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end))
    .sort((a, b) => a.start - b.start);
  if (!list.length) {
    return { keeps: [], cuts: [], stats: { kept: 0, removed: 0, byReason: {} } };
  }

  const start = span?.start ?? list[0].start;
  const end = span?.end ?? list[list.length - 1].end;
  const semantic = [];
  const overlapsWord = (s, e) => list.some((w) => w.start < e - 1e-6 && w.end > s + 1e-6);

  // 1. pauses — from measured silence, never from a transcript gap
  if (silences) {
    for (const s of silences) {
      const len = s.end - s.start;
      if (len <= cfg.gapMin) continue;
      const cs = s.start + cfg.gapKeep;
      const ce = s.end - cfg.gapKeep;
      if (ce - cs < cfg.minCut || overlapsWord(cs, ce)) continue;
      semantic.push({ start: cs, end: ce, reason: 'pause', detail: `${len.toFixed(1)}s` });
    }
  } else {
    for (let i = 1; i < list.length; i += 1) {
      const gap = list[i].start - list[i - 1].end;
      if (gap > cfg.gapMin) {
        const s = list[i - 1].end + cfg.gapKeep;
        const e = list[i].start - cfg.cutPadEnd;
        if (e - s > 0.05) semantic.push({ start: s, end: e, reason: 'pause', detail: `${gap.toFixed(1)}s` });
      }
    }
  }

  // 2. filler words
  const fill = new Set(cfg.fillers.map(normalizeToken));
  for (const w of list) {
    if (fill.has(normalizeToken(w.text))) {
      semantic.push({ start: w.start - cfg.pad, end: w.end + cfg.pad, reason: 'filler', detail: w.text.trim() });
    }
  }

  // 3. retakes / false starts
  const utts = splitUtterances(list, cfg.utteranceGap);
  for (let i = 0; i < utts.length - 1; i += 1) {
    const a = utts[i];
    const b = utts[i + 1];
    if (b.start - a.end > cfg.retake.maxGap) continue;
    const sim = similarity(a.tokens, b.tokens, cfg.retake.maxWords);
    const prefix = a.tokens.length <= cfg.retake.shortStart
      && lcs(a.tokens, b.tokens.slice(0, a.tokens.length)) === a.tokens.length;
    if (sim >= cfg.retake.similarity || prefix) {
      semantic.push({
        start: a.start - cfg.pad, end: a.end + cfg.pad, reason: 'retake',
        detail: `"${clip(a.text)}" → "${clip(b.text)}"`,
      });
    }
  }

  // 4. dead air at the very start and end (only when pauses are not measured —
  //    measured silence already covers the edges)
  const first = list[0];
  const last = list[list.length - 1];
  if (!silences && first.start - start > cfg.gapMin) {
    semantic.push({ start, end: first.start - cfg.edgeKeep, reason: 'lead', detail: 'dead air at start' });
  }
  if (!silences && end - last.end > cfg.gapMin) {
    semantic.push({ start: last.end + cfg.edgeKeep, end, reason: 'tail', detail: 'dead air at end' });
  }

  // clamp to span, merge overlaps, snap to frames
  let cuts = mergeSpans(
    semantic
      .map((c) => ({ ...c, start: Math.max(start, c.start), end: Math.min(end, c.end) }))
      .filter((c) => c.end - c.start > 0.03),
  );
  if (cfg.frameFps) {
    cuts = mergeSpans(
      cuts
        .map((c) => ({ ...c, start: snapTime(c.start, cfg.frameFps), end: snapTime(c.end, cfg.frameFps) }))
        .filter((c) => c.end - c.start > 0.03),
    );
  }

  // 5. absorb tiny keeps into the surrounding cuts (internal keeps only —
  //    a keep at the very start or end is room tone, not an edit)
  let keeps = invertSpans(cuts, start, end);
  const tiny = keeps.filter((k, i) => i > 0 && i < keeps.length - 1 && k.end - k.start < cfg.minKeep);
  if (tiny.length) {
    for (const d of tiny) cuts = mergeSpans([...cuts, { start: d.start, end: d.end, reason: 'tight' }]);
    keeps = invertSpans(cuts, start, end);
  }

  const finalCuts = cuts.map((c) => ({
    start: c.start,
    end: c.end,
    reason: c.reasons.filter((x) => x !== 'tight').join('+') || 'tight',
    detail: c.detail ?? null,
  }));

  let kept = 0;
  for (const k of keeps) kept += k.end - k.start;
  const removed = Math.max(0, end - start - kept);
  const byReason = {};
  for (const c of finalCuts) byReason[c.reason] = r3((byReason[c.reason] ?? 0) + (c.end - c.start));

  return {
    keeps,
    cuts: finalCuts,
    span: { start, end },
    stats: { kept: r3(kept), removed: r3(removed), byReason },
  };
}

function clip(text, n = 48) {
  const t = String(text).trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function r3(x) {
  return Math.round(x * 1000) / 1000;
}
