// fonts.mjs — the brand webfonts, embedded so a render never falls back.
//
// The render browser is a bare headless Chromium: it has no Montserrat / Plus
// Jakarta Sans / JetBrains Mono installed, so unless we hand it the files it
// silently substitutes DejaVu and the brand typography never appears. This
// module inlines the brand woff2 (variable) files as data URIs and emits one
// @font-face per role, so every composition is self-contained and deterministic
// — no network, no system fonts, no fallback.
import fs from 'node:fs';
import path from 'node:path';
import { PACKAGE_ROOT, loadStyle } from './style.mjs';

const FONT_DIR = path.join(PACKAGE_ROOT, 'brand', 'fonts');

// role -> the woff2 file in brand/fonts. The files are variable fonts, so a
// single face per family covers every weight the type scale asks for.
const FONT_FILES = {
  display: 'Montserrat.woff2',
  body: 'PlusJakarta.woff2',
  mono: 'JetBrainsMono.woff2',
};

let cached = null;

/**
 * The @font-face CSS for the brand fonts, with the woff2 inlined as data URIs.
 * Returns '' when no brand font files are present (the caller then falls back to
 * the stack in --brand-* — never a crash).
 */
export function fontFaceCss(style = null) {
  if (cached != null) return cached;
  const s = style ?? loadStyle();
  const brand = s.brand ?? {};
  const families = {
    display: brand.fonts?.display || 'Montserrat',
    body: brand.fonts?.body || 'Plus Jakarta Sans',
    mono: brand.fonts?.mono || 'JetBrains Mono',
  };
  const faces = [];
  for (const [role, file] of Object.entries(FONT_FILES)) {
    const p = path.join(FONT_DIR, file);
    if (!fs.existsSync(p)) continue;
    const b64 = fs.readFileSync(p).toString('base64');
    faces.push(
      `      @font-face { font-family: '${families[role]}'; font-style: normal; ` +
      `font-weight: 100 900; font-display: block; ` +
      `src: url(data:font/woff2;base64,${b64}) format('woff2'); }`
    );
  }
  cached = faces.join('\n');
  return cached;
}
