// build-asset-catalog.mjs — scan assets/ and write assets/catalog.json.
//
// Run after dropping new files in. You do not write the catalog by hand.
//
//   npm --workspace @content-os/engine-production run catalog
//
// A file's id is "visuals/<name-without-extension>" (e.g. visuals/dashboard).
// Its description comes from a same-named .txt sidecar (first line), or from
// the filename with dashes turned into spaces.
//
// `visuals/` holds screenshots, screen recordings, and your own video clips.
// There is no stock footage. Graphics and diagrams are drawn from templates/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(__dirname, '..', 'assets');
const OUT = path.join(ASSETS, 'catalog.json');

const VISUAL_EXT = new Set([
  '.mp4', '.mov', '.webm', '.mkv', '.m4v',
  '.png', '.jpg', '.jpeg', '.webp', '.gif',
]);
const AUDIO_EXT = new Set(['.wav', '.mp3', '.m4a', '.aac', '.ogg', '.flac']);

function scan(folder, exts) {
  const dir = path.join(ASSETS, folder);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => exts.has(path.extname(f).toLowerCase()))
    .sort()
    .map((f) => {
      const base = path.basename(f, path.extname(f));
      const sidecar = path.join(dir, `${base}.txt`);
      const description = fs.existsSync(sidecar)
        ? fs.readFileSync(sidecar, 'utf8').trim().split('\n')[0]
        : base.replace(/[-_]+/g, ' ');
      return { id: `${folder}/${base}`, file: `${folder}/${f}`, description, tags: [] };
    });
}

const catalog = {
  generated_at: new Date().toISOString(),
  visuals: scan('visuals', VISUAL_EXT),
  sfx: scan('sfx', AUDIO_EXT),
};

fs.writeFileSync(OUT, JSON.stringify(catalog, null, 2) + '\n', 'utf8');

console.log(
  `catalog written: ${OUT}\n` +
  `  visuals: ${catalog.visuals.length}  sfx: ${catalog.sfx.length}`
);
