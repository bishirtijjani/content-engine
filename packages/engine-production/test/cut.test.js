import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildCuts, splitUtterances, similarity, invertSpans } from '../tools/clean/lib/cut.mjs';

const w = (text, start, end) => ({ text, start, end });

test('trims a long pause to gapKeep', () => {
  const words = [w('hello', 0, 1), w('world', 3, 4)];
  const { cuts, keeps } = buildCuts({ words, span: { start: 0, end: 4 } });
  assert.equal(cuts.length, 1);
  assert.equal(cuts[0].reason, 'pause');
  assert.ok(Math.abs(cuts[0].start - 1.3) < 1e-6);
  assert.ok(Math.abs(cuts[0].end - 2.98) < 1e-6);
  assert.equal(keeps.length, 2);
});

test('removes a filler word with padding', () => {
  const words = [w('hello', 0, 0.5), w('um', 0.6, 0.9), w('world', 1.0, 1.5)];
  const { cuts } = buildCuts({ words, span: { start: 0, end: 1.5 } });
  const filler = cuts.find((c) => c.reason === 'filler');
  assert.ok(filler, 'expected a filler cut');
  assert.ok(Math.abs(filler.start - 0.55) < 1e-6);
  assert.ok(Math.abs(filler.end - 0.95) < 1e-6);
});

test('cuts the earlier of two repeated takes', () => {
  const words = [
    w('so', 0, 0.2), w('the', 0.25, 0.4), w('way', 0.45, 0.65),
    w('this', 0.7, 0.9), w('works', 0.95, 1.2), w('is', 1.25, 1.4),
    w('so', 2.0, 2.2), w('the', 2.25, 2.4), w('way', 2.45, 2.65),
    w('this', 2.7, 2.9), w('works', 2.95, 3.2), w('is', 3.25, 3.4),
  ];
  const { cuts } = buildCuts({ words, span: { start: 0, end: 3.4 } });
  const retake = cuts.find((c) => c.reason.includes('retake'));
  assert.ok(retake, 'expected a retake cut');
  assert.ok(retake.start < 0.1 && retake.end > 1.3 && retake.end < 2.1);
});

test('cuts a short false start that the next take repeats', () => {
  const words = [
    w('so', 0, 0.2), w('I', 0.25, 0.4),
    w('so', 0.9, 1.1), w('I', 1.15, 1.3), w('built', 1.35, 1.6), w('this', 1.65, 1.9),
  ];
  const { cuts } = buildCuts({ words, span: { start: 0, end: 1.9 } });
  const retake = cuts.find((c) => c.reason.includes('retake'));
  assert.ok(retake, 'expected a false-start retake cut');
  assert.ok(retake.start < 0.1);
});

test('trims dead air at the start and end', () => {
  const words = [w('hi', 5, 5.5)];
  const { cuts } = buildCuts({ words, span: { start: 0, end: 10 } });
  const reasons = cuts.map((c) => c.reason).sort();
  assert.deepEqual(reasons, ['lead', 'tail']);
});

test('absorbs a tiny internal keep into the cut', () => {
  const words = [
    w('lead', 0, 0.5), w('um', 0.55, 0.7), w('mid', 0.75, 0.95),
    w('uh', 1.0, 1.15), w('end', 1.2, 1.8),
  ];
  const { cuts, keeps } = buildCuts({ words, span: { start: 0, end: 2 } });
  assert.equal(cuts.length, 1);
  assert.ok(cuts[0].start < 0.55 && cuts[0].end > 1.15);
  assert.equal(keeps.length, 2);
});

test('snaps cut points to the frame grid', () => {
  const fps = 30;
  const words = [w('hello', 0, 1.013), w('world', 3.017, 4)];
  const { cuts } = buildCuts({ words, span: { start: 0, end: 4 }, config: { frameFps: fps } });
  for (const c of cuts) {
    for (const t of [c.start, c.end]) {
      const frames = t * fps;
      assert.ok(Math.abs(frames - Math.round(frames)) < 1e-9, `${t} not on the frame grid`);
    }
  }
});

test('splitUtterances groups words by gap', () => {
  const words = [w('a', 0, 1), w('b', 1.1, 2), w('c', 5, 6)];
  const utts = splitUtterances(words, 0.35);
  assert.equal(utts.length, 2);
  assert.deepEqual(utts[0].tokens, ['a', 'b']);
});

test('similarity is 1 for identical takes and 0 for unrelated', () => {
  assert.equal(similarity(['a', 'b', 'c'], ['a', 'b', 'c']), 1);
  assert.equal(similarity(['a', 'b'], ['x', 'y']), 0);
});

test('invertSpans returns the complement', () => {
  const keeps = invertSpans([{ start: 1, end: 2 }, { start: 3, end: 4 }], 0, 5);
  assert.deepEqual(keeps, [{ start: 0, end: 1 }, { start: 2, end: 3 }, { start: 4, end: 5 }]);
});

test('uses measured silence for pauses and ignores transcript gaps', () => {
  // A long gap in the words, but the audio says it is NOT silent there (0.3..3
  // is speech the model missed). No pause must be cut.
  const words = [w('hello', 0, 0.3), w('world', 3.0, 3.4)];
  const missed = buildCuts({ words, span: { start: 0, end: 3.4 }, silences: [] });
  assert.equal(missed.cuts.filter((c) => c.reason.includes('pause')).length, 0);

  // Now the audio says 1.0..3.0 is silent -> that pause is cut.
  const heard = buildCuts({
    words, span: { start: 0, end: 3.4 },
    silences: [{ start: 1.0, end: 3.0 }],
  });
  const pause = heard.cuts.find((c) => c.reason.includes('pause'));
  assert.ok(pause, 'expected a pause cut from measured silence');
  assert.ok(Math.abs(pause.start - 1.3) < 1e-6);
  assert.ok(Math.abs(pause.end - 2.7) < 1e-6);
});

test('never cuts a silence span that overlaps a word', () => {
  const words = [w('hello', 1.2, 1.6)];
  const { cuts } = buildCuts({
    words, span: { start: 0, end: 3 },
    silences: [{ start: 0.5, end: 2.5 }],
  });
  assert.equal(cuts.filter((c) => c.reason.includes('pause')).length, 0);
});
