// style.mjs — the single reader for the locked style.
//
// Every module that needs to know how a video looks or sounds (captions,
// assembler, mix, plan checker) reads config/style.json through here. There is
// exactly one style file. Do not hardcode brand values anywhere else.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** The engine-production package root. */
export const PACKAGE_ROOT = path.resolve(__dirname, '..');

/** The locked style file. */
export const STYLE_PATH = path.join(PACKAGE_ROOT, 'config', 'style.json');

/** Absolute path to the brand lexicon. */
export const LEXICON_PATH = path.join(PACKAGE_ROOT, 'brand', 'lexicon.json');

/** The backdrop folder (the designed base layer). */
export const BACKDROP_DIR = path.join(PACKAGE_ROOT, 'backdrop');

/**
 * Load the locked style. Pass a path to override (tests, experiments).
 * @param {string} [stylePath]
 * @returns {Object} parsed style
 */
export function loadStyle(stylePath = STYLE_PATH) {
  if (!fs.existsSync(stylePath)) {
    throw new Error(`style file not found: ${stylePath}`);
  }
  return JSON.parse(fs.readFileSync(stylePath, 'utf8'));
}

/** Resolve a style path entry (assets/templates/input/...) against the repo root. */
export function resolveStylePath(style, key) {
  const rel = style?.paths?.[key];
  if (!rel) return null;
  return path.resolve(PACKAGE_ROOT, '..', '..', rel);
}

/**
 * Read the designed backdrop SVG. Returns '' when there is none, so the
 * caller falls back to the flat brand color.
 * @param {Object} [style]
 * @returns {string} the raw SVG markup
 */
export function loadBackdrop(style = null) {
  const rel = (style ?? loadStyle())?.backdrop?.file;
  if (!rel) return '';
  const p = path.resolve(PACKAGE_ROOT, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}
