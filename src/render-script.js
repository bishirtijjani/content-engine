// Script Renderer — turns script data into a presentable, editable document.
//
// Like HyperFrames renders video from HTML, this renders scripts from data.
// The output is a Markdown document served in a local browser with a live
// editor. The script IS the deliverable.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import http from 'node:http';
import { exec } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML_TEMPLATE = readFileSync(path.join(__dirname, 'template.html'), 'utf8');

// ============================================================================
// MARKDOWN GENERATION
// ============================================================================

/**
 * Generate a presentable Markdown script from structured data.
 * @param {Object|string} data - { hook, script, points, cta, shot_notes, duration_hint }
 *   or a JSON string of the same, or plain text (rendered as-is)
 * @param {Object} item - content_items row (title, pillar, format, etc.)
 * @returns {string} formatted Markdown
 */
export function generateMarkdown(data, item = {}) {
  // Accept structured JSON stored in the DB (the agent writes JSON to
  // content_items.script). Fall back to plain text for raw scripts.
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        data = parsed;
      } else {
        return generateMarkdownFromText(data, item);
      }
    } catch {
      return generateMarkdownFromText(data, item);
    }
  }
  if (!data || typeof data !== 'object') {
    return generateMarkdownFromText(String(data ?? ''), item);
  }

  const lines = [];

  // Title
  lines.push(`# ${item.title || 'Untitled Script'}`);
  lines.push('');

  // Metadata bar
  const meta = [];
  if (item.pillar) meta.push(`**Pillar:** ${item.pillar}`);
  if (item.format) meta.push(`**Format:** ${item.format}`);
  if (item.hook_style) meta.push(`**Hook style:** ${item.hook_style}`);
  if (item.desired_length_seconds) meta.push(`**Length:** ${item.desired_length_seconds}s`);
  if (item.target_audience) meta.push(`**Audience:** ${item.target_audience}`);
  if (meta.length) {
    lines.push(meta.join(' &nbsp;|&nbsp; '));
    lines.push('');
  }

  lines.push('---');
  lines.push('');

  // Hook — the most important part
  if (data.hook) {
    lines.push('## Hook');
    lines.push('');
    lines.push(`> ${data.hook}`);
    lines.push('');
  }

  // Full script
  if (data.script) {
    lines.push('## Script');
    lines.push('');
    lines.push(data.script);
    lines.push('');
  }

  // Talking points
  if (data.points?.length) {
    lines.push('## Talking Points');
    lines.push('');
    for (let i = 0; i < data.points.length; i++) {
      const p = data.points[i];
      lines.push(`### ${i + 1}. ${p.title}`);
      lines.push('');
      lines.push(p.detail);
      lines.push('');
    }
  }

  // CTA
  if (data.cta) {
    lines.push('## Call to Action');
    lines.push('');
    lines.push(`**${data.cta}**`);
    lines.push('');
  }

  // Shot notes
  if (data.shot_notes) {
    lines.push('---');
    lines.push('');
    lines.push('## Shot Notes');
    lines.push('');
    lines.push(data.shot_notes);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Generate Markdown from a raw script string.
 */
export function generateMarkdownFromText(text, item = {}) {
  const lines = [];
  lines.push(`# ${item.title || 'Untitled Script'}`);
  lines.push('');
  if (item.pillar || item.format) {
    const meta = [];
    if (item.pillar) meta.push(`**Pillar:** ${item.pillar}`);
    if (item.format) meta.push(`**Format:** ${item.format}`);
    lines.push(meta.join(' &nbsp;|&nbsp; '));
    lines.push('');
  }
  lines.push('---');
  lines.push('');
  lines.push(text);
  lines.push('');
  return lines.join('\n');
}

// ============================================================================
// HTML RENDERING
// ============================================================================

/**
 * Build the full HTML page with the Markdown embedded.
 */
export function buildPage(markdown, itemId) {
  const escaped = markdown
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$');
  return HTML_TEMPLATE
    .replace('__MARKDOWN_DATA__', escaped)
    .replace('__ITEM_ID__', String(itemId ?? ''));
}

// ============================================================================
// LOCAL SERVER + BROWSER
// ============================================================================

/**
 * Serve the script in a local browser with live editing.
 * Returns the server so the caller can close it.
 *
 * @param {string} markdown - the initial Markdown content
 * @param {number} itemId - the content_items ID (for saving back)
 * @param {import('node:sqlite').DatabaseSync} db - database connection
 * @param {Object} [opts]
 * @param {number} [opts.port] - port to use (default: 3847)
 * @returns {Promise<{ server, port, url }>}
 */
export function serveScript(markdown, itemId, db, opts = {}) {
  return new Promise((resolve) => {
    const port = opts.port ?? 3847;
    let currentMarkdown = markdown;

    const server = http.createServer((req, res) => {
      // CORS headers for local dev
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      // GET — serve the page
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(buildPage(currentMarkdown, itemId));
        return;
      }

      // POST — save edits
      if (req.method === 'POST') {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          try {
            const { markdown: newMd } = JSON.parse(body);
            currentMarkdown = newMd;

            // Write back to the database
            if (db && itemId) {
              db.prepare(
                "UPDATE content_items SET script = ?, updated_at = datetime('now') WHERE id = ?"
              ).run(newMd, itemId);
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
          } catch (err) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          }
        });
        return;
      }

      res.writeHead(404);
      res.end();
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`\n  port ${port} is already in use — is another script renderer running?`);
        console.error(`  kill it or pass a different port:\n    node scripts/serve-script.mjs <id> --port 3848\n`);
      } else {
        console.error(`\n  server error: ${err.message}\n`);
      }
      process.exit(1);
    });

    server.listen(port, '127.0.0.1', () => {
      const url = `http://127.0.0.1:${port}`;
      console.log(`\n  script ready: ${url}`);
      console.log('  edit in the browser, then save (Ctrl+S or click Save)');
      console.log('  close the tab or press Ctrl+C to stop\n');

      // Open browser
      const platform = process.platform;
      const cmd = platform === 'win32' ? `start "" "${url}"`
        : platform === 'darwin' ? `open "${url}"`
        : `xdg-open "${url}"`;
      exec(cmd, () => {});

      resolve({ server, port, url });
    });
  });
}
