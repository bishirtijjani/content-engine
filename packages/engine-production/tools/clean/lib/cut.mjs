// cut.mjs — turn a word-timed transcript into a cut list.
//
// Everything here is pure: words + span + config in, keeps + cuts out. The
// caller shows the cut list to the human; nothing is cut without approval.
//
// Kinds of cut:
//   pause       — dead air longer than gapMin, trimmed to gapKeep
//   filler      — a disfluency ("um", "uh", ...), cut with a small pad
//   self-talk   — an aside said to himself ("start again", "I'm supposed to")
//   false-start — a short line the next line repeats from the top
//   repeat      — a line said more than once: keep the last try, remove the
//                 first try and everything said up to the last try
//   tag         — a watermark a service baked into the audio, at the head or tail
// plus lead/tail trims for dead air at the very start and end.

import { lineKeepSpans } from './script.mjs';

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
  // asides said to himself. Matched as whole-word runs anywhere in the speech
  // (e.g. "three two one" inside "three two one if you're looking...").
  selfTalk: [
    'start again', 'start over', 'from the top', 'start from the top',
    'one more time', 'one more take', 'take two', 'take three', 'take four',
    'let me start again', "i'm supposed to", 'i am supposed to', 'im supposed to',
    'where was i', 'hold on', 'hang on', 'give me a second', 'just a second',
    'my bad', 'oops', 'wait wait', 'three two one', 'two one', 'one two three',
  ],
  // single words removed only when the whole spoken line is that word
  selfTalkExact: ['wait', 'okay', 'ok', 'pause'],
  // a watermark a service baked into the audio (e.g. Auphonic's free tag).
  // Removed only at the very start or end, never mid-video.
  tags: [
    'free audio post production', 'audio post production', 'post production by',
    'by auphonic', 'by alphonic', 'by auponic',
    'auphonic com', 'alphonic com', 'auponic com',
    'auphonic', 'alphonic', 'auponic',
  ],
  tag: {
    gap: 1.5,         // seconds between tag words that still count as one tag
    headWindow: 25,   // a tag this close to the start is a head tag
    tailWindow: 25,   // a tag this close to the end is a tail tag
  },
  retake: {
    maxGap: 2.0,      // seconds between a false start and the take that repeats it
    similarity: 0.7,  // token-overlap ratio that marks two lines as the same
    maxWords: 8,      // words compared per line
    shortStart: 4,    // a line this short that the next line repeats from the top
  },
  // a line said more than once: keep the last try, remove the first try and
  // everything said up to the last try
  repeat: {
    window: 180,      // seconds apart two tries of the same line can be
    maxAhead: 40,     // how many spoken lines ahead to look for a repeat
    minWords: 3,      // lines shorter than this are never treated as a repeat
    minPrefix: 4,     // same opening words that mark two lines as the same
    shortLine: 4,     // a line this short repeated from the top is the same line
    betweenMax: 999,  // sweep the aside between two tries only when they are this close
    orphanGap: 12,    // a short fragment this close before a try joins its cut
  },
  // a phrase said twice in one breath (a restart in the middle of a line)
  inline: {
    maxWords: 8,      // longest repeated phrase to look for
    minWords: 1,      // 1 catches "the the"; raise it to ignore single words
    gapWords: 3,      // words allowed between the two copies
  },
  maxWordDur: 1.5,  // a word longer than this was stretched by the model
  frameFps: null,   // when set, cut points snap to this frame grid
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
      cur = { start: w.start, end: w.end, texts: [w.text], words: [w] };
    } else {
      cur.end = w.end;
      cur.texts.push(w.text);
      cur.words.push(w);
    }
  }
  if (cur) utts.push(finish(cur));
  return utts;
}

function finish(u) {
  const tokens = u.texts.map(normalizeToken).filter(Boolean);
  return { start: u.start, end: u.end, tokens, words: u.words, text: u.texts.join(' ') };
}

/** Phrases as arrays of normalized tokens, longest first. */
export function selfTalkPhrases(cfg = DEFAULT_CLEAN) {
  return (cfg.selfTalk ?? DEFAULT_CLEAN.selfTalk)
    .map((p) => p.split(' ').map(normalizeToken).filter(Boolean))
    .filter((p) => p.length)
    .sort((a, b) => b.length - a.length);
}

/**
 * Cut ranges for the words that are self-talk. Scanned over the words, not the
 * spoken lines, so a phrase glued to real speech ("three two one if you're
 * looking...") is removed on its own.
 */
function selfTalkRanges(list, cfg) {
  const phrases = selfTalkPhrases(cfg);
  const out = [];
  let s = 0;
  while (s < list.length) {
    let hit = null;
    for (const p of phrases) {
      if (s + p.length > list.length) continue;
      let ok = true;
      for (let t = 0; t < p.length; t += 1) {
        if (normalizeToken(list[s + t].text) !== p[t]) { ok = false; break; }
      }
      if (ok) { hit = p; break; }
    }
    if (hit) {
      out.push({
        start: list[s].start - cfg.pad,
        end: list[s + hit.length - 1].end + cfg.pad,
        detail: hit.join(' '),
      });
      s += hit.length;
    } else {
      s += 1;
    }
  }
  return out;
}

/** True when a spoken line is only self-talk (or a single exact aside word). */
export function isSelfTalk(utt, cfg = DEFAULT_CLEAN) {
  const tokens = utt.tokens;
  if (!tokens.length) return false;
  const exact = cfg.selfTalkExact ?? DEFAULT_CLEAN.selfTalkExact;
  if (tokens.length === 1 && exact.includes(tokens[0])) return true;
  const phrases = selfTalkPhrases(cfg);
  let i = 0;
  while (i < tokens.length) {
    const hit = phrases.find((p) => p.every((t, k) => tokens[i + k] === t));
    if (!hit) return false;
    i += hit.length;
  }
  return true;
}

/**
 * A phrase said twice in one breath: "then there's then there's operations",
 * "the the goal". Cut the earlier copy; keep the later. Works inside a single
 * spoken line, which the take-level repeat pass cannot see.
 */
function inlineRepeats(list, cfg) {
  const cfgIn = { ...DEFAULT_CLEAN.inline, ...(cfg.inline ?? {}) };
  const out = [];
  for (const u of splitUtterances(list, cfg.utteranceGap)) {
    const tw = u.words.map((w) => ({ t: normalizeToken(w.text), w })).filter((x) => x.t);
    const T = tw.map((x) => x.t);
    let i = 0;
    while (i < T.length) {
      let hit = null;
      for (let n = cfgIn.maxWords; n >= cfgIn.minWords && !hit; n -= 1) {
        if (i + 2 * n > T.length) continue;
        for (let j = i + n; j + n <= T.length && j - (i + n) <= cfgIn.gapWords; j += 1) {
          let ok = true;
          for (let t = 0; t < n; t += 1) { if (T[i + t] !== T[j + t]) { ok = false; break; } }
          if (ok) { hit = { n, j }; break; }
        }
      }
      if (hit) {
        out.push({
          start: tw[i].w.start - cfg.pad, end: tw[hit.j].w.start - cfg.pad,
          detail: `"${T.slice(i, i + hit.n).join(' ')}" twice`,
        });
        i = hit.j;
      } else {
        i += 1;
      }
    }
  }
  return out;
}

/** Tag phrases as arrays of normalized tokens, longest first. */
function tagPhrases(cfg) {
  return (cfg.tags ?? DEFAULT_CLEAN.tags)
    .map((p) => p.split(' ').map(normalizeToken).filter(Boolean))
    .filter((p) => p.length)
    .sort((a, b) => b.length - a.length);
}

/**
 * Head or tail cuts for a baked-in watermark (e.g. Auphonic's free tag). A tag
 * found close to the start is cut from the start up to the end of the tag; a tag
 * close to the end is cut from its start to the end. A tag elsewhere is ignored.
 */
function tagRanges(list, cfg, span) {
  const phrases = tagPhrases(cfg);
  const idx = [];
  let s = 0;
  while (s < list.length) {
    let hit = null;
    for (const p of phrases) {
      if (s + p.length > list.length) continue;
      let ok = true;
      for (let t = 0; t < p.length; t += 1) {
        if (normalizeToken(list[s + t].text) !== p[t]) { ok = false; break; }
      }
      if (ok) { hit = p; break; }
    }
    if (hit) { for (let t = 0; t < hit.length; t += 1) idx.push(s + t); s += hit.length; } else { s += 1; }
  }
  if (!idx.length) return [];
  const groups = [];
  let cur = { s: idx[0], e: idx[0] };
  for (let k = 1; k < idx.length; k += 1) {
    const i = idx[k];
    if (i === cur.e + 1 || list[i].start - list[cur.e].end <= cfg.tag.gap) cur.e = i;
    else { groups.push(cur); cur = { s: i, e: i }; }
  }
  groups.push(cur);
  // swallow a trailing ".com" of the brand's URL
  for (const g of groups) {
    while (g.e + 1 < list.length && normalizeToken(list[g.e + 1].text) === 'com'
      && list[g.e + 1].start - list[g.e].end <= 0.5) g.e += 1;
  }
  const out = [];
  for (const g of groups) {
    const gs = list[g.s].start;
    const ge = list[g.e].end;
    if (gs - span.start <= cfg.tag.headWindow) {
      out.push({ start: span.start, end: ge + cfg.pad, detail: `head: "${list.slice(g.s, g.e + 1).map((w) => w.text).join(' ')}"` });
    } else if (span.end - ge <= cfg.tag.tailWindow) {
      out.push({ start: gs - cfg.pad, end: span.end, detail: `tail: "${list.slice(g.s, g.e + 1).map((w) => w.text).join(' ')}"` });
    }
  }
  return out;
}

/** A word longer than maxWordDur was stretched by the model; cap it. */
function clampWords(list, cfg) {
  return list.map((w) => (w.end - w.start > cfg.maxWordDur ? { ...w, end: w.start + cfg.maxWordDur } : w));
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

/** How many words two takes share at the very start. */
export function sharedPrefix(aTokens, bTokens) {
  const n = Math.min(aTokens.length, bTokens.length);
  let i = 0;
  while (i < n && aTokens[i] === bTokens[i]) i += 1;
  return i;
}

function mergeSpans(spans, joinGap = 0.08) {
  const out = [];
  for (const s of [...spans].sort((x, y) => x.start - y.start)) {
    const reasons = s.reasons ? [...s.reasons] : [s.reason];
    const last = out[out.length - 1];
    if (last && s.start - last.end <= joinGap) {
      last.end = Math.max(last.end, s.end);
      for (const r of reasons) if (!last.reasons.includes(r)) last.reasons.push(r);
    } else {
      out.push({ start: s.start, end: s.end, reason: reasons[0], reasons, detail: s.detail });
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

/**
 * Build the cut list.
 *
 * `silences` are audio-measured silent spans. When given, pauses come from them
 * and never from transcript gaps — so a word the model missed is never cut.
 * When omitted, pauses fall back to transcript gaps (used by the tests).
 *
 * @returns {{ keeps: {start,end}[], cuts: {start,end,reason,detail?}[], stats: object }}
 */
export function buildCuts({ words = [], span = null, silences = null, config = {}, script = null } = {}) {
  const cfg = {
    ...DEFAULT_CLEAN,
    ...config,
    retake: { ...DEFAULT_CLEAN.retake, ...(config.retake ?? {}) },
    repeat: { ...DEFAULT_CLEAN.repeat, ...(config.repeat ?? {}) },
    inline: { ...DEFAULT_CLEAN.inline, ...(config.inline ?? {}) },
    tag: { ...DEFAULT_CLEAN.tag, ...(config.tag ?? {}) },
  };
  const list = clampWords(
    [...words].filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end))
      .sort((a, b) => a.start - b.start),
    cfg,
  );
  if (!list.length) {
    return { keeps: [], cuts: [], stats: { kept: 0, removed: 0, byReason: {} } };
  }

  const start = span?.start ?? list[0].start;
  const end = span?.end ?? list[list.length - 1].end;

  // with a script, the script is the spine: keep the last take of each line
  if (script && script.length) {
    return buildScriptCuts({ list, start, end, silences, cfg, script });
  }

  const semantic = [];

  // 1. pauses — from measured silence, never from a transcript gap
  if (silences) {
    semantic.push(...pauseSpans(list, silences, cfg));
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

  // 3. spoken lines — self-talk, false starts, and repeated takes
  // 3a. self-talk — asides said to himself (matched on the words themselves)
  for (const st of selfTalkRanges(list, cfg)) {
    semantic.push({ ...st, reason: 'self-talk' });
  }

  // 3a2. a watermark baked into the audio, at the head or the tail
  for (const t of tagRanges(list, cfg, { start, end })) {
    semantic.push({ ...t, reason: 'tag' });
  }

  const utts = splitUtterances(list, cfg.utteranceGap);
  const content = utts.filter((u) => !isSelfTalk(u, cfg));

  // 3b. false starts — a short line the next line repeats from the top
  for (let i = 0; i < content.length - 1; i += 1) {
    const a = content[i];
    const b = content[i + 1];
    if (b.start - a.end > cfg.retake.maxGap) continue;
    const prefix = a.tokens.length > 0 && a.tokens.length <= cfg.retake.shortStart
      && lcs(a.tokens, b.tokens.slice(0, a.tokens.length)) === a.tokens.length;
    if (prefix) {
      semantic.push({
        start: a.start - cfg.pad, end: a.end + cfg.pad, reason: 'false-start',
        detail: `"${clip(a.text)}" → "${clip(b.text)}"`,
      });
    }
  }

  // 3c. repeated takes — keep the last try, remove the first try and everything
  //     said up to the last try. Jumping past the keeper means an aside between
  //     two tries is swept up with the first try.
  let i = 0;
  while (i < content.length) {
    const a = content[i];
    if (a.tokens.length < cfg.repeat.minWords) { i += 1; continue; }
    let last = -1;
    for (let k = i + 1; k < content.length && k - i <= cfg.repeat.maxAhead; k += 1) {
      const b = content[k];
      if (b.start - a.end > cfg.repeat.window) break;
      if (b.tokens.length < cfg.repeat.minWords) continue;
      const pref = sharedPrefix(a.tokens, b.tokens);
      const same = similarity(a.tokens, b.tokens, cfg.retake.maxWords) >= cfg.retake.similarity
        || pref >= cfg.repeat.minPrefix
        || (a.tokens.length <= cfg.repeat.shortLine && pref >= a.tokens.length)
        || (a.tokens.length === 1 && b.tokens[0] === a.tokens[0]);
      if (same) last = k;
    }
    if (last > i) {
      const keeper = content[last];
      // short fragments right before the first try are the same broken sentence
      let s = a.start - cfg.pad;
      let anchor = a.start;
      for (let p = i - 1; p >= 0; p -= 1) {
        const prev = content[p];
        if (prev.tokens.length > cfg.repeat.shortLine
          || anchor - prev.end > cfg.repeat.orphanGap) break;
        s = prev.start - cfg.pad;
        anchor = prev.start;
      }
      // sweep the aside between the tries only when they are close; a distant
      // match removes just the earlier try, so nothing good in between is lost
      const near = keeper.start - a.end <= cfg.repeat.betweenMax;
      semantic.push({
        start: s, end: near ? keeper.start - cfg.pad : a.end + cfg.pad, reason: 'repeat',
        detail: near ? `keep the later take of "${clip(a.text)}"` : `drop an earlier take of "${clip(a.text)}"`,
      });
      i = near ? last : i + 1;
    } else {
      i += 1;
    }
  }

  // 3d. a phrase said twice in one breath
  for (const r of inlineRepeats(list, cfg)) {
    semantic.push({ ...r, reason: 'repeat' });
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

  // clamp to span, merge overlaps, snap to frames, absorb tiny keeps
  return finalizeCuts(semantic, start, end, cfg);
}

/** Measured-silence pauses, pulled clear of any word. */
function pauseSpans(list, silences, cfg) {
  const out = [];
  for (const s of silences) {
    const len = s.end - s.start;
    if (len <= cfg.gapMin) continue;
    let cs = s.start + cfg.gapKeep;
    let ce = s.end - cfg.gapKeep;
    // never cut into a word. Whisper's word ends bleed into the silence, so
    // pull the edges clear of any word instead of abandoning the cut.
    let bad = false;
    for (const w of list) {
      if (w.end <= cs || w.start >= ce) continue;
      if (w.start <= cs && w.end >= ce) { bad = true; break; }
      if (w.start <= cs) cs = w.end + cfg.cutPadEnd;
      else if (w.end >= ce) ce = w.start - cfg.cutPadEnd;
      else { bad = true; break; }
    }
    if (bad || ce - cs < cfg.minCut) continue;
    out.push({ start: cs, end: ce, reason: 'pause', detail: `${len.toFixed(1)}s` });
  }
  return out;
}

/** Shared finish: clamp to the span, merge, snap to frames, absorb tiny keeps. */
function finalizeCuts(semantic, start, end, cfg) {
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

  let keeps = invertSpans(cuts, start, end);
  const tiny = keeps.filter((k, idx) => idx > 0 && idx < keeps.length - 1 && k.end - k.start < cfg.minKeep);
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

/**
 * Script-led cut: keep the last take of every line. Everything between takes
 * (earlier tries, detours, non-speech) is cut as "off-script"; inside a kept
 * take, only pauses, fillers and self-talk are trimmed.
 */
function buildScriptCuts({ list, start, end, silences, cfg, script }) {
  const { keeps: rawKeeps, missing, retried } = lineKeepSpans(list, script, cfg);

  // merge takes that run into each other
  const merged = [];
  for (const k of [...rawKeeps].sort((a, b) => a.start - b.start)) {
    const last = merged[merged.length - 1];
    if (last && k.start - last.end <= cfg.utteranceGap) last.end = Math.max(last.end, k.end);
    else merged.push({ start: k.start, end: k.end });
  }

  const semantic = [];
  // everything outside a kept take
  let cur = start;
  for (const k of merged) {
    const ce = Math.max(cur, k.start - cfg.pad);
    if (ce - cur > 0.03) semantic.push({ start: cur, end: ce, reason: 'off-script' });
    cur = Math.max(cur, k.end + cfg.pad);
  }
  if (end - cur > 0.03) semantic.push({ start: cur, end, reason: 'off-script' });

  // inside the kept takes: trim pauses
  const inside = (a, b) => merged.some((k) => a >= k.start - 0.001 && b <= k.end + 0.001);
  if (silences) {
    for (const p of pauseSpans(list, silences, cfg)) {
      if (inside(p.start, p.end)) semantic.push(p);
    }
  }

  // inside the kept takes: fillers and self-talk
  const fill = new Set(cfg.fillers.map(normalizeToken));
  for (const w of list) {
    const t = normalizeToken(w.text);
    if (t && fill.has(t) && merged.some((k) => w.start > k.start && w.end < k.end)) {
      semantic.push({ start: w.start - cfg.pad, end: w.end + cfg.pad, reason: 'filler', detail: w.text.trim() });
    }
  }
  for (const st of selfTalkRanges(list, cfg)) {
    if (inside(st.start, st.end)) semantic.push({ ...st, reason: 'self-talk' });
  }

  const result = finalizeCuts(semantic, start, end, cfg);
  result.qa = {
    lines: script.length, kept: merged.length, missing, retried,
  };
  return result;
}

function clip(text, n = 48) {
  const t = String(text).trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function r3(x) {
  return Math.round(x * 1000) / 1000;
}
