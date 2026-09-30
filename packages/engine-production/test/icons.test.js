// Icons — geometry sourced from Tabler (MIT), generated, merged with the custom seam.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ICON_PATHS, ICON_NAMES } from '../src/diagrams/icons.mjs';
import { COMPUTED_ICON_PATHS } from '../src/diagrams/icons.generated.mjs';
import { CUSTOM_ICON_PATHS } from '../src/diagrams/icons.custom.mjs';

const PUBLIC_KEYS = ['user', 'doc', 'code', 'gear', 'database', 'send', 'check', 'bolt', 'chat', 'chart'];

test('the public icon API is unchanged', () => {
  assert.deepEqual([...ICON_NAMES].sort(), [...PUBLIC_KEYS].sort());
});

test('the generated set carries exactly the mapped keys', () => {
  assert.deepEqual(Object.keys(COMPUTED_ICON_PATHS).sort(), [...PUBLIC_KEYS].sort());
});

test('every icon is a non-empty list of inline-safe path strings', () => {
  for (const [name, paths] of Object.entries(ICON_PATHS)) {
    assert.ok(Array.isArray(paths) && paths.length, `${name} has paths`);
    for (const d of paths) {
      assert.equal(typeof d, 'string');
      assert.ok(d.trim().length > 0, `${name} path is not empty`);
      assert.ok(/^[Mm]/.test(d.trim()), `${name} path starts with a move command`);
      assert.ok(!/[<>]/.test(d) && !/url\(/i.test(d), `${name} path is inline-safe`);
    }
  }
});

test('the icons use only standard path commands and sane coordinates', () => {
  for (const [name, paths] of Object.entries(ICON_PATHS)) {
    for (const d of paths) {
      assert.ok(/^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+$/.test(d), `${name} uses only path command chars`);
    }
  }
});

test('the custom seam is empty for now', () => {
  assert.deepEqual(CUSTOM_ICON_PATHS, {});
});

test('custom keys would override generated keys (merge precedence)', () => {
  const merged = { ...COMPUTED_ICON_PATHS, ...{ check: ['M0 0L24 24'] } };
  assert.deepEqual(merged.check, ['M0 0L24 24']);
});
