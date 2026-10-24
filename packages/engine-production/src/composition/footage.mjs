// composition/footage.mjs — derive the visual timeline (footage + snapshots).
//
// Footage is a FIRST-CLASS visual segment, the same rank as a snapshot. Given a
// plan (snapshots + beats) and the narration words, this works out exactly when
// each snapshot actually has content on screen, and makes every remaining stretch
// a FOOTAGE segment (the face) — snapped to the narration words, so the face and
// the b-roll interlock perfectly.
//
//   - A snapshot is "live" from its first BODY element's word (the kicker always
//     rides the first body element) to its last content word.
//   - Everything else — a snapshot's lead-in, the gaps between snapshots, the
//     hook, the tail — is footage.
//   - A gap shorter than `minGapSeconds` is not worth a cut: the previous scene
//     holds across it (b-roll stays seamless; no face flash).
//   - A snapshot on screen shorter than `minSnapshotSeconds` is extended (the
//     completed composition holds a beat longer) so a b-roll never flashes.
//
// The engine derives this; the model never has to place footage by hand (though
// an authored footage segment is kept as a fixed block). The emitted plan shows
// every footage segment, with the narration lines that play over it.
import { normalizeSnapshotPlan, targetList } from './snapshot-spec.mjs';
import { cueFor, slotValue, resolveCueTime } from './sync.mjs';

const r3 = (n) => Math.round(n * 1000) / 1000;

/** When a snapshot's content is actually on screen. */
function liveWindow(seg, words) {
  let liveStart = Infinity;
  let liveEnd = -Infinity;
  for (const b of seg.beats) {
    liveEnd = Math.max(liveEnd, b.end);
    for (const slot of targetList(b.action?.target)) {
      if (slot === 'head') continue; // the kicker never holds the screen alone
      const cue = cueFor(b, slot) ?? slotValue(seg, slot);
      let t = null;
      if (words && cue) t = resolveCueTime(cue, words, { min: seg.start, max: seg.end });
      if (t == null) t = b.start;
      liveStart = Math.min(liveStart, t);
    }
  }
  if (!Number.isFinite(liveStart)) liveStart = seg.start;
  if (!Number.isFinite(liveEnd)) liveEnd = seg.end;
  const start = Math.max(seg.start, Math.min(liveStart, seg.end));
  const end = Math.max(start, Math.min(liveEnd, seg.end));
  return { start: r3(start), end: r3(end) };
}

/**
 * Derive the final segment list: ordered footage + snapshot segments that cover
 * the whole video, word-timed.
 * @returns {object} a plan with `segments` set to the derived timeline
 */
export function deriveSegments(plan, { words = null, narrationBeats = [], minGapSeconds = 3.0, minSnapshotSeconds = 2.0 } = {}) {
  const norm = normalizeSnapshotPlan(plan);
  const dur = r3(plan?.video?.duration ?? (norm.segments.length ? norm.segments[norm.segments.length - 1].end : 60));

  // Each authored segment becomes a fixed visual block; a snapshot block is
  // trimmed to its live window. A clip is exact — its length is the source
  // footage it plays, so it is never stretched to fill a gap.
  const blocks = norm.segments.map((seg) => {
    if (seg.kind === 'footage') return { kind: 'footage', start: seg.start, end: seg.end, src: seg };
    if (seg.kind === 'clip') return { kind: 'clip', start: seg.start, end: seg.end, src: seg };
    return { kind: 'snapshot', ...liveWindow(seg, words), src: seg };
  }).sort((a, b) => a.start - b.start);

  // A gap below the threshold is not a cut: hold the previous block across it.
  // A clip cannot be held (its source runs out), so a clip on either side of the
  // gap keeps the real gap and the footage between it.
  const merged = [];
  for (const b of blocks) {
    const last = merged[merged.length - 1];
    if (last && last.kind !== 'clip' && b.kind !== 'clip'
      && b.start - last.end < minGapSeconds && b.start >= last.end) last.end = b.start;
    merged.push(b);
  }

  // Lead-in and tail: hold the first/last block across a tiny gap, else footage.
  // Never hold a clip — its on-screen length equals the source it plays.
  if (merged.length && merged[0].kind !== 'clip' && merged[0].start > 0 && merged[0].start < minGapSeconds) merged[0].start = 0;
  if (merged.length && merged[merged.length - 1].kind !== 'clip'
    && dur - merged[merged.length - 1].end < minGapSeconds) merged[merged.length - 1].end = dur;

  const out = [];
  let footageN = 0;
  const usedIds = new Set(norm.segments.map((s) => s.id));
  const pushFootage = (start, end) => {
    if (end - start <= 0.001) return;
    let id = `footage-${++footageN}`;
    while (usedIds.has(id)) id = `${id}x`;
    usedIds.add(id);
    out.push({ id, kind: 'footage', start: r3(start), end: r3(end), transitionOut: { technique: 'crossfade' }, lines: [] });
  };

  if (merged.length && merged[0].start > 0) pushFootage(0, merged[0].start);
  merged.forEach((b, i) => {
    out.push({ ...b.src, start: r3(b.start), end: r3(b.end) });
    const next = merged[i + 1];
    if (!next) return;
    // A clip cannot cover a gap, so any real gap beside it becomes footage. Two
    // snapshots still use the threshold, so the face never flashes between them.
    const gap = next.start - b.end;
    const clipEdge = b.kind === 'clip' || next.kind === 'clip';
    if (clipEdge ? gap > 0.001 : gap >= minGapSeconds) pushFootage(b.end, next.start);
  });
  if (merged.length && dur - merged[merged.length - 1].end > 0.001
    && merged[merged.length - 1].kind === 'clip') {
    pushFootage(merged[merged.length - 1].end, dur);
  } else if (merged.length && dur - merged[merged.length - 1].end >= minGapSeconds) {
    pushFootage(merged[merged.length - 1].end, dur);
  }

  // A snapshot must be on screen long enough to read: extend any shorter one by
  // borrowing the time from what follows (a long next b-roll, or the face), so a
  // composition never appears as a sub-second flash between two other visuals.
  // Never borrow from a clip: its length is the source it plays.
  if (minSnapshotSeconds > 0) {
    let i = 0;
    while (i < out.length) {
      const seg = out[i];
      if (seg.kind !== 'snapshot') { i++; continue; }
      let need = minSnapshotSeconds - (seg.end - seg.start);
      let probe = i;
      while (need > 0.001 && probe + 1 < out.length) {
        const next = out[probe + 1];
        if (next.kind === 'clip') break;
        const avail = next.end - next.start;
        const take = Math.min(need, avail);
        seg.end = r3(seg.end + take);
        need -= take;
        if (take >= avail - 0.001) out.splice(probe + 1, 1); // fully absorbed; next is at probe+1
        else { next.start = r3(next.start + take); probe++; }
      }
      i++;
    }
  }

  // Each segment owns the narration spoken over it (for the table).
  for (const seg of out) {
    if (seg.kind !== 'footage' && seg.kind !== 'clip') continue;
    seg.lines = narrationBeats
      .filter((n) => n.end > seg.start + 0.05 && n.start < seg.end - 0.05) // overlaps the window
      .map((n) => ({ start: r3(n.start), end: r3(n.end), text: n.text }));
  }

  return { ...plan, segments: out };
}
