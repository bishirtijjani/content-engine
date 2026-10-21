// paths.js — the ONE place that knows where files live under data/.
//
// Every engine, tool, and script resolves paths through here so the tree can
// never fork again. Before this module existed there were three conventions
// living side by side:
//
//   content engine   data/vid<id>/script.txt            (shoot folders)
//   cleaner          data/<free-form name>/             (data/vid1, data/Vid_2, ...)
//   production       data/compositions/<free text>/     (minted by the plan's video.id)
//
// which is how one video ended up as vid_2 + item-2 + Vid_2, with transcripts
// in two places, renders in two places, and stills next to scripts.
//
// THE LAYOUT
//
//   data/
//     content.db          the database
//     inbox/              raw footage nobody has attached yet (list_footage scans it)
//     item-<id>/          one folder per content_item — flat, everything it owns
//       source.mp4        the recording (adopted by process_footage — ONE copy on disk)
//       source.transcript.json   one transcript, always a sibling of its video
//       audio.mp3         separate audio take (cleaner input)
//       script.txt        spoken lines for recording  (content engine, ready())
//       script.json       structured script           (mirror of content_items.script)
//       *.cleaned.mp4, *.cuts.json, *.review.json ...  cleaner outputs
//       production/       everything the production engine makes
//         snapshots.plan.json
//         index.html
//         plan/           stills/, html/, beats.md, snapshots.json, snapshot-grid.*
//     renders/            ONLY finished videos + detached render logs
//     tmp/                HyperFrames work dirs + test scratch
//
// RULE: a file belongs to exactly one item → data/item-<id>/. It is a finished
// deliverable → data/renders/. Neither → data/tmp/ or delete it.
//
// LEGACY: item folders from the old tree (data/compositions/item-<id>) are still
// resolved until they are migrated, so an item under human review never has to
// move mid-flight. `resolve*` prefers the new location and falls back to the old.
import path from 'node:path';
import { existsSync, mkdirSync, linkSync, copyFileSync, statSync, unlinkSync, readdirSync, rmSync } from 'node:fs';
import { PROJECT_ROOT } from './db.js';

/** The data root. Env override so tests never touch the repo's real data. */
export function defaultDataDir() {
  return process.env.CONTENT_OS_DATA_DIR || path.join(PROJECT_ROOT, 'data');
}

/** Repo root, for turning absolute data paths into the relative ones docs use. */
export const REPO_ROOT = PROJECT_ROOT;

const LEGACY_COMPOSITIONS = 'compositions';

/**
 * Build the path helper for one data root.
 * @param {string} [root] defaults to `CONTENT_OS_DATA_DIR` or `<repo>/data`
 */
export function makePaths(root = defaultDataDir()) {
  const data = path.resolve(root);

  const rel = (p) => path.relative(PROJECT_ROOT, p).split(path.sep).join('/');
  const join = (...parts) => path.join(data, ...parts);

  const paths = {
    data,

    // ---- fixed trees -----------------------------------------------------
    /** Raw footage waiting to be attached to an item. */
    inboxDir: () => join('inbox'),
    /** Scratch: HyperFrames work dirs, test output. Never real data. */
    tmpDir: () => join('tmp'),
    /** Finished videos + detached render logs (`_<job>.out/.err/.pid`). */
    rendersDir: () => join('renders'),
    /** Legacy compositions tree — only read, never written to again. */
    legacyCompositionsDir: () => join(LEGACY_COMPOSITIONS),

    // ---- one folder per item --------------------------------------------
    itemDir: (itemId) => join(`item-${itemId}`),
    /** Where the production engine's artifacts live in the NEW tree. */
    productionDir: (itemId) => path.join(paths.itemDir(itemId), 'production'),
    /** The plan output folder (stills, html, beats, contact sheet). */
    planDir: (itemId) => path.join(paths.productionDir(itemId), 'plan'),
    scriptTxt: (itemId) => path.join(paths.itemDir(itemId), 'script.txt'),
    scriptJson: (itemId) => path.join(paths.itemDir(itemId), 'script.json'),

    // ---- renders ---------------------------------------------------------
    /** `kind`: 'preview' | 'final' | 'mixed' → item-<id>[.preview|.mixed].mp4 */
    renderPath: (itemId, kind = 'final') => {
      const suffix = kind === 'final' ? '' : `.${kind}`;
      return path.join(paths.rendersDir(), `item-${itemId}${suffix}.mp4`);
    },
    /** Detached render logs: data/renders/_<job>.out | .err | .pid */
    logPath: (job, ext = 'out') => path.join(paths.rendersDir(), `_${job}.${ext}`),

    // ---- legacy-aware resolution ----------------------------------------
    /**
     * The item's folder: the new `data/item-<id>` when it exists, otherwise the
     * old `data/compositions/item-<id>`, otherwise the new location (to create).
     */
    resolveItemDir(itemId) {
      const modern = paths.itemDir(itemId);
      if (existsSync(modern)) return modern;
      const legacy = paths.legacyItemDir(itemId);
      if (existsSync(legacy)) return legacy;
      return modern;
    },
    /** The old folder, whether or not it exists. */
    legacyItemDir: (itemId) => join(LEGACY_COMPOSITIONS, `item-${itemId}`),
    /** True when `p` sits in the old compositions tree (pre-migration). */
    isLegacyDir: (p) => {
      const parent = path.dirname(path.resolve(p));
      return parent === paths.legacyCompositionsDir();
    },
    /**
     * Where this item's production artifacts live. In the new tree they are
     * `<item>/production`; in a legacy folder they are the folder itself.
     */
    resolveProductionDir(itemId) {
      const dir = paths.resolveItemDir(itemId);
      return paths.isLegacyDir(dir) ? dir : path.join(dir, 'production');
    },
    /** Same shape for the plan output folder (stills, beats, contact sheet). */
    resolvePlanDir: (itemId) => path.join(paths.resolveProductionDir(itemId), 'plan'),
    /**
     * The canonical transcript for a recording: `<video>.transcript.json`, next
     * to the video it describes. Never a copy in the composition folder.
     */
    transcriptFor: (videoPath) => videoPath.replace(/(\.[^.]+)?$/, '.transcript.json'),

    // ---- guards ----------------------------------------------------------
    /** True when `p` is inside `dir` (after resolving both). */
    isInside: (dir, p) => {
      const a = path.resolve(dir);
      const b = path.resolve(p);
      return b === a || b.startsWith(a + path.sep);
    },
    /**
     * Refuse to write outside data/ — the guard the CLI tools use so a plan's
     * free-text id can never mint a folder somewhere else.
     * @returns {string} the path, unchanged, when it is allowed
     */
    assertInsideData(p) {
      if (!paths.isInside(data, p)) {
        throw new Error(`refusing to write outside the data folder: ${p} (data root: ${data})`);
      }
      return p;
    },

    // ---- adoption --------------------------------------------------------
    /**
     * Put a file into an item's folder — hardlink when the filesystem allows
     * (same volume → zero extra bytes), copy otherwise. Never duplicates what
     * is already there, and never touches the original.
     *
     * @param {string} src        the file to adopt
     * @param {number} itemId     which item now owns it
     * @param {object} [opts]
     * @param {string} [opts.name] destination basename (defaults to src's)
     * @param {boolean} [opts.move] remove the original after a successful copy
     * @returns {{ path: string, linked: boolean, adopted: boolean }}
     */
    adopt(src, itemId, { name, move = false } = {}) {
      const abs = path.resolve(src);
      const dir = paths.itemDir(itemId);
      const dest = path.join(dir, name ?? path.basename(abs));
      if (path.resolve(dest) === abs) return { path: dest, linked: false, adopted: false };
      if (existsSync(dest)) {
        // Already adopted (same inode or a previous run) — keep the one copy.
        if (sameFile(abs, dest)) return { path: dest, linked: true, adopted: false };
        return { path: dest, linked: false, adopted: false };
      }
      mkdirSync(dir, { recursive: true });
      let linked = false;
      try {
        linkSync(abs, dest);
        linked = true;
      } catch {
        copyFileSync(abs, dest);
      }
      if (move) {
        try { unlinkSync(abs); } catch { /* leave the original if it refuses */ }
      }
      return { path: dest, linked, adopted: true };
    },

    /** Repo-relative path with forward slashes — what docs and logs show. */
    relative: rel,
  };

  return paths;
}

/** Are these two paths the same file (same inode), or byte-identical? */
function sameFile(a, b) {
  try {
    const sa = statSync(a);
    const sb = statSync(b);
    if (sa.ino && sa.ino === sb.ino && sa.dev === sb.dev) return true;
    return sa.size === sb.size;
  } catch {
    return false;
  }
}

/** A paths object on the default root, for callers that never override dataDir. */
export const paths = makePaths();

/**
 * Put `src` at `dest` without spending a second copy: hardlink when the
 * filesystem allows it, copy when it does not (cross-device, FAT, ...).
 * Never overwrites an existing `dest` — call it only when the caller has
 * checked, or when "first one wins" is the rule.
 */
export function linkOrCopy(src, dest) {
  mkdirSync(path.dirname(dest), { recursive: true });
  try {
    linkSync(src, dest);
    return { linked: true };
  } catch {
    copyFileSync(src, dest);
    return { linked: false };
  }
}

/**
 * Clear a renderer's scratch out of a composition folder: `work-*` and
 * `*.hf-transaction-*` directories HyperFrames leaves behind after a run.
 * Call it only when we know no render is in flight.
 * @returns {number} directories removed
 */
export function pruneRenderScratch(dir) {
  if (!existsSync(dir)) return 0;
  let removed = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (/^work-/.test(entry.name) || /\.hf-transaction-/.test(entry.name)) {
      rmSync(path.join(dir, entry.name), { recursive: true, force: true });
      removed++;
    }
  }
  return removed;
}
