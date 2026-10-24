// diagrams/theme.mjs — the diagram theme, derived from the ONE locked style.
//
// This module never defines a brand value. Colours, fonts, radii and type ratios
// come from config/style.json exactly as the snapshot recipes do. If a value is
// missing it falls back to the same defaults the rest of the engine uses.
import { loadStyle } from '../style.mjs';

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

/** Build the theme object every diagram layout draws with. */
export function deriveTheme(style = null) {
  const s = style ?? loadStyle();
  const brand = s?.brand ?? {};
  const colors = brand.colors ?? {};
  const type = s?.composition?.type ?? {};
  const ratio = (key, d) => num(type?.[key]?.ratio, d);

  return {
    colors: {
      bg: colors.bg || '#EA580C',
      blue: colors.blue || '#0f4c81',
      orange: colors.orange || '#EA580C',
      surface: colors.surface || '#F59E0B',
      text: colors.text || '#FFFFFF',
      ghost: 'rgba(255,255,255,0.14)',
      ink: 'rgba(11,18,32,0.55)',
      hairline: 'rgba(255,255,255,0.22)',
      line: 'rgba(255,255,255,0.85)',
      muted: 'rgba(255,255,255,0.62)',
    },
    fonts: {
      display: brand.fonts?.display || 'Montserrat',
      body: brand.fonts?.body || 'Plus Jakarta Sans',
      mono: brand.fonts?.mono || 'JetBrains Mono',
    },
    radius: num(s?.cards?.styles?.editorial?.radius, 18),
    // Ratios are fractions of the short canvas edge (1080), so portrait and
    // landscape share the same optical type scale.
    type: {
      kicker: ratio('kicker', 0.028),
      title: ratio('headline', 0.085),
      data: ratio('data', 0.30),
      term: ratio('term', 0.105),
      label: ratio('label', 0.040),
      footnote: ratio('footnote', 0.026),
      node: 0.038,
      meta: 0.028,
    },
    weight: { kicker: 800, title: 900, node: 800, meta: 600, body: 600 },
    connector: { width: 3, head: 26, color: 'rgba(255,255,255,0.85)', dash: '14 12' },
    motion: {
      ease: s?.composition?.motion?.ease ?? 'power2.out',
      in: num(s?.composition?.motion?.in, 0.5),
      rise: num(s?.composition?.motion?.rise, 40),
      stagger: num(s?.composition?.motion?.stagger, 0.1),
      draw: num(s?.composition?.motion?.draw, 0.7),
    },
  };
}
