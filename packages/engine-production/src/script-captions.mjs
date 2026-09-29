/**
 * script-captions.mjs — ground the captions in the finalized script.
 *
 * The ASR transcript has the right timings but the wrong text: it mis-hears
 * words and carries no punctuation, so the caption splitter has no sentence or
 * clause boundaries to cut on and produces captions that start mid-thought
 * ("of human time There are seven").
 *
 * This aligns the finalized script (correct wording + punctuation) to the ASR
 * word timings in two steps:
 *   1. an exact-word LCS gives the anchors;
 *   2. between two anchors the leftover script words and leftover spoken words
 *      are paired in order, so a mis-heard word ("walk" for "work") still takes
 *      the script's spelling.
 * A matched word keeps the transcript's timing; a word only the speaker said
 * (off-script improv) is kept as spoken. The result is one punctuated,
 * transcript-ordered stream that groupCaptions() can cut on real boundaries.
 */

const norm = (t) => String(t).replace(/[^\w']/g, "").toLowerCase();

/** Levenshtein distance, capped — used only to spot a mis-heard word. */
function editDistance(a, b, cap = 3) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < best) best = cur[j];
    }
    if (best > cap) return cap + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** True when two words are close enough to be the same word mis-heard. */
function similar(a, b) {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 3) return false;
  return editDistance(a, b) <= 2;
}

/**
 * @param {string} scriptText - the finalized script (lines, with punctuation)
 * @param {Array<{text:string,start:number,end:number}>} asrWords
 * @returns {Array<{text:string,start:number,end:number}>} corrected token stream
 */
export function buildScriptWords(scriptText, asrWords, { maxCells = 4000000 } = {}) {
  if (!Array.isArray(asrWords) || asrWords.length === 0) return asrWords ?? [];
  const scriptTokens = String(scriptText ?? "").split(/\s+/).map((t) => t.trim()).filter(Boolean);
  if (scriptTokens.length === 0) return asrWords;

  const a = scriptTokens.map(norm);
  const b = asrWords.map((w) => norm(w?.text));

  // Bail out on absurdly large inputs rather than allocate a huge table.
  if ((a.length + 1) * (b.length + 1) > maxCells) return asrWords;

  const n = a.length;
  const m = b.length;

  // Longest-common-subsequence lengths (exact words).
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    const row = dp[i];
    const next = dp[i + 1];
    for (let j = m - 1; j >= 0; j--) {
      row[j] = a[i] && b[j] && a[i] === b[j] ? next[j + 1] + 1 : Math.max(next[j], row[j + 1]);
    }
  }

  // anchors: exact matches, in order.
  const anchors = [{ i: -1, j: -1 }];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] && b[j] && a[i] === b[j]) {
      anchors.push({ i, j });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  anchors.push({ i: n, j: m });

  // asr index -> script token index. Exact anchors first, then pair the
  // leftover words sitting between the same two anchors (mis-hears).
  const takeScript = new Map();
  for (const an of anchors) {
    if (an.j >= 0 && an.j < m) takeScript.set(an.j, an.i);
  }
  for (let k = 1; k < anchors.length; k++) {
    const prev = anchors[k - 1];
    const next = anchors[k];
    const scriptGap = [];
    for (let s = prev.i + 1; s < next.i; s++) scriptGap.push(s);
    const asrGap = [];
    for (let t = prev.j + 1; t < next.j; t++) asrGap.push(t);
    const pairs = Math.min(scriptGap.length, asrGap.length);
    for (let p = 0; p < pairs; p++) {
      // Only pair words that are plausibly the same word mis-heard; otherwise the
      // speaker went off-script and we keep what they actually said.
      if (similar(a[scriptGap[p]], b[asrGap[p]])) takeScript.set(asrGap[p], scriptGap[p]);
    }
  }

  const out = [];
  for (let k = 0; k < m; k++) {
    const w = asrWords[k];
    if (takeScript.has(k)) {
      out.push({ text: scriptTokens[takeScript.get(k)], start: w.start, end: w.end });
    } else {
      out.push({ text: w.text, start: w.start, end: w.end, spoken: true });
    }
  }

  // A script clause mark (`,` `;` `:`) that runs straight into words the script
  // does not have reads as a boundary the speaker never made — drop just that
  // mark so the splitter sees the spoken flow.
  for (let k = 0; k < out.length - 1; k++) {
    if (out[k + 1].spoken) out[k].text = out[k].text.replace(/[,;:]+$/, "");
  }

  return out;
}
