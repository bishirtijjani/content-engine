// The data layout contract (packages/core/src/paths.js): one folder per item,
// one transcript per recording, renders in one place, and nothing written
// outside data/. These are the rules that kept the tree from scattering.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { makePaths, defaultDataDir, linkOrCopy, pruneRenderScratch } from '../src/paths.js';

const scratch = () => mkdtempSync(path.join(tmpdir(), 'paths-'));

test('the layout: one folder per item, production inside it, renders alone', () => {
  const p = makePaths(scratch());
  assert.match(p.itemDir(2), /item-2$/);
  assert.ok(p.productionDir(2).endsWith(path.join('item-2', 'production')));
  assert.ok(p.planDir(2).endsWith(path.join('production', 'plan')));
  assert.ok(p.scriptTxt(2).endsWith(path.join('item-2', 'script.txt')));
  assert.ok(p.renderPath(2).endsWith(path.join('renders', 'item-2.mp4')));
  assert.ok(p.renderPath(2, 'preview').endsWith(path.join('renders', 'item-2.preview.mp4')));
  assert.ok(p.renderPath(2, 'mixed').endsWith(path.join('renders', 'item-2.mixed.mp4')));
  assert.ok(p.logPath('vid2-edit', 'err').endsWith(path.join('renders', '_vid2-edit.err')));
  assert.ok(p.inboxDir().endsWith('inbox'));
  assert.ok(p.tmpDir().endsWith('tmp'));
});

test('one transcript, always the sibling of the video it describes', () => {
  const p = makePaths(scratch());
  assert.ok(p.transcriptFor('/a/source.mp4').endsWith('source.transcript.json'));
  assert.ok(p.transcriptFor('/a/Vid_2.cleaned.mp4').endsWith('Vid_2.cleaned.transcript.json'));
  // never a second copy in the composition folder
  assert.notEqual(p.transcriptFor('/a/source.mp4'), '/b/production/transcript.json');
});

test('legacy folders resolve until they are migrated', () => {
  const root = scratch();
  const p = makePaths(root);
  // nothing exists yet → the new location
  assert.equal(p.resolveItemDir(7), p.itemDir(7));
  assert.equal(p.resolveProductionDir(7), p.productionDir(7));

  // a pre-migration item keeps serving its old folder
  mkdirSync(p.legacyItemDir(3), { recursive: true });
  assert.equal(p.resolveItemDir(3), p.legacyItemDir(3));
  assert.equal(p.resolveProductionDir(3), p.legacyItemDir(3), 'legacy artifacts sit at the folder root');
  assert.ok(p.isLegacyDir(p.resolveItemDir(3)));
  assert.ok(!p.isLegacyDir(p.resolveItemDir(7)));

  // the new tree wins once it exists
  mkdirSync(p.itemDir(3), { recursive: true });
  assert.equal(p.resolveItemDir(3), p.itemDir(3));
  assert.equal(p.resolveProductionDir(3), p.productionDir(3));
});

test('adopt hardlinks instead of copying, and never overwrites another file', () => {
  const root = scratch();
  const p = makePaths(root);
  const drop = mkdtempSync(path.join(tmpdir(), 'drop-'));
  const src = path.join(drop, 'clean.mp4');
  writeFileSync(src, 'take one');

  const first = p.adopt(src, 1);
  assert.equal(first.path, path.join(p.itemDir(1), 'clean.mp4'));
  assert.ok(first.adopted);
  assert.equal(readFileSync(first.path, 'utf8'), 'take one');

  // same file again → no second copy
  const again = p.adopt(src, 1);
  assert.equal(again.adopted, false);
  assert.equal(again.path, first.path);

  // a DIFFERENT file with the same name must not clobber what is already there
  const other = path.join(drop, 'other');
  writeFileSync(other, 'take two');
  const named = p.adopt(other, 1, { name: 'clean.mp4' });
  assert.equal(named.path, first.path, 'first one wins');
  assert.equal(readFileSync(first.path, 'utf8'), 'take one', 'the adopted file is untouched');
  assert.equal(readFileSync(other, 'utf8'), 'take two', 'and so is the new one');

  // naming it something else lands it beside the first
  const renamed = p.adopt(other, 1, { name: 'take-2.mp4' });
  assert.ok(existsSync(renamed.path));
  assert.equal(readFileSync(renamed.path, 'utf8'), 'take two');
});

test('a file already inside the item folder is returned untouched', () => {
  const p = makePaths(scratch());
  mkdirSync(p.itemDir(5), { recursive: true });
  const own = path.join(p.itemDir(5), 'source.mp4');
  writeFileSync(own, 'x');
  const r = p.adopt(own, 5);
  assert.equal(r.adopted, false);
  assert.equal(r.path, own);
});

test('writes outside data/ are refused', () => {
  const root = scratch();
  const p = makePaths(root);
  assert.equal(p.assertInsideData(path.join(p.itemDir(1), 'x')), path.join(p.itemDir(1), 'x'));
  assert.throws(() => p.assertInsideData('/etc/passwd'), /refusing to write outside the data folder/);
  assert.throws(() => p.assertInsideData(path.join(root, '..', 'elsewhere')), /refusing to write/);
});

test('linkOrCopy spends no second copy on the same filesystem', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lc-'));
  const src = path.join(dir, 'a.mp4');
  const dest = path.join(dir, 'sub', 'source.mp4');
  writeFileSync(src, 'bytes');
  const r = linkOrCopy(src, dest);
  assert.equal(readFileSync(dest, 'utf8'), 'bytes');
  if (r.linked) assert.ok(existsSync(src), 'the original survives a hardlink');
});

test('pruneRenderScratch clears renderer scratch and nothing else', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'hf-'));
  mkdirSync(path.join(dir, 'work-abc123', 'captured-frames'), { recursive: true });
  writeFileSync(path.join(dir, 'work-abc123', 'captured-frames', 'f.png'), 'x');
  mkdirSync(path.join(dir, '.out.preview.hf-transaction-xyz'), { recursive: true });
  mkdirSync(path.join(dir, 'plan'), { recursive: true });
  writeFileSync(path.join(dir, 'index.html'), '<html></html>');

  const removed = pruneRenderScratch(dir);
  assert.equal(removed, 2);
  assert.ok(!existsSync(path.join(dir, 'work-abc123')));
  assert.ok(!existsSync(path.join(dir, '.out.preview.hf-transaction-xyz')));
  assert.ok(existsSync(path.join(dir, 'plan')));
  assert.ok(existsSync(path.join(dir, 'index.html')));
  assert.equal(pruneRenderScratch(dir), 0, 'idempotent');
  assert.equal(pruneRenderScratch(path.join(dir, 'nope')), 0, 'missing dir is fine');
});

test('the default root honours CONTENT_OS_DATA_DIR', () => {
  const before = process.env.CONTENT_OS_DATA_DIR;
  const root = scratch();
  process.env.CONTENT_OS_DATA_DIR = root;
  try {
    assert.equal(defaultDataDir(), root);
  } finally {
    if (before === undefined) delete process.env.CONTENT_OS_DATA_DIR;
    else process.env.CONTENT_OS_DATA_DIR = before;
  }
});
