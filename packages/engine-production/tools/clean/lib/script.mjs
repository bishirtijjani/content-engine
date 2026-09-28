// script.mjs — align the spoken words to the script, in order.
//
// The script is the spine of the clean: it says which words belong to which
// line, so a reread can be collapsed to its last take, a detour can be dropped,
// and a word the model misheard can be repaired from the script.
//
// Pure: words + script in, line map and keep spans out.

export function norm(text) {
  return String(text ?? '').toLowerCase().replace(/[^a-z']/g, '');
}

/** Edit distance, but only answers 0, 1, or 2 (two means "further"). */
export function edit1(a, b) {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return 2;
  if (la === lb) {
    let d = 0;
    for (let i = 0; i < la; i += 1) if (a[i] !== b[i]) d += 1;
    return d > 1 ? 2 : d;
  }
  const s = la < lb ? a : b;
  const l = la < lb ? b : a;
  let i = 0;
  let j = 0;
  let diff = 0;
  while (i < s.length && j < l.length) {
    if (s[i] === l[j]) { i += 1; j += 1; } else { diff += 1; j += 1; if (diff > 1) return 2; }
  }
  return 1;
}

/** Two words close enough to be the same word misheard. */
function near(a, b) {
  return Boolean(a) && Boolean(b) && a.length >= 3 && b.length >= 3 && edit1(a, b) === 1;
}

/** A spoken word and a script token are the same word (or one misheard). */
function tokEq(word, token) {
  const t = norm(word.text);
  return t === token || near(t, token);
}

/** Flatten the script to tokens, keeping the line each token came from. */
export function scriptTokens(script) {
  const tokens = [];
  const line = [];
  (script ?? []).forEach((text, li) => {
    for (const raw of String(text).split(/\s+/)) {
      const t = norm(raw);
      if (t) { tokens.push(t); line.push(li); }
    }
  });
  return { tokens, line };
}

/**
 * Monotonic alignment of the spoken words to the script tokens.
 * Used to repair misheard words. Returns, per spoken word, the script line it
 * belongs to (-1 if none) and the script word to substitute on a near-miss.
 */
export function alignScript(list, script) {
  const { tokens: S, line: Sline } = scriptTokens(script);
  const T = list.map((w) => norm(w.text));
  const n = T.length;
  const m = S.length;
  const GAP = -1;
  const sc = (a, b) => (a === b ? 3 : (near(a, b) ? 1 : -2));

  const dp = new Int32Array((n + 1) * (m + 1));
  const at = (i, j) => i * (m + 1) + j;
  for (let i = 1; i <= n; i += 1) dp[at(i, 0)] = i * GAP;
  for (let j = 1; j <= m; j += 1) dp[at(0, j)] = j * GAP;
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const diag = dp[at(i - 1, j - 1)] + sc(T[i - 1], S[j - 1]);
      const up = dp[at(i - 1, j)] + GAP;
      const left = dp[at(i, j - 1)] + GAP;
      dp[at(i, j)] = Math.max(diag, up, left);
    }
  }

  const lineOf = new Array(n).fill(-1);
  const repair = new Array(n).fill(null);
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (dp[at(i, j)] === dp[at(i - 1, j - 1)] + sc(T[i - 1], S[j - 1])) {
      if (sc(T[i - 1], S[j - 1]) > 0) {
        lineOf[i - 1] = Sline[j - 1];
        if (T[i - 1] !== S[j - 1] && near(T[i - 1], S[j - 1])) repair[i - 1] = S[j - 1];
      }
      i -= 1;
      j -= 1;
    } else if (dp[at(i, j)] === dp[at(i - 1, j)] + GAP) {
      i -= 1;
    } else {
      j -= 1;
    }
  }
  return { lineOf, repair, scriptTokens: S, scriptLine: Sline };
}

/** Repair misheard words using the alignment (walk → work, tire → time). */
export function repairWordsWithScript(words, script) {
  if (!script || !script.length) return words;
  const { repair } = alignScript(words, script);
  return words.map((w, idx) => (repair[idx] ? { ...w, text: repair[idx] } : w));
}

/**
 * Every word the alignment thinks was misheard: heard vs the script word.
 * The engine proposes; the agent accepts or rejects each one in the review file.
 */
export function wordFixes(words, script) {
  if (!script || !script.length) return [];
  const { repair } = alignScript(words, script);
  const out = [];
  repair.forEach((fix, index) => {
    if (fix) out.push({ index, at: words[index].start, heard: words[index].text, fix, decision: 'fix' });
  });
  return out;
}

/** Apply the accepted fixes in place: text in, text out. */
export function applyWordFixes(words, fixes) {
  if (!fixes?.length) return words;
  const byIndex = new Map(fixes.map((f) => [f.index, f]));
  return words.map((w, i) => {
    const f = byIndex.get(i);
    return f && f.decision !== 'leave' && f.fix ? { ...w, text: f.fix } : w;
  });
}

/** The words spoken in [a, b], as one string. */
function textIn(list, a, b) {
  return list.filter((w) => w.start >= a - 1e-6 && w.end <= b + 1e-6).map((w) => w.text).join(' ');
}

const OCC = {
  minScore: 0.6,   // fraction of the line's tokens that must be found
  allowSkip: 5,    // spoken words skipped between two matched tokens
  missRatio: 0.3,  // script tokens allowed to be missing (a paraphrase), by length
  mergeGapWords: 3, // occurrences this close are the same attempt
};

/**
 * How much of a script line matches the speech starting at word `p`.
 * Greedy, order-preserving: walks the script tokens and the spoken words
 * together, allowing a few skipped spoken words and a few missing script words.
 * Returns the last matched spoken index and the number of tokens matched.
 */
function matchLineAt(list, p, toks, o) {
  const limit = p + Math.max(toks.length + 8, Math.ceil(toks.length * 1.8));
  const allowMiss = Math.max(2, Math.round(o.missRatio * toks.length));
  let qi = p;
  let ai = 0;
  let matched = 0;
  let end = p;
  let misses = 0;
  while (ai < toks.length && qi < list.length && qi <= limit) {
    let found = -1;
    for (let q = qi; q < list.length && q <= limit && q - qi <= o.allowSkip; q += 1) {
      if (tokEq(list[q], toks[ai])) { found = q; break; }
    }
    if (found >= 0) {
      matched += 1;
      end = found;
      ai += 1;
      qi = found + 1;
    } else {
      misses += 1;
      ai += 1;
      if (misses > allowMiss) break;
    }
  }
  return { end, matched };
}

/**
 * Every place in the spoken stream where a script line is said.
 * Sweeps the whole stream, so a reread is a second occurrence; the caller keeps
 * the last one. Overlapping hits are merged into one attempt.
 */
export function findOccurrences(list, toks, cfg = {}) {
  const o = { ...OCC, ...cfg };
  const m = toks.length;
  if (!m) return [];
  const required = Math.max(2, Math.ceil(o.minScore * m));
  const raw = [];
  for (let p = 0; p < list.length; p += 1) {
    if (!tokEq(list[p], toks[0])) continue;
    const { end, matched } = matchLineAt(list, p, toks, o);
    if (matched >= required) raw.push({ start: p, end, matched });
  }
  const out = [];
  for (const hit of raw.sort((a, b) => a.start - b.start)) {
    const last = out[out.length - 1];
    if (last && hit.start <= last.end + o.mergeGapWords) {
      last.end = Math.max(last.end, hit.end);
      last.matched = Math.max(last.matched, hit.matched);
    } else {
      out.push({ ...hit });
    }
  }
  return out;
}

/**
 * Positions where a run of tokens appears in the speech, all present (no
 * missing token), each within `skip` spoken words of the one before.
 * Used only to find where a line's opening is re-said, so it is strict.
 */
function findAnchorStarts(list, toks, { skip = 3, maxMiss = 0 } = {}) {
  const starts = [];
  if (toks.length < 2) return starts;
  for (let p = 0; p + 1 < list.length; p += 1) {
    if (!tokEq(list[p], toks[0])) continue;
    let qi = p + 1;
    let misses = 0;
    let ok = true;
    for (let ai = 1; ai < toks.length; ai += 1) {
      let found = -1;
      for (let q = qi; q < list.length && q - qi <= skip; q += 1) {
        if (tokEq(list[q], toks[ai])) { found = q; break; }
      }
      if (found < 0) {
        misses += 1;
        if (misses > maxMiss || ai === toks.length - 1) { ok = false; break; }
      } else {
        qi = found + 1;
      }
    }
    if (ok) starts.push(p);
  }
  return starts;
}

/**
 * Keep span per script line: the LAST take, in order.
 *
 * The monotonic alignment (`alignScript`) says which words belong to which line
 * and handles paraphrase, so it is the spine. Each line's mapped words mark a
 * region that ends where the next surviving line begins. Inside that region the
 * line's opening is found again (a restart re-says it) and the LAST hit is the
 * take to keep; if the last take is paraphrased, the last run of mapped words is
 * used instead. A line that never appears is reported missing, never a sliver.
 */
export function lineKeepSpans(list, script, cfg = {}) {
  const lead = cfg.lead ?? 0.05;
  const tailWindow = cfg.tailWindow ?? 0.6;
  const regionTol = cfg.regionTol ?? 0.5;
  const runGap = cfg.runGap ?? 20;
  const { lineOf } = alignScript(list, script);

  const toks = script.map((text) => String(text).split(/\s+/).map(norm).filter(Boolean));
  const mapped = script.map(() => []);
  for (let i = 0; i < list.length; i += 1) {
    if (lineOf[i] >= 0 && lineOf[i] < script.length) mapped[lineOf[i]].push(i);
  }

  const keeps = [];
  const retried = [];
  const missing = [];
  const lines = [];
  let cursor = -Infinity;
  for (let li = 0; li < script.length; li += 1) {
    const mine = mapped[li];
    if (!mine.length || !toks[li].length) {
      lines.push({ line: li, script: script[li], status: 'missing', heard: null, candidate: null });
      missing.push(li);
      continue;
    }
    const regionStart = Math.max(list[mine[0]].start, cursor);
    let regionEnd = Infinity;
    for (let k = li + 1; k < script.length && regionEnd === Infinity; k += 1) {
      if (mapped[k].length) regionEnd = list[mapped[k][0]].start;
    }

    // start of the last unbroken run of this line's own words
    let runStart = mine[mine.length - 1];
    for (let k = mine.length - 1; k > 0; k -= 1) {
      if (list[mine[k]].start - list[mine[k - 1]].end > runGap) break;
      runStart = mine[k - 1];
    }

    // the line's opening, said again inside the region. Union every prefix
    // length and take the latest start (a longer prefix may match only an
    // earlier take while a shorter one matches the last). Only fall back to
    // skipping a leading function word when the opening as written never occurs.
    let anchors = [];
    for (const off of [0, 1]) {
      const n = toks[li].length - off;
      const floor = n >= 3 ? 3 : 2;
      for (let A = Math.min(4, n); A >= floor; A -= 1) {
        const prefix = toks[li].slice(off, off + A);
        const maxMiss = prefix.length >= 3 ? 1 : 0;
        for (const p of findAnchorStarts(list, prefix, { maxMiss })) {
          if (list[p].start >= regionStart - regionTol && list[p].start < regionEnd) anchors.push(p);
        }
      }
      if (anchors.length) break;
    }

    if (!anchors.length) {
      // Not found. Hand it to the agent with the nearest words heard.
      const target = list[mine[0]].start;
      const cand = findOccurrences(list, toks[li], { minScore: 0.34, mergeGapWords: 0 })
        .sort((a, b) => Math.abs(list[a.start].start - target) - Math.abs(list[b.start].start - target))[0] ?? null;
      const candidate = cand ? { start: list[cand.start].start, end: list[cand.end].end + 0.8 } : null;
      lines.push({
        line: li, script: script[li], status: 'missing',
        heard: candidate ? textIn(list, candidate.start, candidate.end) : null, candidate,
      });
      missing.push(li);
      continue;
    }
    anchors = [...new Set(anchors)].sort((a, b) => a - b);

    const endIdx = mine[mine.length - 1];
    let takeStart = anchors[anchors.length - 1];
    if (takeStart < runStart || takeStart > endIdx) takeStart = runStart < endIdx ? runStart : mine[0];
    const start = list[takeStart].start - lead;
    const end = list[endIdx].end + tailWindow;
    keeps.push({ start, end, line: li, attempts: anchors.length, tokens: toks[li].length });
    lines.push({ line: li, script: script[li], status: 'found', start, end, heard: textIn(list, start, end) });
    cursor = list[endIdx].end;
    if (anchors.length > 1) retried.push(li);
  }

  keeps.sort((a, b) => a.start - b.start);
  for (let k = 0; k < keeps.length - 1; k += 1) {
    const next = keeps[k + 1].start;
    if (keeps[k].end > next) keeps[k].end = next;
  }
  return { keeps, missing, retried, lines };
}
