// composition/sync.mjs — land a beat's reveal on the exact narration word.
//
// A beat names the slot(s) it acts on; this resolves the moment each slot should
// appear, from the actual word timings:
//   1. an explicit `action.cue` (a phrase, or a {slot: phrase} map) wins;
//   2. otherwise a numeric slot (a figure) is cued on the number it shows — so
//      "200" reveals when "200" is said, not at the sentence start;
//   3. otherwise it falls back to the beat's own start.
// Numbers match across the transcript's tokens (e.g. "$2" + ",500" → 2,500; a
// decimal matches its integer part, e.g. 3.3 → "3").
const lower = (s) => String(s ?? '').toLowerCase();

/** The digit sequence a phrase should match (a decimal matches its integer part). */
function digitTarget(phrase) {
  const s = String(phrase ?? '');
  const dec = s.match(/(\d[\d,]*)\.\d+/);
  if (dec) return dec[1].replace(/[^0-9]/g, '');
  return s.replace(/[^0-9]/g, '');
}

/**
 * The time (s) the phrase is first spoken in `words`, inside [min,max], or null.
 * @param {string} phrase
 * @param {Array<{text:string,start:number,end:number}>} words
 * @param {{min?:number,max?:number}} [opts]
 */
export function resolveCueTime(phrase, words, { min = -Infinity, max = Infinity } = {}) {
  if (!phrase || !Array.isArray(words) || !words.length) return null;
  const inWin = (t) => t >= min - 0.01 && t <= max + 0.01;

  const target = digitTarget(phrase);
  if (target) {
    for (let i = 0; i < words.length; i++) {
      if (!inWin(words[i].start)) continue;
      if (!/\d/.test(words[i].text)) continue; // a number starts on a digit word
      let acc = '';
      for (let j = i; j < words.length && j < i + 4; j++) {
        acc += String(words[j].text).replace(/[^0-9]/g, '');
        if (acc === target) return words[i].start;
        if (acc.length >= target.length) break;
      }
    }
  }

  const ptoks = lower(phrase).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  if (ptoks.length) {
    const wtoks = words.map((w) => lower(w.text).replace(/[^a-z0-9]/g, ''));
    for (let i = 0; i < words.length; i++) {
      if (!inWin(words[i].start)) continue;
      let ok = true;
      for (let k = 0; k < ptoks.length; k++) {
        if (wtoks[i + k] !== ptoks[k]) { ok = false; break; }
      }
      if (ok) return words[i].start;
    }
  }
  return null;
}

/** The numeric value a slot shows, for concepts whose slots are figures. */
export function slotValue(segment, slot) {
  const c = segment?.composition ?? {};
  if (segment?.concept === 'equation') {
    const m = /^term-(\d+)$/.exec(slot);
    if (m) return c.terms?.[Number(m[1])]?.value ?? null;
    if (slot === 'result') return c.result?.value ?? null;
    if (slot === 'note') return c.note?.value ?? null;
  }
  if (segment?.concept === 'bars') {
    const m = /^bar-(\d+)$/.exec(slot);
    if (m) return c.bars?.[Number(m[1])]?.value ?? null;
  }
  return null;
}

/** The explicit cue phrase for a slot, from `action.cue` (string or map). */
export function cueFor(beat, slot) {
  const cue = beat?.action?.cue;
  if (typeof cue === 'string') return cue;
  if (cue && typeof cue === 'object') return cue[slot] ?? null;
  return null;
}
