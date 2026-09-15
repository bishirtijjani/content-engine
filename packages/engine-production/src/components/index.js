// Shared SVG component library for Bishir Tijjani motion graphics
// All components use viewBox="0 0 100 100" for consistent scaling

export const COLORS = {
  orange: '#EA580C',
  navy: '#0f4c81',
  white: '#FFFFFF',
  transparent: 'transparent'
};

export const STROKE = {
  default: 2,
  emphasis: 4
};

// Arrow component - straight arrow with arrowhead
// Props: { direction: 'right'|'left'|'down'|'up', length: number, strokeWidth: number, color: string }
export function Arrow({ direction = 'right', length = 60, strokeWidth = 2, color = COLORS.navy }) {
  const shaftLength = length - 8;
  let x1, y1, x2, y2, arrowheadX, arrowheadY;
  
  switch (direction) {
    case 'right':
      x1 = 5; y1 = 50; x2 = 5 + shaftLength; y2 = 50;
      arrowheadX = x2 + 8; arrowheadY = 50;
      return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round"/>
        <polygon points="${arrowheadX},${arrowheadY - 4} ${arrowheadX},${arrowheadY + 4} ${arrowheadX + 8},${arrowheadY}" fill="${color}"/>
      </svg>`;
    case 'left':
      x1 = 95; y1 = 50; x2 = 95 - shaftLength; y2 = 50;
      arrowheadX = x2 - 8; arrowheadY = 50;
      return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round"/>
        <polygon points="${arrowheadX},${arrowheadY - 4} ${arrowheadX},${arrowheadY + 4} ${arrowheadX - 8},${arrowheadY}" fill="${color}"/>
      </svg>`;
    case 'down':
      x1 = 50; y1 = 5; x2 = 50; y2 = 5 + shaftLength;
      arrowheadX = 50; arrowheadY = y2 + 8;
      return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round"/>
        <polygon points="${arrowheadX - 4},${arrowheadY} ${arrowheadX + 4},${arrowheadY} ${arrowheadX},${arrowheadY + 8}" fill="${color}"/>
      </svg>`;
    case 'up':
      x1 = 50; y1 = 95; x2 = 50; y2 = 95 - shaftLength;
      arrowheadX = 50; arrowheadY = y2 - 8;
      return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round"/>
        <polygon points="${arrowheadX - 4},${arrowheadY} ${arrowheadX + 4},${arrowheadY} ${arrowheadX},${arrowheadY - 8}" fill="${color}"/>
      </svg>`;
  }
}

// LevelBox component - rounded rectangle with level number and label
// Props: { level: number, label: string, size: 'sm'|'md'|'lg', variant: 'filled'|'outline' }
export function LevelBox({ level = 1, label = 'Manual', size = 'md', variant = 'filled' }) {
  const sizes = {
    sm: { width: 120, height: 60, fontSize: 14, labelFontSize: 10 },
    md: { width: 160, height: 80, fontSize: 18, labelFontSize: 12 },
    lg: { width: 200, height: 100, fontSize: 22, labelFontSize: 14 }
  };
  const s = sizes[size];
  const fill = variant === 'filled' ? COLORS.orange : COLORS.transparent;
  const stroke = variant === 'filled' ? COLORS.orange : COLORS.navy;
  const textColor = variant === 'filled' ? COLORS.white : COLORS.navy;
  const labelColor = variant === 'filled' ? COLORS.white : COLORS.navy;
  
  return `<svg viewBox="0 0 ${s.width} ${s.height}" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="0" width="${s.width}" height="${s.height}" rx="12" fill="${fill}" stroke="${stroke}" stroke-width="2"/>
    <text x="${s.width / 2}" y="${s.height / 2 - 4}" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="${s.fontSize}" font-weight="900" fill="${textColor}">LEVEL ${level}</text>
    <text x="${s.width / 2}" y="${s.height / 2 + 16}" text-anchor="middle" font-family="Montserrat, sans-serif" font-size="${s.labelFontSize}" font-weight="500" fill="${labelColor}">${label}</text>
  </svg>`;
}

// TestBox component - pill-shaped box for the 30-second test
// Props: { text: string, size: 'sm'|'md'|'lg' }
export function TestBox({ text = '30-SECOND TEST', size = 'md' }) {
  const sizes = {
    sm: { width: 180, height: 50, fontSize: 14 },
    md: { width: 240, height: 60, fontSize: 18 },
    lg: { width: 300, height: 70, fontSize: 22 }
  };
  const s = sizes[size];
  
  return `<svg viewBox="0 0 ${s.width} ${s.height}" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="0" width="${s.width}" height="${s.height}" rx="${s.height / 2}" fill="${COLORS.navy}"/>
    <text x="${s.width / 2}" y="${s.height / 2 + 6}" text-anchor="middle" font-family="Montserrat, sans-serif" font-size="${s.fontSize}" font-weight="700" fill="${COLORS.white}">${text}</text>
  </svg>`;
}

// ArrowConnector - curved arrow for process flows
// Props: { from: {x,y}, to: {x,y}, curvature: number, strokeWidth: number, color: string }
export function ArrowConnector({ from = {x: 10, y: 50}, to = {x: 90, y: 50}, curvature = 0.5, strokeWidth = 2, color = COLORS.navy }) {
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2 + (curvature * 30);
  
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <path d="M${from.x},${from.y} Q${midX},${midY} ${to.x},${to.y}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round"/>
    <polygon points="${to.x - 3},${to.y - 3} ${to.x - 3},${to.y + 3} ${to.x + 5},${to.y}" fill="${color}"/>
  </svg>`;
}
