// item-dir.mjs — which item a snapshot plan belongs to, and where it may write.
//
// THE RULE: the item's id decides the folder. A plan may REFERENCE an item by
// `video.item` (preferred) or by an id inside `video.id` / `video.planDir`, but
// it can never mint a folder of its own. The old fallback
//
//     path.join(REPO, v.planDir ?? `data/compositions/${v.id ?? 'video'}`)
//
// is what scattered the tree: every ad-hoc plan produced a new directory
// (data/compositions/{video,sg-smoke,agent-loop,item-fin,item2-sgtest}).
//
// Resolution order: --item <n> arg, then video.item, then an item-<n>/vid<n>
// pattern in video.id or video.planDir. Nothing found → hard failure with an
// actionable message, never a guess.
import path from 'node:path';
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { makePaths } from '@content-os/core';

const ITEM_RE = /(?:^|[/_-])(?:item-|vid[_-]?)(\d+)(?=[/_\-.]|$)/i;

/** @returns {number|null} the content_items.id this plan is for */
export function planItemId(plan, argvItem = null) {
  const v = plan?.video ?? {};
  for (const cand of [argvItem, v.item, v.id, v.planDir]) {
    if (cand === null || cand === undefined || cand === '') continue;
    const n = Number(cand);
    if (Number.isInteger(n) && n > 0) return n;
    const m = String(cand).match(ITEM_RE);
    if (m) return Number(m[1]);
  }
  return null;
}

/** `--item 2` / `--item=2` from argv, else null. */
export function itemArgv(argv = process.argv.slice(2)) {
  const i = argv.findIndex((a) => a === '--item' || a.startsWith('--item='));
  if (i === -1) return null;
  const raw = argv[i].includes('=') ? argv[i].split('=')[1] : argv[i + 1];
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** True when the item exists (false), when we cannot tell (null), or not (true). */
function itemExists(dataRoot, itemId) {
  const dbPath = path.join(dataRoot, 'content.db');
  if (!existsSync(dbPath)) return null;
  let db = null;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    return db.prepare('SELECT 1 AS ok FROM content_items WHERE id = ?').get(itemId) !== undefined;
  } catch {
    return null;
  } finally {
    try { db?.close(); } catch { /* nothing to close */ }
  }
}

/**
 * Resolve the folders a plan may write to, or throw.
 *
 * @param {object} opts
 * @param {object} opts.plan         the parsed snapshot plan
 * @param {number} [opts.argvItem]   from `--item <n>`
 * @returns {{
 *   itemId: number,
 *   paths: ReturnType<typeof makePaths>,
 *   itemDir: string, productionDir: string, planDir: string, renderPath: (kind?: string) => string
 * }}
 */
export function resolvePlanTarget({ plan, argvItem = null } = {}) {
  const p = makePaths();
  const itemId = planItemId(plan, argvItem);
  if (!itemId) {
    throw new Error(
      'this plan does not name a content item — set plan.video.item to the content_items.id ' +
      '(or pass --item <id>). Free-text ids no longer decide where files land.'
    );
  }
  if (itemExists(p.data, itemId) === false) {
    throw new Error(`content_items has no item ${itemId} — a plan for a non-existent item cannot write anywhere`);
  }
  const productionDir = p.resolveProductionDir(itemId);
  return {
    itemId,
    paths: p,
    itemDir: p.resolveItemDir(itemId),
    productionDir,
    planDir: p.resolvePlanDir(itemId),
    renderPath: (kind = 'final') => p.renderPath(itemId, kind),
  };
}
