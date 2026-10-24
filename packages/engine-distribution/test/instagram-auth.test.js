import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../scripts/instagram-auth.mjs'
);

test('instagram auth: profile requests ask only for id and username', () => {
  const source = readFileSync(SCRIPT, 'utf8');
  const profileFields = source.match(/fields:\s*'id,username'/g) ?? [];

  assert.equal(profileFields.length, 2, 'both profile requests use id,username');
  assert.doesNotMatch(source, /account_type/);
});
