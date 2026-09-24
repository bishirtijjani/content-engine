// library.mjs — the library: what visuals and sounds exist, and where they are.
//
// A `visual` is a file you supply: a screenshot, a screen recording, or your own
// video. Graphics and diagrams are drawn from templates (see templates.mjs).
// The agent picks ids (e.g. "visuals/dashboard"); the engine resolves the id to
// a file. The catalog is built by tools/build-asset-catalog.mjs — never by hand.
import fs from 'node:fs';
import path from 'node:path';
import { PACKAGE_ROOT } from './style.mjs';
import { listTemplates } from './templates.mjs';

export const ASSETS_DIR = path.join(PACKAGE_ROOT, 'assets');
export const CATALOG_PATH = path.join(ASSETS_DIR, 'catalog.json');

const EMPTY = { visuals: [], sfx: [] };

/** Load the library catalog (empty if it has not been built yet). */
export function loadCatalog(catalogPath = CATALOG_PATH) {
  if (!fs.existsSync(catalogPath)) return { ...EMPTY };
  try {
    return { ...EMPTY, ...JSON.parse(fs.readFileSync(catalogPath, 'utf8')) };
  } catch {
    return { ...EMPTY };
  }
}

export function visualIds(catalog = loadCatalog()) {
  return (catalog.visuals ?? []).map((a) => a.id);
}

export function sfxIds(catalog = loadCatalog()) {
  return (catalog.sfx ?? []).map((a) => a.id);
}

function findFile(entries, id, assetsDir) {
  const entry = entries.find((a) => a.id === id);
  if (!entry) return null;
  const p = path.join(assetsDir, entry.file);
  return fs.existsSync(p) ? p : null;
}

/** Resolve a visual id to an absolute file path, or null. */
export function resolveVisualPath(id, catalog = loadCatalog(), assetsDir = ASSETS_DIR) {
  return findFile(catalog.visuals ?? [], id, assetsDir);
}

/** Resolve a sound id to an absolute file path, or null. */
export function resolveSfxPath(id, catalog = loadCatalog(), assetsDir = ASSETS_DIR) {
  return findFile(catalog.sfx ?? [], id, assetsDir);
}

/** What validatePlan() needs: the ids that may be referenced, plus template details. */
export function validationCatalog(catalog = loadCatalog()) {
  const templates = listTemplates();
  return {
    templates: templates.map((t) => t.name),
    templateIndex: Object.fromEntries(templates.map((t) => [t.name, { fields: t.fields, frame: t.frame }])),
    visuals: visualIds(catalog),
    sfx: sfxIds(catalog),
  };
}
