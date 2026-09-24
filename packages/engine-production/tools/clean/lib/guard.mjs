// guard.mjs — the cleaner never writes over its own footage.
//
// Every output path is checked against the input files before it is written.
// Kept pure so it can be tested without touching the filesystem.
import path from 'node:path';

/** True when two paths point at the same file. */
export function samePath(a, b) {
  return path.resolve(a) === path.resolve(b);
}

/**
 * Throw if `outPath` is one of `inputs`. Returns `outPath` when it is safe.
 * @param {string} outPath
 * @param {string[]} inputs
 */
export function assertNotInput(outPath, inputs) {
  for (const input of inputs) {
    if (input && samePath(outPath, input)) {
      throw new Error(`refusing to write over an input file: ${path.basename(outPath)}`);
    }
  }
  return outPath;
}
