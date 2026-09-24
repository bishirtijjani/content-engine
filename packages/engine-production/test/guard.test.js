import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { samePath, assertNotInput } from '../tools/clean/lib/guard.mjs';

test('allows a new sibling output path', () => {
  const inputs = ['C:/footage/vid1.mp4', 'C:/footage/vid1-rec.mpeg'];
  assert.doesNotThrow(() => assertNotInput('C:/footage/vid1.cleaned.mp4', inputs));
});

test('refuses to write over an input', () => {
  const inputs = ['C:/footage/vid1.mp4'];
  assert.throws(() => assertNotInput('C:/footage/vid1.mp4', inputs), /refusing to write over an input/);
});

test('samePath normalises relative and absolute', () => {
  const abs = path.resolve('data/vid1/vid1.mp4');
  assert.ok(samePath(abs, 'data/vid1/vid1.mp4'));
  assert.ok(!samePath(abs, 'data/vid1/vid1.cleaned.mp4'));
});

test('ignores empty inputs', () => {
  assert.doesNotThrow(() => assertNotInput('C:/footage/out.mp4', [null, undefined, '']));
});
