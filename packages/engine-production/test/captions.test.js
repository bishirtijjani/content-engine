/**
 * Regression tests for caption scene grouping.
 *
 * Every case below is a REAL failure that shipped in output/2026-07-17-intro and was
 * rejected on review. They are pinned here so they cannot come back.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupCaptions, validateCaptions, norm } from '../tools/lib/captions.mjs';

const EMPHASIS = ['AI automation', 'AI engineer', 'Example Brand'];
const OPTS = { emphasis: EMPHASIS, maxWords: 5, maxChars: 30, pauseGap: 0.7 };

/** words with tight, even timings so CLAUSES (not pauses) drive the grouping */
const mk = (s) => s.split(/\s+/).map((text, i) => ({ text, start: i * 0.4, end: i * 0.4 + 0.35 }));
const texts = (caps) => caps.map((c) => c.map((t) => t.text).join(' '));

const INTRO = "I'm a software developer and AI engineer, and I'm the founder of Example Brand.";
const BUILD = 'I build software tools and AI automation for businesses to help them run their operations smoothly.';

test("compound term 'AI engineer' is one atomic emphasis unit, never split", () => {
  const caps = groupCaptions(mk(INTRO), OPTS);
  const emph = caps.flat().filter((t) => t.emph);
  assert.ok(emph.some((t) => /^AI engineer/.test(t.text)), 'AI engineer must be a single emphasis token');
  assert.ok(!caps.flat().some((t) => norm(t.text) === 'ai'), '"AI" was split from its noun');
});

test("'AI automation' is one atomic emphasis unit, never split", () => {
  const caps = groupCaptions(mk(BUILD), OPTS);
  const emph = caps.flat().filter((t) => t.emph);
  assert.ok(emph.some((t) => /^AI automation/.test(t.text)), 'AI automation must be a single emphasis token');
});

test("a caption never spans a clause boundary — 'AI engineer, and I'm the' must not exist", () => {
  const caps = groupCaptions(mk(INTRO), OPTS);
  for (const c of texts(caps)) {
    assert.ok(!(/engineer/i.test(c) && /\bthe\b/i.test(c)), `two clauses in one caption: "${c}"`);
    assert.ok(!/,\s+and\b/i.test(c), `caption rides a second clause: "${c}"`);
  }
});

test("a caption never ends on a dangling function word — 'for businesses to'", () => {
  const caps = groupCaptions(mk(BUILD), OPTS);
  const out = texts(caps);
  assert.ok(!out.some((c) => /\bto$/i.test(c.trim())), `caption ends on "to": ${JSON.stringify(out)}`);
  assert.ok(out.includes('for businesses'), `expected "for businesses" as its own scene, got ${JSON.stringify(out)}`);
});

test("'founder of Example Brand' stays together — 'of' binds backward and must not break", () => {
  const caps = groupCaptions(mk(INTRO), OPTS);
  const withBishir = texts(caps).find((c) => /Bishir/.test(c));
  assert.match(withBishir, /founder of Example Brand/i, `"of" was split from its phrase: "${withBishir}"`);
});

test('both real sentences produce zero validator violations', () => {
  for (const src of [INTRO, BUILD]) {
    const problems = validateCaptions(groupCaptions(mk(src), OPTS), OPTS);
    assert.deepEqual(problems, [], `violations for "${src}":\n${problems.join('\n')}`);
  }
});

test('validator REJECTS the exact caption that shipped (the gate actually bites)', () => {
  const bad = [[
    { text: 'AI engineer,', start: 0, end: 1, emph: true },
    { text: 'and', start: 1, end: 1.2, emph: false },
    { text: "I'm", start: 1.2, end: 1.4, emph: false },
    { text: 'the', start: 1.4, end: 1.6, emph: false },
  ], [{ text: 'founder.', start: 2, end: 2.5, emph: false }]];
  const problems = validateCaptions(bad, OPTS);
  assert.ok(problems.length > 0, 'validator must reject a clause-spanning caption');
  assert.match(problems.join(' '), /clause boundary|dangling/i);
});

test('validator REJECTS a dangling tail', () => {
  const bad = [[
    { text: 'for', start: 0, end: 0.3, emph: false },
    { text: 'businesses', start: 0.3, end: 0.8, emph: false },
    { text: 'to', start: 0.8, end: 1.0, emph: false },
  ], [{ text: 'help.', start: 1, end: 1.5, emph: false }]];
  const problems = validateCaptions(bad, OPTS);
  assert.match(problems.join(' '), /dangling "to"/i);
});
