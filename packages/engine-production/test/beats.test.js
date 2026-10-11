// Beats — narration → beats, the first link of the chain.
import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveBeats, classifyBeat, pickAnchorWords } from '../src/beats.mjs';

const W = (text, start, end) => ({ text, start, end });

test('deriveBeats closes on sentence punctuation', () => {
  const beats = deriveBeats([
    W('That', 0, 0.3), W('happens', 0.3, 0.6), W('40', 0.6, 0.9), W('times', 0.9, 1.2),
    W('a', 1.2, 1.3), W('day.', 1.3, 1.6),
    W('Then', 1.7, 1.9), W('ask', 1.9, 2.1), W('one', 2.1, 2.3), W('more', 2.3, 2.5),
    W('question.', 2.5, 2.9),
  ]);
  assert.equal(beats.length, 2);
  assert.equal(beats[0].id, 'b1');
  assert.equal(beats[0].text, 'That happens 40 times a day.');
  assert.equal(beats[0].start, 0);
  assert.equal(beats[0].end, 1.6);
  assert.equal(beats[1].text, 'Then ask one more question.');
});

test('classifyBeat: "like" and "save" are not CTA cues', () => {
  assert.equal(classifyBeat([W('Take', 0, 0.3), W('something', 0.3, 0.6), W('like', 0.6, 0.8), W('answering', 0.8, 1.1), W('customer', 1.1, 1.4), W('questions.', 1.4, 1.8)]), 'step');
});

test('deriveBeats closes on a spoken pause when there is no punctuation', () => {
  const beats = deriveBeats([
    W('first', 0, 0.3), W('pick', 0.3, 0.6), W('a', 0.6, 0.7), W('function', 0.7, 1.1),
    W('then', 2.0, 2.2), W('cost', 2.2, 2.5), W('it', 2.5, 2.7),
  ]);
  assert.equal(beats.length, 2);
  assert.equal(beats[0].text, 'first pick a function');
  assert.equal(beats[1].text, 'then cost it');
});

test('deriveBeats drops music tokens and empty words', () => {
  const beats = deriveBeats([W('♪', 0, 1), W('', 1, 1.1), W('hello.', 1.1, 1.5)]);
  assert.equal(beats.length, 1);
  assert.equal(beats[0].text, 'hello.');
});

test('classifyBeat: question wins, then cta, then number', () => {
  assert.equal(classifyBeat([W('Could', 0, 0.3), W('this', 0.3, 0.5), W('be', 0.5, 0.7), W('automated?', 0.7, 1.1)]), 'question');
  assert.equal(classifyBeat([W('Subscribe', 0, 0.3), W('now.', 0.3, 0.6)]), 'cta');
  assert.equal(classifyBeat([W('That', 0, 0.3), W('costs', 0.3, 0.6), W('$25', 0.6, 0.9), W('an', 0.9, 1.0), W('hour.', 1.0, 1.3)]), 'number');
});

test('classifyBeat: step cue, payoff cue, else claim', () => {
  assert.equal(classifyBeat([W('Write', 0, 0.3), W('down', 0.3, 0.6), W('the', 0.6, 0.7), W('task.', 0.7, 1.0)]), 'step');
  assert.equal(classifyBeat([W('And', 0, 0.2), W("that's", 0.2, 0.5), W('just', 0.5, 0.7), W('one', 0.7, 0.9), W('task.', 0.9, 1.2)]), 'payoff');
  assert.equal(classifyBeat([W('The', 0, 0.2), W('numbers', 0.2, 0.6), W('will', 0.6, 0.8), W('tell', 0.8, 1.0), W('you', 1.0, 1.1), W('where', 1.1, 1.4), W('to', 1.4, 1.5), W('look.', 1.5, 1.9)]), 'claim');
});

test('pickAnchorWords: numbers for a number beat', () => {
  const anchors = pickAnchorWords([W('That', 0, 0.3), W('is', 0.3, 0.5), W('40', 0.5, 0.8), W('times', 0.8, 1.1), W('5,', 1.1, 1.3)], 'number');
  assert.deepEqual(anchors, ['40', '5,']);
});

test('pickAnchorWords: strongest content words otherwise', () => {
  const anchors = pickAnchorWords([W('Could', 0, 0.3), W('this', 0.3, 0.5), W('be', 0.5, 0.7), W('automated?', 0.7, 1.1)], 'question');
  assert.deepEqual(anchors, ['automated?']);
});

test('deriveBeats merges a sub-0.6s fragment into its neighbour', () => {
  const beats = deriveBeats([
    W('happens', 0, 0.5), W('40', 0.5, 0.8), W('times', 0.8, 1.1), W('a', 1.1, 1.2), W('day,', 1.2, 1.5),
    W('day.', 2.5, 2.7),
  ]);
  assert.equal(beats.length, 1);
  assert.equal(beats[0].text, 'happens 40 times a day, day.');
});

test('deriveBeats merges a short FIRST beat forward', () => {
  const beats = deriveBeats([
    W('Hi.', 0, 0.3),
    W('Now', 1.0, 1.2), W('do', 1.2, 1.4), W('this', 1.4, 1.6), W('thing.', 1.6, 1.9),
  ]);
  assert.equal(beats.length, 1);
  assert.ok(beats[0].text.startsWith('Hi.'));
});

test('deriveBeats: a real math sentence becomes a number beat anchored on its figures', () => {
  const beats = deriveBeats([
    W('That\'s', 0, 0.3), W('40', 0.3, 0.5), W('times', 0.5, 0.7), W('5,', 0.7, 0.9),
    W('which', 0.9, 1.1), W('is', 1.1, 1.2), W('200', 1.2, 1.5), W('minutes', 1.5, 1.8),
    W('a', 1.8, 1.9), W('day.', 1.9, 2.2),
  ]);
  assert.equal(beats.length, 1);
  assert.equal(beats[0].kind, 'number');
  assert.ok(beats[0].anchorWords.includes('40'));
  assert.ok(beats[0].anchorWords.includes('200'));
});
