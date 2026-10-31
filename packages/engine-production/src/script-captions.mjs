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

  // Walk the anchored regions. Between two anchors the SCRIPT is the source of
  // truth: emit its words so a badly mis-heard word ("10 credit cards" for
  // "take records") can never survive in the captions. When the gap counts
  // match, each script word takes the spoken word's timing; otherwise the
  // script words are laid evenly across the spoken span. Words the speaker
  // added where the script has nothing (a real aside) are kept as spoken.
  const out = [];
  const emitGap = (scriptGap, asrGap, prev, next) => {
    if (!scriptGap.length) {
      for (const t of asrGap) {
        out.push({ text: asrWords[t].text, start: asrWords[t].start, end: asrWords[t].end, spoken: true });
      }
      return;
    }
    if (asrGap.length === scriptGap.length) {
      scriptGap.forEach((s, idx) => {
        out.push({ text: scriptTokens[s], start: asrWords[asrGap[idx]].start, end: asrWords[asrGap[idx]].end });
      });
      return;
    }
    const t0 = asrGap.length ? asrWords[asrGap[0]].start : (prev.j >= 0 ? asrWords[prev.j].end : 0);
    const t1 = asrGap.length
      ? asrWords[asrGap[asrGap.length - 1]].end
      : (next.j < m ? asrWords[next.j].start : t0 + 0.3 * scriptGap.length);
    const span = Math.max(0.1, t1 - t0);
    const each = span / scriptGap.length;
    scriptGap.forEach((s, idx) => {
      out.push({ text: scriptTokens[s], start: t0 + idx * each, end: t0 + (idx + 1) * each });
    });
  };

  for (let k = 1; k < anchors.length; k++) {
    const prev = anchors[k - 1];
    const next = anchors[k];
    const scriptGap = [];
    for (let s = prev.i + 1; s < next.i; s++) scriptGap.push(s);
    const asrGap = [];
    for (let t = prev.j + 1; t < next.j; t++) asrGap.push(t);
    emitGap(scriptGap, asrGap, prev, next);
    // the exact-match anchor word itself keeps its spoken timing
    if (next.j >= 0 && next.j < m && next.i >= 0 && next.i < n) {
      out.push({ text: scriptTokens[next.i], start: asrWords[next.j].start, end: asrWords[next.j].end });
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
