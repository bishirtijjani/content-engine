#!/usr/bin/env node
// migrate-data.mjs — move an item into the one-folder-per-item layout.
//
//   node scripts/migrate-data.mjs --item 1            # migrate one item
//   node scripts/migrate-data.mjs --item 1 --dry-run  # print the plan, change nothing
//   node scripts/migrate-data.mjs --all               # every content_items row
//   node scripts/migrate-data.mjs --verify            # report DB paths that don't exist
//
// The layout it migrates to (packages/core/src/paths.js):
//
//   data/item-<id>/                  the one folder this item owns
//     source.mp4                     the recording (ONE copy on disk)
//     source.transcript.json         its transcript, always a sibling
//     script.txt                     the spoken lines the human reads from
//     script.json                    mirror of content_items.script
//     production/                    snapshots.plan.json, index.html, plan/…
//   data/renders/                    finished videos only
//
// Rules it obeys:
//   * never deletes content — dedupe is a hardlink, stale renders move to renders/
//   * never touches an item that was not asked for (item 2 stays put while it is
//     under human review)
//   * idempotent: running twice is a no-op
//   * every DB pointer it moves is updated in the same run
import fs from 'node:fs';
import path from 'node:path';
import { connect, makePaths, PROJECT_ROOT } from '@content-os/core';

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const P = makePaths();
const db = connect();

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

// A dry run has to model the moves it is about to make: otherwise every step
// that depends on an earlier one (the source dedupe, the render moves, "did we
// really need to write script.txt?") reads a disk that has not changed and
// reports nothing — or reports work the real run will not do.
//   planned: path -> will it exist once the run is done?
//   origins: planned path -> the file it actually comes from (for byte compares)
const planned = new Map();
const origins = new Map();

/** Does this path survive the run? Looks at the path, then its ancestors. */
function exists(p) {
  if (!dryRun) return fs.existsSync(p);
  let cur = path.resolve(p);
  for (;;) {
    if (planned.has(cur)) return planned.get(cur);
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return fs.existsSync(p);
}

/** The real file a planned path comes from (byte compares + reads). */
function real(p) {
  if (!dryRun) return p;
  let cur = path.resolve(p);
  for (;;) {
    if (origins.has(cur)) return origins.get(cur);
    const parent = path.dirname(cur);
    if (parent === cur) return p;
    cur = parent;
  }
}

/** Record a move for the whole subtree: the old tree dies, the new one lives. */
function recordMove(src, target) {
  if (!dryRun) return;
  const origin = origins.get(src) ?? src;
  const walk = (from, to, alive) => {
    planned.set(to, alive);
    if (alive) origins.set(to, from);
    let st;
    try {
      st = fs.statSync(from);
    } catch {
      return;
    }
    if (!st.isDirectory()) return;
    for (const e of fs.readdirSync(from)) walk(path.join(from, e), path.join(to, e), alive);
  };
  walk(src, src, false);      // the source subtree is going away...
  walk(origin, target, true); // ...and reappears at the target, same real files
}

const rel = (p) => path.relative(PROJECT_ROOT, p).split(path.sep).join('/');
const log = (verb, from, to = '') => console.log(`  ${verb.padEnd(6)} ${to ? `${to} ← ` : ''}${from}`);
const warn = (...a) => console.log('  !     ', ...a);

/** A path that is free: `-2`, `-3`, … before the extension when taken. */
function freePath(p) {
  if (!exists(p)) return p;
  const ext = path.extname(p);
  const stem = ext ? p.slice(0, -ext.length) : p;
  for (let i = 2; ; i++) {
    const cand = `${stem}-${i}${ext}`;
    if (!exists(cand)) return cand;
  }
}

/** Move (in dry-run, pretend to). Rename is same-filesystem, so it is cheap. */
function move(src, dest, { preferFree = true } = {}) {
  if (!exists(src)) return null;
  const target = preferFree ? freePath(dest) : dest;
  if (path.resolve(src) === path.resolve(target)) return src;
  const origin = origins.get(src) ?? src;
  log('MOVE', rel(origin), rel(target));
  recordMove(src, target);
  if (dryRun) return target;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.renameSync(src, target);
  return target;
}

/** Byte-for-byte compare without loading whole videos into memory. */
function sameContent(a, b) {
  try {
    const sa = fs.statSync(a);
    const sb = fs.statSync(b);
    if (sa.ino && sa.ino === sb.ino && sa.dev === sb.dev) return true;
    if (sa.size !== sb.size) return false;
    const fa = fs.openSync(a, 'r');
    const fb = fs.openSync(b, 'r');
    try {
      const bufA = Buffer.alloc(1 << 20);
      const bufB = Buffer.alloc(1 << 20);
      for (;;) {
        const ra = fs.readSync(fa, bufA, 0, bufA.length, null);
        const rb = fs.readSync(fb, bufB, 0, bufB.length, null);
        if (ra !== rb) return false;
        if (ra === 0) return true;
        if (!bufA.subarray(0, ra).equals(bufB.subarray(0, rb))) return false;
      }
    } finally {
      fs.closeSync(fa);
      fs.closeSync(fb);
    }
  } catch {
    return false;
  }
}

/**
 * Replace a byte-identical duplicate with a hardlink to the single copy.
 * Links to a temp name FIRST, so a failed link can never lose the duplicate.
 */
function dedupeToLink(keep, duplicate) {
  const src = real(keep);
  const dup = real(duplicate);
  if (!exists(duplicate) || path.resolve(src) === path.resolve(dup)) return;
  if (!sameContent(src, dup)) {
    warn('not identical — kept both:', rel(duplicate));
    return;
  }
  log('LINK', rel(duplicate), `same bytes as ${rel(keep)}`);
  if (dryRun) return;
  const tmp = `${duplicate}.linkme`;
  try {
    fs.rmSync(tmp, { force: true });
    fs.linkSync(keep, tmp);
  } catch (err) {
    warn(`hardlink failed (${err.code ?? err.message}) — left the duplicate alone`);
    fs.rmSync(tmp, { force: true });
    return;
  }
  fs.rmSync(duplicate);
  fs.renameSync(tmp, duplicate);
}

const VIDEO_RE = /\.(mp4|mov|webm|mkv|m4v)$/i;

/** Where a sidecar file belongs in the item folder, or null to leave it alone. */
function sidecarName(file, taken) {
  if (/\.transcript\.json$/i.test(file)) return taken.has('source.transcript.json') ? null : 'source.transcript.json';
  if (/\.txt$/i.test(file) && /script/i.test(file)) return 'script.txt';
  if (/\.plan\.json$/i.test(file)) return path.join('production', 'plan.proposed.json');
  if (/^script\.json$/i.test(file)) return 'script.json';
  return null;
}

function safeParse(text) {
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// one item
// ---------------------------------------------------------------------------
function migrateItem(itemId) {
  const row = db.prepare('SELECT id, title, status, script FROM content_items WHERE id = ?').get(itemId);
  if (!row) {
    warn(`content_items has no item ${itemId} — skipped`);
    return false;
  }
  const legacy = P.legacyItemDir(itemId);
  const itemDir = P.itemDir(itemId);
  const production = path.join(itemDir, 'production');

  console.log(`\nitem ${itemId} — "${row.title}" [${row.status}]`);
  if (exists(itemDir) && !exists(legacy)) {
    console.log('  already migrated — nothing to do\n');
    return false;
  }

  let changed = false;
  const emptied = new Set();

  // 1. adopt the recording: whatever folder the human dropped it in, the file
  //    now lives in data/item-<id>/ and the DB points at the new location.
  const recordings = db.prepare(
    'SELECT r.id, r.file_path FROM recordings r JOIN content_item_recordings c ON c.recording_id = r.id ' +
    'WHERE c.content_item_id = ? AND r.file_path IS NOT NULL ORDER BY r.id'
  ).all(itemId);

  for (const rec of recordings) {
    const src = path.isAbsolute(rec.file_path) ? rec.file_path : path.resolve(PROJECT_ROOT, rec.file_path);
    if (!exists(src)) {
      warn('recording file is missing:', rec.file_path);
      continue;
    }
    if (P.isInside(itemDir, src)) continue;          // already home
    const fromDir = path.dirname(src);
    emptied.add(fromDir);
    const taken = new Set(exists(itemDir) ? fs.readdirSync(itemDir) : []);

    const base = path.basename(src);
    let name;
    if (VIDEO_RE.test(base)) {
      const preferred = path.join(itemDir, 'source.mp4');
      name = !exists(preferred) || sameContent(real(preferred), src) ? 'source.mp4' : base;
    } else {
      name = base;
    }
    const dest = move(src, path.join(itemDir, name));
    if (dest) {
      taken.add(path.basename(dest));
      changed = true;
      if (!dryRun) db.prepare('UPDATE recordings SET file_path = ? WHERE id = ?').run(dest, rec.id);
      log('UPDATE', `recordings.id ${rec.id} file_path`, rel(dest));

      // the sidecars that live beside that recording move with it
      for (const side of fs.readdirSync(fromDir)) {
        if (side === path.basename(src)) continue;
        const sideSrc = path.join(fromDir, side);
        if (!exists(sideSrc)) continue;
        if (!fs.statSync(real(sideSrc)).isFile()) continue;
        const sideName = sidecarName(side, taken);
        if (!sideName) continue;
        const sideDest = move(sideSrc, path.join(itemDir, sideName));
        if (sideDest) {
          taken.add(path.basename(sideDest));
          changed = true;
        }
      }
    }
  }

  // 2. the legacy production folder becomes production/
  if (exists(legacy)) {
    for (const entry of fs.readdirSync(legacy, { withFileTypes: true })) {
      const src = path.join(legacy, entry.name);
      if (!exists(src)) continue;
      move(src, path.join(production, entry.name));
      changed = true;
    }
    log('DROP', `${rel(legacy)}${dryRun ? ' (dry run)' : ''}`, 'folded into production/');
    if (!dryRun) fs.rmSync(legacy, { recursive: true, force: true });
    changed = true;
  }

  // 3. one copy of the source: the item folder owns it, production/ hardlinks it
  const source = path.join(itemDir, 'source.mp4');
  const prodSource = path.join(production, 'source.mp4');
  if (exists(prodSource)) {
    if (!exists(source)) {
      move(prodSource, source, { preferFree: false });
      if (dryRun) {
        log('LINK', rel(source), 'hardlink back for the composition');
      } else if (fs.existsSync(source)) {
        try {
          fs.linkSync(source, prodSource);
          log('LINK', rel(prodSource), `hardlink of ${rel(source)}`);
        } catch (err) {
          warn(`hardlink failed (${err.code ?? err.message}) — the next build re-creates ${rel(prodSource)}`);
        }
      }
      changed = true;
    } else {
      dedupeToLink(source, prodSource);
    }
  }

  // 4. one transcript: next to the recording, never in production/
  const transcript = path.join(itemDir, 'source.transcript.json');
  const prodTranscript = path.join(production, 'transcript.json');
  if (exists(prodTranscript)) {
    if (!exists(transcript)) {
      move(prodTranscript, transcript, { preferFree: false });
      changed = true;
    } else if (sameContent(real(prodTranscript), real(transcript))) {
      log('DROP', rel(prodTranscript), 'identical to the sibling transcript');
      if (!dryRun) fs.rmSync(prodTranscript);
      changed = true;
    } else {
      warn('two different transcripts — kept both:', rel(prodTranscript), 'and', rel(transcript));
    }
  }

  // 5. finished videos leave the item folder for data/renders/
  for (const [name, slot] of [['out.final.mp4', `item-${itemId}.mp4`], ['out.preview.mp4', `item-${itemId}.preview.mp4`]]) {
    const stale = path.join(production, name);
    if (exists(stale)) {
      move(stale, path.join(P.rendersDir(), slot));
      changed = true;
    }
  }

  // 6. the scripts the human reads and the agent mirrors
  const scriptTxt = P.scriptTxt(itemId);
  const scriptJson = P.scriptJson(itemId);
  const parsed = safeParse(row.script ?? '');
  if (parsed) {
    if (!exists(scriptTxt)) {
      const lines = [];
      for (const part of [parsed.hook, parsed.script, parsed.cta]) {
        if (typeof part !== 'string') continue;
        for (const chunk of part.split(/\r?\n/)) {
          for (const sentence of chunk.split(/(?<=[.!?])\s+/)) {
            const t = sentence.replace(/\s+/g, ' ').trim();
            if (t) lines.push(t);
          }
        }
      }
      if (lines.length) {
        if (!dryRun) {
          fs.mkdirSync(itemDir, { recursive: true });
          fs.writeFileSync(scriptTxt, `${lines.join('\n')}\n`);
        }
        planned.set(scriptTxt, true);
        log('WRITE', rel(scriptTxt) + (dryRun ? ' (dry run)' : ''));
        changed = true;
      }
    }
    if (!exists(scriptJson)) {
      if (!dryRun) {
        fs.mkdirSync(itemDir, { recursive: true });
        fs.writeFileSync(scriptJson, `${JSON.stringify(parsed, null, 2)}\n`);
      }
      planned.set(scriptJson, true);
      log('WRITE', rel(scriptJson) + (dryRun ? ' (dry run)' : ''));
      changed = true;
    }
  }

  // 7. the plan's video block must point at files that exist, with video.item
  for (const planFile of [
    path.join(production, 'snapshots.plan.json'),
    path.join(production, 'plan.proposed.json'),
    path.join(production, 'plan', 'snapshots.json'),
  ]) {
    if (!exists(planFile)) continue;
    const plan = JSON.parse(fs.readFileSync(real(planFile), 'utf8'));
    const v = { ...(plan.video ?? {}) };
    const before = JSON.stringify(v);
    v.item = itemId;
    if (exists(source)) v.footage = rel(source);
    if (exists(transcript)) v.transcript = rel(transcript);
    if (exists(scriptTxt)) v.script = rel(scriptTxt);
    v.planDir = rel(path.join(production, 'plan'));
    if (JSON.stringify(v) === before) continue;
    if (!dryRun) fs.writeFileSync(planFile, `${JSON.stringify({ ...plan, video: v }, null, 2)}\n`);
    log('UPDATE', rel(planFile) + ' video block');
    changed = true;
  }

  // 8. drop folders this item emptied out (only when nothing is left in them)
  for (const dir of emptied) {
    if (!exists(dir) || P.isInside(itemDir, dir) || !P.isInside(P.data, dir)) continue;
    const left = fs.readdirSync(dir).filter((e) => exists(path.join(dir, e)));
    if (left.length) continue;
    if (!dryRun) fs.rmSync(dir, { recursive: true, force: true });
    log('DROP', rel(dir) + (dryRun ? ' (dry run)' : ''), 'empty');
    changed = true;
  }

  if (!changed) console.log('  nothing to do');
  console.log('');
  return changed;
}

// ---------------------------------------------------------------------------
// verification — every pointer the DB holds must exist, and nothing may sit
// outside the layout
// ---------------------------------------------------------------------------
function verify() {
  const problems = [];
  const check = (table, id, file) => {
    if (!file) return;
    const abs = path.isAbsolute(file) ? file : path.resolve(PROJECT_ROOT, file);
    if (!fs.existsSync(abs)) problems.push(`${table}.id ${id} → ${file}   (MISSING)`);
    else if (!P.isInside(P.data, abs)) problems.push(`${table}.id ${id} → ${file}   (outside data/)`);
  };
  for (const r of db.prepare('SELECT id, file_path FROM recordings').all()) check('recordings', r.id, r.file_path);
  for (const a of db.prepare('SELECT id, file_path FROM assets').all()) check('assets', a.id, a.file_path);

  const strays = [];
  if (fs.existsSync(P.data)) {
    for (const entry of fs.readdirSync(P.data, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (['renders', 'inbox', 'tmp', 'compositions'].includes(entry.name) || /^item-\d+$/.test(entry.name)) continue;
      strays.push(`data/${entry.name}   (not an item folder)`);
    }
  }
  if (fs.existsSync(P.legacyCompositionsDir())) {
    for (const e of fs.readdirSync(P.legacyCompositionsDir())) strays.push(`data/compositions/${e}   (unmigrated)`);
  }

  if (!problems.length && !strays.length) {
    console.log('data/ verifies clean: every DB pointer exists, no stray folders');
    return 0;
  }
  console.log('DB pointers:');
  for (const p of problems) console.log('  !', p);
  if (strays.length) {
    console.log('\nfolders outside the layout:');
    for (const s of strays) console.log('  -', s);
  }
  return 1;
}

// ---------------------------------------------------------------------------
if (argv.includes('--verify')) process.exit(verify());

const ids = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--item' && argv[i + 1]) ids.push(Number(argv[i + 1]));
  if (argv[i].startsWith('--item=')) ids.push(Number(argv[i].split('=')[1]));
}
if (argv.includes('--all')) {
  for (const r of db.prepare('SELECT id FROM content_items ORDER BY id').all()) ids.push(r.id);
}
if (!ids.length) {
  console.error('usage: node scripts/migrate-data.mjs --item <id> [--dry-run] | --all | --verify');
  process.exit(2);
}

console.log(`${dryRun ? '[dry run] ' : ''}migrating: ${ids.join(', ')}`);
let any = false;
for (const id of ids) if (migrateItem(id)) any = true;
if (!any) console.log('nothing to migrate');
if (!dryRun && any) {
  console.log('verify:');
  verify();
}
db.close();
