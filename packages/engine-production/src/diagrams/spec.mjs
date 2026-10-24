// diagrams/spec.mjs — shared gates for diagram specs.
//
// A layout is refused, not patched. These helpers keep the checks uniform:
// label caps, icon membership, list bounds. No layout invents its own rules.
import { ICON_PATHS } from './icons.mjs';

export const MAX_LABEL = 30;
export const MAX_TITLE = 64;
export const MAX_NOTE = 40;

export const listOf = (v) => (Array.isArray(v) ? v : []);

export function textOf(item) {
  if (typeof item === 'string') return item;
  if (item && typeof item === 'object') return item.label ?? item.text ?? item.title ?? '';
  return '';
}

export function checkLabel(value, at, out, { max = MAX_LABEL, required = true } = {}) {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s) {
    if (required) out.push(`${at} needs a label`);
    return '';
  }
  if (s.length > max) out.push(`${at} label is too long (${s.length} chars, max ${max})`);
  return s;
}

export function checkIcon(name, at, out) {
  if (name && !ICON_PATHS[name]) out.push(`${at} icon "${name}" is not a known icon`);
}

export function checkCount(list, at, out, min, max) {
  if (list.length < min || list.length > max) {
    out.push(`${at} needs ${min}${max === min ? '' : `-${max}`} item${max === 1 ? '' : 's'} (got ${list.length})`);
  }
}

/** The minimum on-screen time a layout needs for n items (seconds). */
export function playTime(base, perItem, n) {
  return base + perItem * n;
}
