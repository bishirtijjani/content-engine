// A snapshot plan may only ever REFERENCE an item — its id decides where the
// stills, composition, and renders land. This is the guard that stopped
// data/compositions/{video,sg-smoke,agent-loop,item-fin,item2-sgtest} from
// being minted one ad-hoc plan at a time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initDb } from '@content-os/core';
import { planItemId, itemArgv, resolvePlanTarget } from '../tools/lib/item-dir.mjs';

/** Keep resolution off the repo's real data/ (and its real database). */
function isolated(fn) {
  const before = process.env.CONTENT_OS_DATA_DIR;
  process.env.CONTENT_OS_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'item-dir-'));
  try {
    return fn(process.env.CONTENT_OS_DATA_DIR);
  } finally {
    if (before === undefined) delete process.env.CONTENT_OS_DATA_DIR;
    else process.env.CONTENT_OS_DATA_DIR = before;
  }
}

test('the item id comes from video.item, then an id-shaped video.id/planDir', () => {
  assert.equal(planItemId({ video: { item: 4 } }), 4);
  assert.equal(planItemId({ video: { id: 'item-2' } }), 2);
  assert.equal(planItemId({ video: { id: 'vid2' } }), 2);
  assert.equal(planItemId({ video: { planDir: 'data/compositions/item-1/plan' } }), 1);
  assert.equal(planItemId({ video: { id: 'Vid_2' } }), 2);
});

test('free-text ids resolve to nothing — they never decide a folder', () => {
  assert.equal(planItemId({ video: { id: 'e2e' } }), null);
  assert.equal(planItemId({ video: { id: 'video' } }), null);
  assert.equal(planItemId({ video: { id: 'item-fin' } }), null, 'a name without a number is not an id');
  assert.equal(planItemId({ video: { id: 'sg-smoke' } }), null);
  assert.equal(planItemId({}), null);
  assert.equal(planItemId(null), null);
});

test('--item beats the plan, and is parsed from argv', () => {
  const plan = { video: { item: 4 } };
  assert.equal(planItemId(plan, 9), 9, 'the explicit flag wins');
  assert.equal(itemArgv(['--item', '7']), 7);
  assert.equal(itemArgv(['plan.json', '--item=8']), 8);
  assert.equal(itemArgv(['plan.json']), null);
  assert.equal(itemArgv(['--item', 'later']), null, 'not a number → ignored');
});

test('a plan that names no item fails with an actionable error', () => {
  isolated((root) => {
    assert.throws(
      () => resolvePlanTarget({ plan: { video: { id: 'random-thing' } } }),
      /does not name a content item[\s\S]*video\.item/
    );
    // with a database in the way, an id that does not exist is refused too
    initDb(path.join(root, 'content.db')).close();
    assert.throws(
      () => resolvePlanTarget({ plan: { video: { item: 9999 } } }),
      /no item 9999 — a plan for a non-existent item cannot write anywhere/
    );
  });
});

test('the resolved folders follow the item tree, legacy-aware', () => {
  isolated((root) => {
    const fresh = resolvePlanTarget({ plan: { video: { item: 6 } } });
    assert.equal(fresh.itemId, 6);
    assert.ok(fresh.productionDir.endsWith(path.join('item-6', 'production')));
    assert.ok(fresh.planDir.endsWith(path.join('production', 'plan')));
    assert.ok(fresh.renderPath('preview').endsWith(path.join('renders', 'item-6.preview.mp4')));

    // a pre-migration item keeps its old folder until it is moved
    mkdirSync(path.join(root, 'compositions', 'item-6'), { recursive: true });
    const legacy = resolvePlanTarget({ plan: { video: { item: 6 } } });
    assert.ok(legacy.productionDir.endsWith(path.join('compositions', 'item-6')));
    assert.ok(legacy.planDir.endsWith(path.join('compositions', 'item-6', 'plan')));
    assert.equal(legacy.renderPath(), path.join(root, 'renders', 'item-6.mp4'), 'renders never move');
  });
});
