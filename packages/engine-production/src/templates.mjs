// templates.mjs — the on-brand graphics book.
//
// A template is one JSON file in templates/ : a name, a short description, the
// fields it expects, and the HTML + CSS to draw it. Templates use the brand
// CSS variables the assembler defines (--brand-blue, --brand-orange, ...), so
// they stay on brand without repeating any values. The agent picks a template
// by name and fills the fields; it never rewrites the graphic.
import fs from 'node:fs';
import path from 'node:path';
import { PACKAGE_ROOT } from './style.mjs';

export const TEMPLATES_DIR = path.join(PACKAGE_ROOT, 'templates');

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** List the templates available to the agent. */
export function listTemplates(dir = TEMPLATES_DIR) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        const t = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        return {
          name: t.name ?? path.basename(f, '.json'),
          description: t.description ?? '',
          frame: t.frame ?? null,
          fields: Array.isArray(t.fields) ? t.fields : [],
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Load one template by name. Throws if it is missing. */
export function loadTemplate(name, dir = TEMPLATES_DIR) {
  const p = path.join(dir, `${name}.json`);
  if (!fs.existsSync(p)) throw new Error(`template "${name}" not found in ${dir}`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/** Fill {{field}} placeholders. Unknown or missing fields become empty. */
export function fillTemplate(html, fields = {}) {
  return String(html).replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key) =>
    Object.prototype.hasOwnProperty.call(fields, key) ? esc(fields[key]) : ''
  );
}

/** Render a template to { name, frame, html, css } with fields filled in. */
export function renderTemplate(name, fields = {}, dir = TEMPLATES_DIR) {
  const t = loadTemplate(name, dir);
  return { name, frame: t.frame ?? 'center', html: fillTemplate(t.html ?? '', fields), css: t.css ?? '' };
}
