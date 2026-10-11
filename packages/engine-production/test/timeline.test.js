// composition/timeline.mjs + motion.mjs — the runtime composition from a plan.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadStyle } from '../src/style.mjs';
import { buildSnapshotComposition } from '../src/composition/timeline.mjs';
import { beatLines, motionCfg } from '../src/composition/motion.mjs';
import { resolveCueTime } from '../src/composition/sync.mjs';
import { deriveSegments } from '../src/composition/footage.mjs';

const STYLE = loadStyle();

const PLAN = {
  video: { id: 'v', duration: 20, orientation: 'portrait' },
  segments: [
    { id: 'f1', kind: 'footage', section: 'Hook', start: 0, end: 1, transitionOut: { technique: 'crossfade' } },
    {
      id: 's1', kind: 'snapshot', section: 'The math', concept: 'equation', frame: 'full', start: 1, end: 10,
      transitionOut: { technique: 'crossfade' },
      composition: {
        kicker: 'The math',
        terms: [{ value: '40', label: 'a day' }],
        result: { value: '200', unit: 'min', label: 'a day' },
      },
      beats: [
        { id: 'b1', start: 1, end: 4, spoken: 'forty', action: { op: 'introduce', target: ['head', 'term-0'] }, element: 'term' },
        { id: 'b2', start: 5, end: 9, spoken: 'two hundred', action: { op: 'reveal', target: ['result'] }, element: 'result' },
      ],
    },
    {
      id: 's2', kind: 'snapshot', section: 'CTA', concept: 'cta', frame: 'full', start: 10, end: 20,
      composition: { kicker: 'Start', text: 'Do the math.', handle: '@iambishir' },
      beats: [{ id: 'b3', start: 10, end: 19, spoken: 'do it', action: { op: 'introduce', target: ['head', 'text', 'handle'] }, element: 'cta' }],
    },
  ],
};

const WORDS = [
  { text: 'the', start: 1.0, end: 1.1 },
  { text: '40', start: 1.2, end: 1.5 },
  { text: 'then', start: 5.0, end: 5.2 },
  { text: '200', start: 5.8, end: 6.1 },
];
const build = (plan = PLAN, words = WORDS) => buildSnapshotComposition({
  plan, words, videoSrc: 'source.mp4',
  width: 1080, height: 1920, duration: 20, style: STYLE, orientation: 'portrait',
});

test('the runtime composition has a root, scenes, and a master timeline', () => {
  const { html, scenes, beats } = build();
  assert.equal(scenes, 2);
  assert.equal(beats, 3);
  assert.ok(html.includes('data-composition-id="main"'));
  assert.ok(html.includes('id="sc-s1"') && html.includes('id="sc-s2"'));
  assert.ok(html.includes('window.__timelines["main"] = tl'));
  assert.ok(html.includes('id="a-roll"') && html.includes('id="a-roll-audio"'));
});

test('a footage segment has no scene — the face shows', () => {
  const { html } = build();
  assert.ok(!html.includes('id="sc-f1"'), 'no scene element for footage');
});

test('a figure reveals on the exact narration word', () => {
  const { html } = build();
  assert.ok(html.includes(`tl.to("#sc-s1 [data-slot='term-0']", {opacity:1, y:0, duration:0.5, ease:"power2.out"}, 1.2)`));
  assert.ok(html.includes(`tl.to("#sc-s1 [data-slot='result']", {opacity:1, y:0, duration:0.5, ease:"power2.out"}, 5.8)`));
});

test('an explicit cue phrase resolves to its word inside its own beat', () => {
  const plan = structuredClone(PLAN);
  plan.segments[1].beats[0].action.cue = { head: 'then' };
  const words = [
    { text: 'the', start: 1.0, end: 1.1 },
    { text: '40', start: 1.2, end: 1.5 },
    { text: 'then', start: 3.0, end: 3.2 },
    { text: '200', start: 5.8, end: 6.1 },
  ];
  const { html } = build(plan, words);
  assert.ok(html.includes(`tl.to("#sc-s1 [data-slot='head']", {opacity:1, y:0, duration:0.5, ease:"power2.out"}, 3)`));
});

test('a cue spoken in another beat does not pull the reveal out of its beat', () => {
  const segment = structuredClone(PLAN.segments[1]);
  segment.beats[0].action.cue = { head: 'then' }; // 'then' lives in b2 (5.0s), not b1 [1–4]
  const { lines } = beatLines(segment.beats[0], { sceneSel: '#sc-s1', style: STYLE, segment, words: WORDS });
  const headReveal = lines.find((l) => l.includes("[data-slot='head']") && /, 1\);/.test(l));
  assert.ok(headReveal, 'head falls back to its beat start (1), not the far-away word');
  assert.ok(!lines.some((l) => /, 5\);/.test(l)), 'nothing drifts onto b2');
});

test('resolveCueTime handles numbers, split currency and phrases', () => {
  const words = [
    { text: 'the', start: 0, end: 0.2 }, { text: 'answer', start: 0.3, end: 0.6 },
    { text: '200', start: 0.9, end: 1.2 }, { text: '$2', start: 1.5, end: 1.6 }, { text: ',500', start: 1.6, end: 1.9 },
  ];
  assert.equal(resolveCueTime('200', words), 0.9);
  assert.equal(resolveCueTime('2,500', words), 1.5);
  assert.equal(resolveCueTime('answer', words), 0.3);
  assert.equal(resolveCueTime('999', words), null);
});

const snap = (id, start, end, beatEnd) => ({
  id, kind: 'snapshot', concept: 'cta', start, end,
  composition: { kicker: id, text: id, handle: '@x' },
  beats: [{ id: `${id}b`, start, end: beatEnd, spoken: id, action: { op: 'introduce', target: ['head', 'text', 'handle'] } }],
});

test('a declared footage segment between two snapshots is kept (the face shows)', () => {
  const plan = {
    video: { duration: 30 },
    segments: [snap('a', 1, 6, 5), { id: 'f', kind: 'footage', start: 6, end: 9 }, snap('b', 9, 15, 14)],
  };
  const segs = deriveSegments(plan, {}).segments;
  const foot = segs.find((s) => s.kind === 'footage' && s.start <= 6.01 && s.end >= 8.99);
  assert.ok(foot, 'the declared footage is preserved between the two snapshots');
});

test('a long empty gap becomes footage', () => {
  const plan = { video: { duration: 30 }, segments: [snap('a', 0, 6, 5), snap('b', 10, 18, 17)] };
  const segs = deriveSegments(plan, { minGapSeconds: 1.5 }).segments;
  assert.ok(segs.some((s) => s.kind === 'footage' && Math.abs(s.start - 5) < 0.01 && Math.abs(s.end - 10) < 0.01));
});

test('a short gap holds the previous scene (no face between b-rolls)', () => {
  const plan = { video: { duration: 30 }, segments: [snap('a', 0, 5, 5), snap('b', 6, 17, 16)] };
  const segs = deriveSegments(plan, { minGapSeconds: 1.5 }).segments;
  assert.ok(!segs.some((s) => s.kind === 'footage' && s.start >= 4.99 && s.end <= 6.01), 'no footage in the 1s gap');
});

test('the default gap threshold holds a short gap, not forcing a 1-2s face flash', () => {
  const plan = { video: { duration: 30 }, segments: [snap('a', 0, 5, 5), snap('b', 6.8, 17, 16)] };
  const segs = deriveSegments(plan, {}).segments; // default minGapSeconds = 3.0
  assert.ok(!segs.some((s) => s.kind === 'footage' && s.start < 6.8 && s.end > 5), 'the ~1.8s gap is held');
});

test('a snapshot shorter than the minimum is extended, never a sub-2s flash', () => {
  const plan = { video: { duration: 30 }, segments: [snap('a', 0, 5, 5), snap('b', 6, 7.2, 7.2)] };
  const segs = deriveSegments(plan, { minSnapshotSeconds: 2.0 }).segments;
  const b = segs.find((s) => s.id === 'b');
  assert.ok(b, 'snapshot b survives');
  assert.ok(b.end - b.start >= 1.999, `b held to the 2s minimum (got ${(b.end - b.start).toFixed(2)}s)`);
});

test('every snapshot scene carries the orange backdrop', () => {
  const { html } = build();
  assert.equal((html.match(/class="sc-bg"/g) ?? []).length, 2);
});

test('every slot is hidden at the scene start (nothing before its narration)', () => {
  const { html } = build();
  assert.ok(html.includes(`tl.set("#sc-s1 [data-slot]", {opacity:0`));
  assert.ok(html.includes(`tl.set("#sc-s2 [data-slot]", {opacity:0`));
});

test('the video build sets border-box sizing (the card-overflow fix)', () => {
  const { html } = build();
  assert.ok(html.includes('box-sizing: border-box'));
});

test('a beat reveals its slots with a beat-correct selector', () => {
  const { html } = build();
  assert.ok(html.includes(`#sc-s1 [data-slot='term-0']`));
  assert.ok(html.includes(`#sc-s1 [data-slot='result']`));
  assert.ok(!html.includes('[data-slot="term-0"]'), 'selector uses single-quoted attribute');
});

test('numeric slots count up and get the helper', () => {
  const { html } = build();
  assert.ok(html.includes('function __countUp'));
  assert.ok(html.includes('__countUp("#sc-s1 [data-slot=\'result\']"'));
});

test('every slot in the composition is tagged', () => {
  const { html } = build();
  for (const slot of ['head', 'term-0', 'result', 'text', 'handle']) {
    assert.ok(html.includes(`data-slot="${slot}"`), `slot ${slot} tagged`);
  }
});

test('a hold beat contributes no motion', () => {
  const { lines, counts } = beatLines({ start: 0, end: 1, action: { op: 'hold' } }, { sceneSel: '#sc-s1', style: STYLE });
  assert.deepEqual(lines, []);
  assert.deepEqual(counts, []);
});

test('motion config resolves deterministic defaults from the style', () => {
  const cfg = motionCfg(STYLE);
  assert.equal(typeof cfg.in, 'number');
  assert.equal(typeof cfg.ease, 'string');
  assert.ok(cfg.countUp > 0);
});
