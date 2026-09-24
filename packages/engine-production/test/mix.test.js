// Mix — sound effects under the voice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMixCommand, mixSfx } from '../src/mix.mjs';
import { loadStyle } from '../src/style.mjs';

const STYLE = loadStyle();
const resolveSfx = (id) => (id === 'sfx/whoosh' || id === 'whoosh-soft' ? 'C:/sfx/whoosh.wav' : null);

test('buildMixCommand returns null when there is nothing to place', () => {
  assert.equal(buildMixCommand({ videoPath: 'in.mp4', outputPath: 'out.mp4', sfx: [], style: STYLE }), null);
});

test('buildMixCommand places each sound at its timestamp', () => {
  const cmd = buildMixCommand({
    videoPath: 'in.mp4',
    outputPath: 'out.mp4',
    sfx: [{ at: 12, sound: 'sfx/whoosh' }, { at: 1.5, sound: 'whoosh-soft' }],
    style: STYLE,
    resolveSfx,
  });
  assert.ok(cmd);
  assert.equal(cmd.placed, 2);
  const filter = cmd.args[cmd.args.indexOf('-filter_complex') + 1];
  assert.ok(filter.includes('adelay=12000:all=1'));
  assert.ok(filter.includes('adelay=1500:all=1'));
  assert.ok(filter.includes('amix=inputs=3:duration=first:normalize=0'));
  assert.ok(cmd.args.includes('in.mp4'));
});

test('buildMixCommand resolves a style cue alias', () => {
  const cmd = buildMixCommand({
    videoPath: 'in.mp4',
    outputPath: 'out.mp4',
    sfx: [{ at: 0, sound: 'whoosh' }],
    style: STYLE,
    resolveSfx,
  });
  assert.ok(cmd);
  assert.equal(cmd.placed, 1);
});

test('mixSfx does not run ffmpeg when nothing resolves', () => {
  let ran = false;
  const res = mixSfx({
    videoPath: 'in.mp4',
    outputPath: 'out.mp4',
    sfx: [{ at: 1, sound: 'sfx/missing' }],
    style: STYLE,
    resolveSfx: () => null,
    run: () => { ran = true; return { status: 0 }; },
  });
  assert.equal(res.mixed, false);
  assert.equal(ran, false);
});

test('mixSfx reports success from a clean ffmpeg run', () => {
  const res = mixSfx({
    videoPath: 'in.mp4',
    outputPath: 'out.mp4',
    sfx: [{ at: 1, sound: 'sfx/whoosh' }],
    style: STYLE,
    resolveSfx,
    run: () => ({ status: 0, stderr: '' }),
  });
  assert.equal(res.mixed, true);
  assert.equal(res.placed, 1);
});
