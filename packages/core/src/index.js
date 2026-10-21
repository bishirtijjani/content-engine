// @content-os/core — the shared contract.
//
// Every engine depends on this package and nothing else. The database is the
// central nervous system; this package is its API. Engines never import each
// other — they communicate exclusively through the DB.
export * from './db.js';
export * from './state.js';
export * from './gates.js';
export * from './models.js';
export * from './paths.js';
export { BaseEngine } from './engines/base.js';