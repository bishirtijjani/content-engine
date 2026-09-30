// theme.mjs — the diagram theme, derived from the ONE locked style.
//
// Diagrams never hardcode brand values. They read the same config/style.json
// the rest of the production engine reads, through here. Only colours, fonts
// and the shared corner radius come from the style; sizes and positions are
// computed per diagram from the actual frame box (see layouts/).
import { loadStyle } from '../style.mjs';

/** Build the theme object a diagram layout draws with. */
export function deriveTheme(style = null) {
  const s = style ?? loadStyle();
  const brand = s?.brand ?? {};
  const colors = brand.colors ?? {};
  return {
    colors: {
      node: colors.blue || '#0f4c81',
      accent: colors.orange || '#EA580C',
      text: colors.text || '#FFFFFF',
      bg: colors.bg || '#EA580C',
    },
    fonts: {
      display: brand.fonts?.display || 'Montserrat',
      body: brand.fonts?.body || 'Plus Jakarta Sans',
    },
    radius: Number(s?.cards?.styles?.editorial?.radius) || 18,
  };
}
