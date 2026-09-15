// Serve a content item's script in the browser with live editing.
// Edits save straight back to content_items.script.
//
// Usage: node scripts/serve-script.mjs <itemId> [--port 3848]
import { connect } from '@content-os/core';
import { generateMarkdown, serveScript } from '../src/render-script.js';

const args = process.argv.slice(2);
const itemId = Number(args[0]);
const portFlag = args.indexOf('--port');
const port = portFlag !== -1 ? Number(args[portFlag + 1]) : undefined;

if (!itemId) {
  console.error('usage: node scripts/serve-script.mjs <itemId> [--port 3848]');
  process.exit(1);
}

const db = connect();
const item = db.prepare('SELECT * FROM content_items WHERE id = ?').get(itemId);
if (!item) {
  console.error(`no content item ${itemId}`);
  db.close();
  process.exit(1);
}
if (!item.script) {
  console.error(`item ${itemId} has no script yet — the agent writes scripts before rendering`);
  db.close();
  process.exit(1);
}

const md = generateMarkdown(item.script, item);
const { server } = await serveScript(md, item.id, db, port ? { port } : {});
console.log(`SERVING item ${item.id}: ${item.title}`);
process.on('SIGINT', () => { server.close(); db.close(); process.exit(0); });
process.on('SIGTERM', () => { server.close(); db.close(); process.exit(0); });