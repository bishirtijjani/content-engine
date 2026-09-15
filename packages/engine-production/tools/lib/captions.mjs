/**
 * captions.mjs — how a transcript becomes CAPTION SCENES.
 *
 * The rule that governs everything here: a caption is ONE CLAUSE — one thought a
 * viewer reads in a single glance. Word counts and character counts are only
 * tie-breakers; clause boundaries and meaning decide the cuts.
 *
 * Three failures this module exists to prevent (all shipped once, never again —
 * see captions.test.mjs, and validateCaptions() hard-fails the build):
 *   1. Splitting a compound term       ("AI" / "engineer")
 *   2. Two clauses in one caption      ("AI engineer, and I'm the")
 *   3. Ending on a dangling function word ("for businesses to")
 */

// Words that must never END a caption — they bind forward to the next clause.
export const FUNC_TAIL = new Set([
  "a", "an", "the", "my", "your", "their", "our", "its", "his", "her", "this", "that", "these", "those",
  "and", "or", "but", "so", "nor", "yet",
  "to", "of", "in", "on", "at", "for", "with", "from", "by", "into", "onto", "about", "as", "if",
  "is", "are", "was", "were", "am", "be", "been", "i", "i'm", "you're", "it's", "we", "they", "he", "she",
]);

// Words that bind BACKWARD — a short caption starting with one is an orphan fragment
// ("kind" | "of thing," -> rejoin). Kept deliberately minimal: a word we intentionally
// CUT BEFORE (for/to) must never appear here, or the repair undoes the clause split.
export const BINDERS = new Set(["of"]);

// Coordinating conjunctions start a new clause -> cut before them.
const CONJ = new Set(["and", "or", "but", "so"]);

// Deliberately conservative: only these prepositions reliably open a new phrase.
// ("of" binds tightly backward — "founder OF Bishir Tijjani" must never split.)
const PREP_BREAK = new Set(["for", "to"]);

export const norm = (t) => t.replace(/[^\w']/g, "").toLowerCase();
const endsSentence = (t) => /[.!?]["')\]]?$/.test(t);
const endsClause = (t) => /[,;:]["')\]]?$/.test(t);
const plainCount = (toks) => toks.filter((t) => !t.emph).length;
const plainText = (toks) => toks.filter((t) => !t.emph).map((t) => t.text).join(" ");

/**
 * Merge configured emphasis phrases into single atomic tokens, so a compound term
 * ("AI engineer") can never be split by grouping and is emphasized as ONE unit.
 */
export function mergeEmphasis(words, phrases = []) {
  const specs = [...phrases]
    .map((p) => ({ raw: p, words: p.trim().split(/\s+/).map(norm) }))
    .sort((a, b) => b.words.length - a.words.length); // longest match wins
  const out = [];
  let i = 0;
  outer: while (i < words.length) {
    for (const s of specs) {
      if (i + s.words.length > words.length) continue;
      let hit = true;
      for (let k = 0; k < s.words.length; k++) {
        if (norm(words[i + k].text) !== s.words[k]) { hit = false; break; }
      }
      if (hit) {
        const grp = words.slice(i, i + s.words.length);
        out.push({
          text: grp.map((w) => w.text).join(" "),
          start: grp[0].start,
          end: grp[grp.length - 1].end,
          emph: true,
        });
        i += s.words.length;
        continue outer;
      }
    }
    out.push({ text: words[i].text, start: words[i].start, end: words[i].end, emph: false });
    i++;
  }
  return out;
}

/** Cut the token stream into captions at clause boundaries. */
export function splitCaptions(tokens, o) {
  const caps = [];
  let cur = [];
  const flush = () => { if (cur.length) { caps.push(cur); cur = []; } };

  for (const t of tokens) {
    if (cur.length) {
      const prev = cur[cur.length - 1];
      const w = norm(t.text);
      const enough = cur.length >= 2; // never strand a 1-token fragment ("Hi,")
      // emphasis rides its own line, so it costs no plain-line budget
      const wouldPlain = plainCount(cur) + (t.emph ? 0 : 1);
      const wouldChars = plainText(cur).length + (t.emph ? 0 : t.text.length + 1);

      if (
        endsSentence(prev.text) ||
        t.start - prev.end > o.pauseGap ||
        (enough && (endsClause(prev.text) || CONJ.has(w) || PREP_BREAK.has(w))) ||
        (enough && (wouldPlain > o.maxWords || wouldChars > o.maxChars))
      ) flush();
    }
    cur.push(t);
  }
  flush();
  return caps;
}

/** Rule 3: a caption must not end on a function word — push it to the next caption. */
export function repairDanglingTail(caps) {
  for (let i = 0; i < caps.length - 1; i++) {
    let guard = 0;
    while (caps[i].length > 1 && guard++ < 4) {
      const last = caps[i][caps[i].length - 1];
      if (last.emph || endsSentence(last.text) || !FUNC_TAIL.has(norm(last.text))) break;
      caps[i + 1].unshift(caps[i].pop());
    }
  }
  return caps.filter((c) => c.length);
}

/** A short caption opening with a backward-binding word is a fragment — reattach it. */
export function repairLeadingOrphan(caps, o) {
  for (let i = caps.length - 1; i > 0; i--) {
    const c = caps[i];
    if (!c.length || c[0].emph) continue;
    const startsBinder = BINDERS.has(norm(c[0].text));
    const short = plainCount(c) <= 2;
    const prev = caps[i - 1];
    const prevEnded = prev.length && endsSentence(prev[prev.length - 1].text);
    if (startsBinder && short && !prevEnded && plainCount(prev) + plainCount(c) <= o.maxWords + 2) {
      caps[i - 1] = prev.concat(c);
      caps.splice(i, 1);
    }
  }
  return caps;
}

/** transcript words -> caption scenes (tokens per caption). */
export function groupCaptions(words, o) {
  const opts = { maxWords: 5, maxChars: 30, pauseGap: 0.7, emphasis: [], ...o };
  const toks = mergeEmphasis(words, opts.emphasis);
  let caps = splitCaptions(toks, opts);
  caps = repairDanglingTail(caps);
  caps = repairLeadingOrphan(caps, opts);
  return caps;
}

/**
 * The gate. Returns [] when every caption obeys the rules; otherwise a list of
 * violations. build-captions.mjs throws on any violation, so a caption that breaks
 * a clause or dangles a function word cannot reach a render.
 */
export function validateCaptions(caps, o = {}) {
  const maxWords = o.maxWords ?? 5;
  const hardMax = maxWords + 2;
  const problems = [];
  const show = (c) => c.map((t) => t.text).join(" ");

  caps.forEach((c, i) => {
    const last = c[c.length - 1];

    // 3 — dangling function word
    if (!last.emph && !endsSentence(last.text) && FUNC_TAIL.has(norm(last.text)) && i < caps.length - 1) {
      problems.push(`caption ${i + 1} ends on dangling "${last.text}" — it belongs to the next scene: "${show(c)}"`);
    }

    // 2 — more than one clause in a scene
    for (let k = 0; k < c.length - 1; k++) {
      const after = c.slice(k + 1);
      if (endsSentence(c[k].text) && after.length) {
        problems.push(`caption ${i + 1} packs two sentences: "${show(c)}"`);
        break;
      }
      if (endsClause(c[k].text) && after.length >= 2 && CONJ.has(norm(after[0].text))) {
        problems.push(`caption ${i + 1} spans a clause boundary at "${c[k].text} ${after[0].text}": "${show(c)}"`);
        break;
      }
    }

    // too long to read in one glance
    if (plainCount(c) > hardMax) {
      problems.push(`caption ${i + 1} is ${plainCount(c)} words (max ${hardMax}): "${show(c)}"`);
    }

    // emphasis stays scarce
    const emph = c.filter((t) => t.emph).length;
    if (emph > (o.maxEmphasisPerPhrase ?? 1)) {
      problems.push(`caption ${i + 1} has ${emph} emphasis units — emphasis must stay scarce: "${show(c)}"`);
    }
  });

  return problems;
}
