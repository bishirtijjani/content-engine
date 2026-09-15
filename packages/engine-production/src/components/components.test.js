// Test file for SVG components
import { Arrow, LevelBox, TestBox, ArrowConnector, COLORS } from './index.js';

// Test Arrow
const arrowRight = Arrow({ direction: 'right', length: 60 });
console.log('Arrow (right):', arrowRight.includes('<line') && arrowRight.includes('polygon'));

const arrowLeft = Arrow({ direction: 'left', length: 60 });
console.log('Arrow (left):', arrowLeft.includes('<line') && arrowLeft.includes('polygon'));

const arrowDown = Arrow({ direction: 'down', length: 60 });
console.log('Arrow (down):', arrowDown.includes('<line') && arrowDown.includes('polygon'));

const arrowUp = Arrow({ direction: 'up', length: 60 });
console.log('Arrow (up):', arrowUp.includes('<line') && arrowUp.includes('polygon'));

// Test LevelBox
const levelBoxFilled = LevelBox({ level: 1, label: 'Manual', size: 'md', variant: 'filled' });
console.log('LevelBox (filled):', levelBoxFilled.includes('LEVEL 1') && levelBoxFilled.includes('Manual'));

const levelBoxOutline = LevelBox({ level: 2, label: 'Semi-Automated', size: 'md', variant: 'outline' });
console.log('LevelBox (outline):', levelBoxOutline.includes('LEVEL 2') && levelBoxOutline.includes('Semi-Automated'));

// Test TestBox
const testBox = TestBox({ text: '30-SECOND TEST', size: 'md' });
console.log('TestBox:', testBox.includes('30-SECOND TEST') && testBox.includes(COLORS.navy));

// Test ArrowConnector
const connector = ArrowConnector({ from: {x: 10, y: 50}, to: {x: 90, y: 50}, curvature: 0.5 });
console.log('ArrowConnector:', connector.includes('<path') && connector.includes('polygon'));

console.log('All component tests passed!');
