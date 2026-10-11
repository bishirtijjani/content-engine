// beats.mjs — narration → beats.
//
// A beat is ONE idea the speaker lands: a claim, a number, a step, a question,
// a payoff or a CTA. Beats are DERIVED from the spoken words (real timings),
// never hand-typed, so every visual can be locked to the exact words that carry
// it. This is the first link of the chain:
//
//   narration → beat → visual concept → composition → motion → render
//
// Segmentation is deterministic: a beat closes on sentence punctuation, on a
// spoken pause, or at a word cap. Kind and anchorWords are pure functions of the
// beat's words, so the same input always yields the same beats.
//
// Input is the script-aligned word stream (see script-captions.mjs), which
// carries real punctuation; raw ASR (no punctuation) still works — pauses alone
// then decide the boundaries.

const SENTENCE_END = /[.!?]["')\]\u201c\u201d\u2018\u2019]*$/;
// A number beat is decided by a real numeric token (a digit, currency or a
// percent). Spelled-out number words are deliberately NOT counted: "one task",
// "one more question" and "one after another" are not numbers, and treating them
// as such would mislabel ordinary claims.
const NUMBERISH = /(?:\d|\$|£|€|%)/;
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'for', 'is', 'are', 'was',
  'were', 'be', 'been', 'being', 'it', 'its', 'that', 'thats', 'this', 'with', 'as', 'by', 'we',
  'you', 'your', 'i', 'so', 'if', 'then', 'than', 'from', 'our', 'their', 'not', 'no', 'do',
  'does', 'did', 'has', 'have', 'had', 'will', 'would', 'can', 'could', 'should', 'about', 'into',
  'out', 'up', 'down', 'just', 'more', 'most', 'very', 'really', 'here', 'there', 'what', 'when',
  'where', 'how', 'why', 'who', 'them', 'they', 'he', 'she', 'his', 'her', 'him', 'me', 'my',
]);
const CTA_WORDS = new Set([
  'subscribe', 'follow', 'comment', 'share', 'book', 'link', 'click', 'download',
  'join', 'visit', 'dm', 'message', 'sign', 'register', 'grab', 'watch',
]);
const STEP_CUES = new Set([
  'first', 'then', 'next', 'finally', 'start', 'begin', 'write', 'list', 'pick', 'take', 'ask',
  'put', 'step', 'grab', 'open', 'add', 'do', 'now', 'lets', "let's",
]);
const PAYOFF_CUES = new Set([
  'thats', "that's", 'which', 'equals', 'roughly', 'worth', 'total', 'means', 'so', 'about',
]);

const MUSIC = /^[♪♫♬♩♧\s]+$/;

const cleanWord = (w) => String(w ?? '').trim();
const norm = (t) => String(t).replace(/[^\w'$%£€.,]/g, '').toLowerCase().replace(/^[.,]+|[.,]+$/g, '');

/** A token carries a number when it has a digit/currency/percent. */
function isNumberToken(text) {
  return NUMBERISH.test(cleanWord(text));
}

/** The idea kind of a beat, from its words. Precedence is fixed and documented. */
export function classifyBeat(tokens) {
  const words = tokens.map((t) => cleanWord(t.text));
  const text = words.join(' ');
  const lower = words.map((w) => norm(w));
  const first = lower[0] ?? '';
  const last = words[words.length - 1] ?? '';

  if (SENTENCE_END.test(last) && last.includes('?')) return 'question';
  if (lower.some((w) => CTA_WORDS.has(w))) return 'cta';
  if (words.some(isNumberToken)) return 'number';
  if (STEP_CUES.has(first)) return 'step';
  if (lower.some((w) => PAYOFF_CUES.has(w))) return 'payoff';
  return 'claim';
}

/**
 * The words a reveal is cued on. For a number beat, the numeric tokens; otherwise
 * the strongest content words (longest non-stopwords), kept in spoken order.
 */
export function pickAnchorWords(tokens, kind) {
  const words = tokens.map((t) => cleanWord(t.text));
  if (kind === 'number') {
    const nums = words.filter(isNumberToken);
    if (nums.length) return nums;
  }
  const candidates = [];
  words.forEach((w, i) => {
    const n = norm(w);
    if (n.length >= 4 && !STOPWORDS.has(n)) candidates.push({ w, i, len: n.length });
  });
  if (!candidates.length) {
    const last = words[words.length - 1];
    return last ? [last] : [];
  }
  const top = [...candidates].sort((a, b) => b.len - a.len).slice(0, 2).sort((a, b) => a.i - b.i);
  return top.map((c) => c.w);
}

/** Drop empty/music tokens and keep only well-formed, ordered words. */
function cleanWords(words) {
  if (!Array.isArray(words)) return [];
  return words
    .map((w) => ({ text: cleanWord(w?.text), start: Number(w?.start), end: Number(w?.end) }))
    .filter((w) => w.text && !MUSIC.test(w.text) && Number.isFinite(w.start) && Number.isFinite(w.end));
}

function makeBeat(tokens, index) {
  const kind = classifyBeat(tokens);
  const start = tokens[0].start;
  const end = tokens[tokens.length - 1].end;
  return {
    id: `b${index + 1}`,
    start,
    end,
    kind,
    text: tokens.map((t) => cleanWord(t.text)).join(' '),
    anchorWords: pickAnchorWords(tokens, kind),
    words: tokens.map((t) => ({ ...t })),
  };
}

/**
 * Derive beats from a word stream.
 *
 * @param {Array<{text:string,start:number,end:number}>} words
 * @param {Object} [opts]
 * @param {number} [opts.maxWords=16] - close a beat at this many words
 * @param {number} [opts.gap=0.45] - close a beat on a pause this long (s)
 * @param {number} [opts.minSeconds=0.6] - merge a fragment this short into its neighbour
 * @returns {Array<{id,start,end,kind,text,anchorWords,words}>}
 */
export function deriveBeats(words, { maxWords = 16, gap = 0.45, minSeconds = 0.6 } = {}) {
  const w = cleanWords(words);
  const raw = [];
  let cur = [];
  const close = () => {
    if (cur.length) {
      raw.push(cur);
      cur = [];
    }
  };
  for (let i = 0; i < w.length; i++) {
    cur.push(w[i]);
    const next = w[i + 1];
    const endsSentence = SENTENCE_END.test(w[i].text);
    const bigGap = !next || next.start - w[i].end >= gap;
    const tooLong = cur.length >= maxWords;
    if (endsSentence || bigGap || tooLong) close();
  }
  close();

  // A fragment too short to hold on screen is not its own beat: ASR gaps and
  // mid-sentence pauses would otherwise leave a 0.2s "day." with nowhere to go.
  // Merge it into the previous beat; a short FIRST beat merges forward instead.
  const span = (t) => t[t.length - 1].end - t[0].start;
  const merged = [];
  for (const tokens of raw) {
    const last = merged[merged.length - 1];
    if (span(tokens) < minSeconds && last) last.push(...tokens);
    else merged.push(tokens);
  }
  if (merged.length > 1 && span(merged[0]) < minSeconds) {
    const [head, ...rest] = merged;
    rest[0].unshift(...head);
    merged.length = 0;
    merged.push(...rest);
  }

  return merged.map((tokens, i) => makeBeat(tokens, i));
}
