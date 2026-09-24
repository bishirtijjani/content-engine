// Library — the asset catalog and id -> file resolution.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  loadCatalog,
  visualIds,
  sfxIds,
  resolveVisualPath,
  resolveSfxPath,
  validationCatalog,
} from '../src/library.mjs';

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'library-'));
  mkdirSync(path.join(dir, 'visuals'));
  mkdirSync(path.join(dir, 'sfx'));
  writeFileSync(path.join(dir, 'visuals', 'dashboard.png'), 'x');
  writeFileSync(path.join(dir, 'sfx', 'whoosh.wav'), 'x');
  const catalogPath = path.join(dir, 'catalog.json');
  writeFileSync(catalogPath, JSON.stringify({
    visuals: [{ id: 'visuals/dashboard', file: 'visuals/dashboard.png', description: 'dashboard', tags: [] }],
    sfx: [{ id: 'sfx/whoosh', file: 'sfx/whoosh.wav', description: 'whoosh', tags: [] }],
  }));
  return { dir, catalogPath };
}

test('loadCatalog returns an empty shape when missing', () => {
  const c = loadCatalog(path.join(tmpdir(), 'nope', 'catalog.json'));
  assert.deepEqual(c, { visuals: [], sfx: [] });
});

test('visualIds and sfxIds list the ids', () => {
  const { catalogPath } = fixture();
  const c = loadCatalog(catalogPath);
  assert.deepEqual(visualIds(c), ['visuals/dashboard']);
  assert.deepEqual(sfxIds(c), ['sfx/whoosh']);
});

test('resolveVisualPath finds the file on disk', () => {
  const { dir, catalogPath } = fixture();
  const c = loadCatalog(catalogPath);
  const p = resolveVisualPath('visuals/dashboard', c, dir);
  assert.ok(p && p.endsWith('dashboard.png'));
});

test('resolveVisualPath returns null for an unknown id', () => {
  const { dir, catalogPath } = fixture();
  const c = loadCatalog(catalogPath);
  assert.equal(resolveVisualPath('visuals/ghost', c, dir), null);
});

test('resolveSfxPath finds the sound on disk', () => {
  const { dir, catalogPath } = fixture();
  const c = loadCatalog(catalogPath);
  const p = resolveSfxPath('sfx/whoosh', c, dir);
  assert.ok(p && p.endsWith('whoosh.wav'));
});

test('validationCatalog includes templates and visual/sfx ids', () => {
  const { catalogPath } = fixture();
  const v = validationCatalog(loadCatalog(catalogPath));
  assert.ok(v.templates.includes('stat-callout'));
  assert.ok(v.visuals.includes('visuals/dashboard'));
  assert.ok(v.sfx.includes('sfx/whoosh'));
});
