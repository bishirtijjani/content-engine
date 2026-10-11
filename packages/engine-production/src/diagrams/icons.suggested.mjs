// icons.suggested.mjs — a short, human-curated slice of the Tabler set to put in
// front of the model, grouped by the domains scripts actually talk about.
//
// This is GUIDANCE, not a whitelist: any Tabler outline icon name is valid (the
// full library is in ICON_PATHS). The suggested list just makes the common ones
// discoverable so the model reaches for a relevant icon instead of a random one —
// or none at all. Names that are not in the installed set are filtered out, so a
// suggestion can never point at a missing icon.
import { ICON_NAMES } from './icons.mjs';

const GROUPS = {
  time: ['clock', 'clock-hour-4', 'clock-hour-9', 'calendar', 'calendar-event', 'hourglass', 'stopwatch', 'history', 'alarm'],
  money: ['currency-dollar', 'currency-euro', 'coin', 'cash', 'wallet', 'receipt', 'credit-card', 'pig-money', 'discount', 'tag'],
  data: ['chart-bar', 'chart-line', 'chart-pie', 'chart-dots', 'chart-arrows', 'trending-up', 'trending-down', 'activity', 'percentage', 'sum', 'calculator', 'graph'],
  lists: ['list', 'list-check', 'checklist', 'checkbox', 'check', 'circle-check', 'square-check', 'x', 'progress', 'dots'],
  arrows: ['arrow-right', 'arrow-left', 'arrow-up', 'arrow-down', 'arrows-right-left', 'refresh', 'reload', 'repeat', 'route', 'git-branch', 'transfer', 'chevron-right'],
  comms: ['message', 'message-circle', 'mail', 'phone', 'send', 'bell', 'bell-ring', 'at', 'share', 'broadcast'],
  people: ['user', 'users', 'user-plus', 'user-check', 'users-group', 'user-circle', 'mood-smile'],
  files: ['file-text', 'file', 'folder', 'files', 'clipboard', 'clipboard-text', 'notebook', 'book', 'article', 'note', 'download', 'upload'],
  tech: ['code', 'terminal', 'device-mobile', 'device-desktop', 'cloud', 'server', 'database', 'cpu', 'bug', 'settings', 'tool', 'key', 'lock', 'shield', 'world'],
  status: ['alert-triangle', 'alert-circle', 'info-circle', 'circle-x', 'circle-dashed', 'help', 'flame', 'circle', 'point'],
  media: ['photo', 'video', 'play', 'player-play', 'camera', 'microphone', 'music', 'volume', 'wand'],
  places: ['map-pin', 'map', 'world', 'building', 'home', 'route', 'compass'],
  growth: ['rocket', 'bulb', 'target', 'flag', 'award', 'trophy', 'star', 'sparkles', 'zap', 'trending-up', 'chart-arrows'],
};

const present = new Set(ICON_NAMES);

/** { domain: [names] } with only names that exist in the installed set. */
export const SUGGESTED_ICONS = Object.fromEntries(
  Object.entries(GROUPS).map(([domain, names]) => [domain, names.filter((n) => present.has(n))])
);
