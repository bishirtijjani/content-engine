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
 * Returns, per spoken word, the script line it belongs to (-1 if none) and the
 * script word to substitute when the spoken word is a near-miss.
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

function tokEq(word, token) {
  const t = norm(word.text);
  return t === token || near(t, token);
}

/**
 * Every place in the spoken stream where the anchor words appear in order.
 * A retry restarts the line, so the LAST occurrence starts the keeper.
 */
function anchorOccurrences(list, anchor, windowSec = 15, maxSkip = 4) {
  const occ = [];
  if (!anchor.length) return occ;
  for (let p = 0; p < list.length; p += 1) {
    if (!tokEq(list[p], anchor[0])) continue;
    let qi = p + 1;
    let ai = 1;
    let ok = true;
    while (ai < anchor.length) {
      let found = -1;
      for (let q = qi; q < list.length && q - qi <= maxSkip; q += 1) {
        if (list[q].start - list[p].start > windowSec) break;
        if (tokEq(list[q], anchor[ai])) { found = q; break; }
      }
      if (found < 0) { ok = false; break; }
      qi = found + 1;
      ai += 1;
    }
    if (ok) occ.push(p);
  }
  return occ;
}

/** Index where the last uninterrupted run of words begins. */
function lastRunStart(idxList, list, gapSec) {
  if (!idxList.length) return -1;
  let start = idxList[0];
  for (let k = 1; k < idxList.length; k += 1) {
    if (list[idxList[k]].start - list[idxList[k - 1]].end > gapSec) start = idxList[k];
  }
  return start;
}

/**
 * Keep span per script line: from the start of the LAST attempt to the end of
 * the words that align to the line, plus a short tail window. Everything after
 * that is a detour and goes.
 */
export function lineKeepSpans(list, script, cfg = {}) {
  const { lineOf } = alignScript(list, script);
  const mapped = script.map(() => []);
  for (let i = 0; i < list.length; i += 1) {
    if (lineOf[i] >= 0) mapped[lineOf[i]].push(i);
  }

  const pad = cfg.pad ?? 0.05;
  const tailWindow = cfg.tailWindow ?? 3.0;
  const restartGap = cfg.restartGap ?? 4.0;

  const lines = script.map((text, li) => {
    const toks = String(text).split(/\s+/).map(norm).filter(Boolean);
    // the longest opening that actually occurs in the speech is the anchor
    let anchor = toks.slice(0, Math.min(4, toks.length));
    let occ = anchorOccurrences(list, anchor);
    for (let A = Math.min(4, toks.length); A >= 2 && !occ.length; A -= 1) {
      anchor = toks.slice(0, A);
      occ = anchorOccurrences(list, anchor);
    }
    return { li, anchor, occ };
  });

  const startIdx = lines.map((L, li) => {
    if (L.occ.length) return L.occ[L.occ.length - 1];
    return lastRunStart(mapped[li], list, restartGap);
  });

  const order = lines.map((L, li) => li)
    .filter((li) => startIdx[li] >= 0)
    .sort((a, b) => list[startIdx[a]].start - list[startIdx[b]].start);

  const keeps = [];
  const retried = [];
  order.forEach((li, k) => {
    const si = startIdx[li];
    const after = mapped[li].filter((i) => i >= si);
    const all = mapped[li];
    const lastEnd = (after.length ? list[after[after.length - 1]].end
      : (all.length ? list[all[all.length - 1]].end : list[si].end));
    const nextStart = k + 1 < order.length ? list[startIdx[order[k + 1]]].start : Infinity;
    const keepStart = list[si].start;
    let keepEnd = Math.min(lastEnd + tailWindow, nextStart - pad);
    if (keepEnd <= keepStart) keepEnd = Math.max(lastEnd, keepStart + 0.1);
    keeps.push({ start: keepStart, end: keepEnd, line: li, attempts: lines[li].occ.length });
    if (lines[li].occ.length > 1) retried.push(li);
  });

  const missing = lines.filter((L, li) => startIdx[li] < 0).map((L) => L.li);
  return { keeps, missing, retried };
}
