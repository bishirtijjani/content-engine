// Scheduling rules: timezone conversion, publishing windows, cadence.
//
// Defaults until settings change:
//   timezone            Africa/Lagos
//   days                Monday-Friday
//   time                18:00 local
//   minimum spacing     60 minutes between different content items
//   horizon             56 days
//
// settings.distribution.schedule may override any of them:
//
//   {
//     "timezone": "Africa/Lagos",
//     "schedule": {
//       "days": ["mon", "tue", "wed", "thu", "fri"],
//       "times": ["18:00"],
//       "windows": [{ "start": "17:00", "end": "19:00", "stepMinutes": 30 }],
//       "minSpacingMinutes": 60,
//       "horizonDays": 56,
//       "cadence": { "tiktok": "5x/week", "instagram": "3x/week" }
//     }
//   }
//
// Cadence falls back to settings.platforms[platform].cadence. Cadence is
// counted per content item, not per account: two TikTok accounts publishing
// the same item consume one TikTok slot.
export const DEFAULT_TIMEZONE = 'Africa/Lagos';
export const DEFAULT_DAYS = [1, 2, 3, 4, 5]; // Monday-Friday (0 = Sunday)
export const DEFAULT_MIN_SPACING_MINUTES = 60;
export const DEFAULT_HORIZON_DAYS = 56;

const WEEKDAY = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

/**
 * Resolve the scheduling settings. Invalid values throw: a bad schedule must
 * not silently publish at a different time.
 */
export function resolveScheduleConfig(settings = {}) {
  const distribution = settings.distribution ?? {};
  const schedule = distribution.schedule ?? {};

  const timezone = schedule.timezone ?? distribution.timezone ?? DEFAULT_TIMEZONE;
  assertTimeZone(timezone);

  const days = normalizeDays(schedule.days);
  const windows = normalizeWindows(schedule.windows);
  const times = normalizeTimes(schedule.times, windows.length > 0);
  const points = mergeTimePoints(times, windows);

  if (!points.length) {
    throw new Error('distribution schedule has no publishing times');
  }

  const minSpacingMinutes = numberSetting(
    schedule.minSpacingMinutes,
    DEFAULT_MIN_SPACING_MINUTES,
    'minSpacingMinutes',
    { min: 0 }
  );
  const horizonDays = integerSetting(
    schedule.horizonDays,
    DEFAULT_HORIZON_DAYS,
    'horizonDays',
    { min: 1 }
  );

  return {
    timezone,
    days,
    times: points,
    minSpacingMinutes,
    horizonDays,
    cadence: resolveCadence(settings, schedule),
  };
}

/** Every future slot in the window, in UTC, ascending. */
export function buildCandidateSlots(config, now) {
  const local = localParts(now, config.timezone);
  const slots = [];

  for (let offset = 0; offset <= config.horizonDays; offset++) {
    const date = new Date(Date.UTC(local.year, local.month - 1, local.day + offset));
    if (!config.days.has(date.getUTCDay())) continue;

    for (const point of config.times) {
      const slot = zonedTimeToUtc({
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate(),
        hour: point.hour,
        minute: point.minute,
      }, config.timezone);
      if (slot.getTime() <= now.getTime()) continue;
      slots.push(slot);
    }
  }

  slots.sort((a, b) => a.getTime() - b.getTime());
  return slots;
}

/** The local Monday-to-Monday range that contains this UTC slot. */
export function weekRangeUtc(slot, timeZone) {
  const local = localParts(slot, timeZone);
  const current = new Date(Date.UTC(local.year, local.month - 1, local.day));
  const sinceMonday = (current.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(local.year, local.month - 1, local.day - sinceMonday));
  const nextMonday = new Date(Date.UTC(
    monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate() + 7
  ));

  const start = zonedTimeToUtc({
    year: monday.getUTCFullYear(),
    month: monday.getUTCMonth() + 1,
    day: monday.getUTCDate(),
    hour: 0,
    minute: 0,
  }, timeZone);
  const end = zonedTimeToUtc({
    year: nextMonday.getUTCFullYear(),
    month: nextMonday.getUTCMonth() + 1,
    day: nextMonday.getUTCDate(),
    hour: 0,
    minute: 0,
  }, timeZone);

  return {
    start: start.toISOString(),
    end: end.toISOString(),
    key: ymd(monday),
  };
}

/** UTC instant for a wall-clock time in a timezone. */
export function zonedTimeToUtc({ year, month, day, hour = 0, minute = 0 }, timeZone) {
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let guess = naive - offsetMs(new Date(naive), timeZone);
  guess = naive - offsetMs(new Date(guess), timeZone);
  return new Date(guess);
}

/** The wall-clock parts of a UTC instant in a timezone. */
export function localParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const values = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') values[part.type] = part.value;
  }

  const year = Number(values.year);
  const month = Number(values.month);
  const day = Number(values.day);
  const hour = Number(values.hour);
  const minute = Number(values.minute);
  const second = Number(values.second);

  return {
    year, month, day, hour, minute, second,
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
  };
}

export function assertTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
  } catch {
    throw new Error(`invalid distribution timezone '${timeZone}'`);
  }
}

/** "5x/week" -> 5, "daily" -> 7, "2x/day" -> 14, unknown -> null (uncapped). */
export function parseCadence(value) {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value).trim().toLowerCase();
  if (text === 'daily') return 7;
  if (text === 'weekly') return 1;

  let match = text.match(/^(\d+)\s*(?:x\s*\/?\s*|\/\s*)?week$/);
  if (match) return Number(match[1]);

  match = text.match(/^(\d+)\s*(?:x\s*\/?\s*|\/\s*)?day$/);
  if (match) return Number(match[1]) * 7;

  match = text.match(/^(\d+)\s*(?:posts?|videos?)?\s*(?:per|a)\s*week$/);
  if (match) return Number(match[1]);

  match = text.match(/^(\d+)\s*(?:posts?|videos?)?\s*(?:per|a)\s*day$/);
  if (match) return Number(match[1]) * 7;

  return null;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function resolveCadence(settings, schedule) {
  const overrides = schedule.cadence ?? {};
  if (overrides === null || typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw new Error('distribution schedule.cadence must be an object');
  }

  const platforms = settings.platforms ?? {};
  const names = new Set([...Object.keys(overrides), ...Object.keys(platforms)]);
  const cadence = {};

  for (const name of names) {
    const platform = normalizeName(name);
    const raw = overrides[name] ?? overrides[platform] ?? platforms[name]?.cadence ?? null;
    cadence[platform] = parseCadence(raw);
  }

  return cadence;
}

function normalizeDays(raw) {
  if (raw === undefined || raw === null) return new Set(DEFAULT_DAYS);
  if (!Array.isArray(raw)) {
    throw new Error('distribution schedule.days must be an array');
  }

  const days = new Set();
  for (const value of raw) {
    if (typeof value === 'number') {
      if (!Number.isInteger(value) || value < 0 || value > 6) {
        throw new Error(`invalid publishing day '${value}' (use 0-6, 0 = Sunday)`);
      }
      days.add(value);
      continue;
    }

    const key = String(value).trim().toLowerCase().slice(0, 3);
    if (!(key in WEEKDAY)) {
      throw new Error(`invalid publishing day '${value}'`);
    }
    days.add(WEEKDAY[key]);
  }

  if (!days.size) throw new Error('distribution schedule.days must not be empty');
  return days;
}

function normalizeTimes(raw, hasWindows) {
  if (raw === undefined || raw === null) {
    return hasWindows ? [] : [{ hour: 18, minute: 0 }];
  }
  if (!Array.isArray(raw)) {
    throw new Error('distribution schedule.times must be an array');
  }
  return raw.map((value) => parseTimePoint(value, 'schedule.times'));
}

function normalizeWindows(raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new Error('distribution schedule.windows must be an array');
  }

  const points = [];
  for (const [index, window] of raw.entries()) {
    if (!window || typeof window !== 'object' || Array.isArray(window)) {
      throw new Error(`distribution schedule.windows[${index}] must be an object`);
    }

    const start = parseTimePoint(window.start, `windows[${index}].start`);
    const end = parseTimePoint(window.end, `windows[${index}].end`);
    const step = integerSetting(
      window.stepMinutes,
      30,
      `windows[${index}].stepMinutes`,
      { min: 1 }
    );

    const startMinutes = start.hour * 60 + start.minute;
    const endMinutes = end.hour * 60 + end.minute;
    if (endMinutes < startMinutes) {
      throw new Error(`distribution schedule.windows[${index}] ends before it starts`);
    }

    for (let minute = startMinutes; minute <= endMinutes; minute += step) {
      points.push({ hour: Math.floor(minute / 60), minute: minute % 60 });
    }
    if ((endMinutes - startMinutes) % step !== 0) {
      points.push({ hour: end.hour, minute: end.minute });
    }
  }
  return points;
}

function mergeTimePoints(times, windows) {
  const seen = new Set();
  const points = [];
  for (const point of [...times, ...windows]) {
    const key = `${point.hour}:${point.minute}`;
    if (seen.has(key)) continue;
    seen.add(key);
    points.push(point);
  }
  points.sort((a, b) => (a.hour * 60 + a.minute) - (b.hour * 60 + b.minute));
  return points;
}

function parseTimePoint(value, field) {
  const match = String(value ?? '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) throw new Error(`invalid ${field} value '${value}' (use HH:MM)`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) {
    throw new Error(`invalid ${field} value '${value}' (use HH:MM)`);
  }
  return { hour, minute };
}

function numberSetting(value, fallback, field, { min }) {
  if (value === undefined || value === null) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min) {
    throw new Error(`distribution schedule.${field} must be a number >= ${min}`);
  }
  return number;
}

function integerSetting(value, fallback, field, { min }) {
  if (value === undefined || value === null) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min) {
    throw new Error(`distribution schedule.${field} must be an integer >= ${min}`);
  }
  return number;
}

function offsetMs(date, timeZone) {
  const parts = localParts(date, timeZone);
  const asUtc = Date.UTC(
    parts.year, parts.month - 1, parts.day,
    parts.hour, parts.minute, parts.second
  );
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

function ymd(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeName(value) {
  return String(value ?? '').trim().toLowerCase();
}
