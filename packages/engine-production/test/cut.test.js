import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildCuts, splitUtterances, similarity, invertSpans, isSelfTalk } from '../tools/clean/lib/cut.mjs';

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
  const repeat = cuts.find((c) => c.reason.includes('repeat'));
  assert.ok(repeat, 'expected a repeat cut');
  assert.ok(repeat.start < 0.1 && repeat.end > 1.3 && repeat.end < 2.1);
});

test('cuts a short false start that the next take repeats', () => {
  const words = [
    w('so', 0, 0.2), w('I', 0.25, 0.4),
    w('so', 0.9, 1.1), w('I', 1.15, 1.3), w('built', 1.35, 1.6), w('this', 1.65, 1.9),
  ];
  const { cuts } = buildCuts({ words, span: { start: 0, end: 1.9 } });
  const retake = cuts.find((c) => c.reason.includes('false-start'));
  assert.ok(retake, 'expected a false-start cut');
  assert.ok(retake.start < 0.1);
});

test('removes a line said to himself', () => {
  const words = [
    w('hello', 0, 0.5), w('there', 0.6, 1.0),
    w('start', 1.5, 1.8), w('again', 1.85, 2.2),
    w('good', 2.7, 3.0), w('bye', 3.1, 3.4),
  ];
  const { cuts } = buildCuts({ words, span: { start: 0, end: 3.4 } });
  const aside = cuts.find((c) => c.reason.includes('self-talk'));
  assert.ok(aside, 'expected a self-talk cut');
  assert.ok(Math.abs(aside.start - 1.45) < 1e-6);
  assert.ok(Math.abs(aside.end - 2.25) < 1e-6);
});

test('keeps a line that merely contains a self-talk word inside a sentence', () => {
  const words = [
    w('okay', 0, 0.3), w('so', 0.35, 0.5), w('here', 0.55, 0.7),
    w('is', 0.75, 0.85), w('the', 0.9, 1.0), w('plan', 1.05, 1.3),
  ];
  const { cuts } = buildCuts({ words, span: { start: 0, end: 1.3 } });
  assert.equal(cuts.filter((c) => c.reason.includes('self-talk')).length, 0);
});

test('keeps the last try when a line is said three times', () => {
  const words = [
    w('we', 0, 0.2), w('ship', 0.25, 0.5), w('fast', 0.55, 0.8), w('today', 0.85, 1.1),
    w('we', 2.0, 2.2), w('ship', 2.25, 2.5), w('fast', 2.55, 2.8), w('today', 2.85, 3.1),
    w('we', 4.0, 4.2), w('ship', 4.25, 4.5), w('fast', 4.55, 4.8), w('today', 4.85, 5.1),
  ];
  const { cuts, keeps } = buildCuts({ words, span: { start: 0, end: 5.1 } });
  const repeat = cuts.filter((c) => c.reason.includes('repeat'));
  assert.equal(repeat.length, 1, 'expected one repeat cut');
  assert.ok(repeat[0].start < 0.1 && repeat[0].end > 3.5 && repeat[0].end < 4.1);
  assert.equal(keeps.length, 1);
});

test('sweeps an aside that sits between two tries of the same line', () => {
  const words = [
    w('lets', 0, 0.2), w('clean', 0.25, 0.5), w('this', 0.55, 0.75), w('up', 0.8, 1.0),
    w('oh', 1.6, 1.8), w('i', 1.85, 1.95), w('am', 2.0, 2.15), w('supposed', 2.2, 2.6),
    w('to', 2.65, 2.8), w('put', 2.85, 3.0), w('it', 3.05, 3.2), w('up', 3.25, 3.45),
    w('start', 3.9, 4.1), w('again', 4.15, 4.5),
    w('lets', 5.0, 5.2), w('clean', 5.25, 5.5), w('this', 5.55, 5.75), w('up', 5.8, 6.0),
  ];
  const { cuts, keeps } = buildCuts({ words, span: { start: 0, end: 6.0 } });
  const repeat = cuts.filter((c) => c.reason.includes('repeat'));
  assert.equal(repeat.length, 1, 'expected one repeat cut');
  assert.ok(repeat[0].start < 0.1 && repeat[0].end > 4.5 && repeat[0].end < 5.1);
  assert.equal(keeps.length, 1);
});

test('removes a countdown glued to the start of a line', () => {
  const words = [
    w('three', 0, 0.3), w('two', 0.35, 0.6), w('one', 0.65, 0.9),
    w('if', 0.95, 1.1), w('you', 1.15, 1.3), w('re', 1.35, 1.5), w('ready', 1.55, 1.8),
  ];
  const { cuts, keeps } = buildCuts({ words, span: { start: 0, end: 1.8 } });
  const st = cuts.find((c) => c.reason.includes('self-talk'));
  assert.ok(st, 'expected a self-talk cut for the countdown');
  assert.ok(st.start < 0.1 && st.end > 0.8 && st.end < 1.0);
  assert.ok(keeps.some((k) => k.start < 1 && k.end > 1.5), 'the line after the countdown is kept');
});

test('a short fragment just before a repeat joins its cut', () => {
  const words = [
    w('if', 0, 0.3),
    w('youre', 3.0, 3.2), w('looking', 3.25, 3.5), w('for', 3.55, 3.7), w('it', 3.75, 3.9),
    w('youre', 8.0, 8.2), w('looking', 8.25, 8.5), w('for', 8.55, 8.7), w('it', 8.75, 8.9),
  ];
  const { cuts, keeps } = buildCuts({ words, span: { start: 0, end: 8.9 } });
  const repeat = cuts.find((c) => c.reason.includes('repeat'));
  assert.ok(repeat, 'expected a repeat cut');
  assert.ok(repeat.start < 0.1, 'the orphan fragment is part of the cut');
  assert.equal(keeps.length, 1);
});

test('keeps the last try of a short line repeated from the top', () => {
  const words = [
    w('then', 0, 0.2), w("there's", 0.25, 0.5), w('finals', 0.6, 0.9),
    w('then', 7.8, 8.0), w("there's", 8.05, 8.3), w('finals', 8.4, 8.7),
    w('take', 8.9, 9.2), w('invoices', 9.3, 9.7), w('for', 9.8, 10.0),
    w('example', 10.1, 10.5), w('if', 10.6, 10.8), w('youre', 10.9, 11.1),
    w('ready', 11.2, 11.5),
  ];
  const { cuts } = buildCuts({ words, span: { start: 0, end: 11.5 } });
  const r = cuts.find((c) => c.reason.includes('repeat'));
  assert.ok(r, 'expected a repeat cut for the short line');
  assert.ok(r.start < 0.1 && r.end > 7 && r.end < 8.1);
});

test('removes an auphonic head tag', () => {
  const words = [
    w('free', 0, 0.4), w('audio', 0.4, 0.8), w('post', 0.8, 1.1), w('production', 1.1, 1.5),
    w('By', 2.0, 2.2), w('alphonic', 2.2, 2.7), w('.com', 2.7, 3.1),
    w('hello', 6, 6.5), w('world', 6.6, 7.0),
  ];
  const { cuts } = buildCuts({ words, span: { start: 0, end: 7 } });
  const tag = cuts.find((c) => c.reason.includes('tag'));
  assert.ok(tag, 'expected a tag cut');
  assert.ok(tag.start < 0.1 && tag.end > 3 && tag.end < 3.3);
});

test('leaves a tag alone when it is not at the head or tail', () => {
  const words = [
    w('hello', 0, 0.5), w('world', 0.6, 1.0),
    w('alphonic', 40, 40.5),
    w('more', 80, 80.5), w('words', 80.6, 81),
  ];
  const { cuts } = buildCuts({ words, span: { start: 0, end: 81 } });
  assert.equal(cuts.filter((c) => c.reason.includes('tag')).length, 0);
});

test('isSelfTalk matches whole words only', () => {
  assert.equal(isSelfTalk({ tokens: ['start', 'again'], text: 'start again' }), true);
  assert.equal(isSelfTalk({ tokens: ['restart'], text: 'restart' }), false);
  assert.equal(isSelfTalk({ tokens: ['okay'], text: 'okay' }), true);
  assert.equal(isSelfTalk({ tokens: ['okay', 'so', 'listen'], text: 'okay so listen' }), false);
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
