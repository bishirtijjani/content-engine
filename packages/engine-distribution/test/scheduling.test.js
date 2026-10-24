// Distribution scheduling — timezone, cadence, collisions, deferral, retries.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initDb } from '@content-os/core';
import { DistributionEngine } from '../src/index.js';
import {
  buildCandidateSlots,
  localParts,
  parseCadence,
  resolveScheduleConfig,
  weekRangeUtc,
  zonedTimeToUtc,
} from '../src/scheduling.mjs';

const NOW = '2026-10-21T12:00:00.000Z'; // Wednesday 13:00 in Lagos
const clock = () => new Date(NOW);

const FIRST_SLOT = '2026-10-21T17:00:00.000Z';   // Wed 18:00 Lagos
const SECOND_SLOT = '2026-10-22T17:00:00.000Z';  // Thu 18:00 Lagos
const MONDAY_SLOT = '2026-10-26T17:00:00.000Z';  // Mon 18:00 Lagos
const NEXT_MONDAY_SLOT = '2026-11-02T17:00:00.000Z';

function freshDb() {
  const dir = mkdtempSync(path.join(tmpdir(), 'distribution-schedule-'));
  return initDb(path.join(dir, 'test.db'));
}

function seedItem(db, { title = 'Item', status = 'scheduled' } = {}) {
  const res = db.prepare(
    "INSERT INTO content_items (title, status, pillar) VALUES (?, ?, 'workflow-automation')"
  ).run(title, status);
  return Number(res.lastInsertRowid);
}

function seedAsset(db, itemId, status = 'approved') {
  const res = db.prepare(
    "INSERT INTO assets (content_item_id, platform, file_path, status) " +
    "VALUES (?, 'original', '/tmp/master.mp4', ?)"
  ).run(itemId, status);
  return Number(res.lastInsertRowid);
}

function seedPost(db, itemId, {
  platform,
  account = 'default',
  status = 'scheduled',
  scheduledAt = null,
  assetId = null,
}) {
  const res = db.prepare(
    'INSERT INTO posts (content_item_id, asset_id, platform, account, status, caption, scheduled_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(itemId, assetId, platform, account, status, 'caption', scheduledAt);
  return Number(res.lastInsertRowid);
}

function addCalendarEntry(db, {
  date, itemId, postId, platform = 'tiktok', kind = 'publish', status = 'planned',
}) {
  const res = db.prepare(
    'INSERT INTO calendar_entries (date, kind, platform, content_item_id, post_id, status) ' +
    'VALUES (?, ?, ?, ?, ?, ?)'
  ).run(date, kind, platform, itemId, postId, status);
  return Number(res.lastInsertRowid);
}

function setSetting(db, key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ' +
    'ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, JSON.stringify(value));
}

function postsOf(db, itemId) {
  return db.prepare('SELECT * FROM posts WHERE content_item_id = ? ORDER BY id').all(itemId);
}

function calendarRows(db, itemId = null) {
  if (itemId === null) {
    return db.prepare("SELECT * FROM calendar_entries WHERE kind = 'publish' ORDER BY id").all();
  }
  return db.prepare(
    "SELECT * FROM calendar_entries WHERE kind = 'publish' AND content_item_id = ? ORDER BY id"
  ).all(itemId);
}

// ============================================================================
// TIMEZONE, DEFAULTS, CADENCE
// ============================================================================

test('scheduling: converts wall time to UTC and handles a DST zone', () => {
  assert.equal(
    zonedTimeToUtc({ year: 2026, month: 10, day: 21, hour: 18, minute: 0 }, 'Africa/Lagos')
      .toISOString(),
    '2026-10-21T17:00:00.000Z'
  );
  assert.equal(
    zonedTimeToUtc({ year: 2026, month: 1, day: 15, hour: 18, minute: 0 }, 'Europe/London')
      .toISOString(),
    '2026-01-15T18:00:00.000Z'
  );
  assert.equal(
    zonedTimeToUtc({ year: 2026, month: 7, day: 15, hour: 18, minute: 0 }, 'Europe/London')
      .toISOString(),
    '2026-07-15T17:00:00.000Z'
  );

  const parts = localParts(new Date(FIRST_SLOT), 'Africa/Lagos');
  assert.equal(parts.hour, 18);
  assert.equal(parts.weekday, 3);
});

test('scheduling: defaults to weekdays at 18:00 Lagos with 60 minute spacing', () => {
  const config = resolveScheduleConfig({});
  assert.equal(config.timezone, 'Africa/Lagos');
  assert.deepEqual([...config.days], [1, 2, 3, 4, 5]);
  assert.deepEqual(config.times, [{ hour: 18, minute: 0 }]);
  assert.equal(config.minSpacingMinutes, 60);
  assert.equal(config.horizonDays, 56);

  assert.equal(parseCadence('5x/week'), 5);
  assert.equal(parseCadence('3x/week'), 3);
  assert.equal(parseCadence('daily'), 7);
  assert.equal(parseCadence('2x/day'), 14);
  assert.equal(parseCadence('weekly'), 1);
  assert.equal(parseCadence('bogus'), null);
});

test('scheduling: cadence comes from settings.platforms and can be overridden', () => {
  const base = resolveScheduleConfig({
    platforms: {
      tiktok: { cadence: '5x/week' },
      instagram: { cadence: '3x/week' },
    },
  });
  assert.equal(base.cadence.tiktok, 5);
  assert.equal(base.cadence.instagram, 3);

  const overridden = resolveScheduleConfig({
    platforms: { tiktok: { cadence: '5x/week' } },
    distribution: { schedule: { cadence: { tiktok: '1x/week' } } },
  });
  assert.equal(overridden.cadence.tiktok, 1);
});

test('scheduling: candidate slots skip weekends and expand time windows', () => {
  const config = resolveScheduleConfig({
    distribution: {
      schedule: {
        windows: [{ start: '17:00', end: '18:00', stepMinutes: 30 }],
      },
    },
  });
  const slots = buildCandidateSlots(config, new Date(NOW));

  assert.deepEqual(
    slots.slice(0, 3).map((slot) => slot.toISOString()),
    [
      '2026-10-21T16:00:00.000Z',
      '2026-10-21T16:30:00.000Z',
      '2026-10-21T17:00:00.000Z',
    ]
  );
  assert.ok(
    slots.every((slot) => ![0, 6].includes(localParts(slot, config.timezone).weekday)),
    'no weekend slots'
  );
});

test('scheduling: the configured timezone changes the UTC slot', () => {
  const db = freshDb();
  const itemId = seedItem(db);
  seedAsset(db, itemId);
  seedPost(db, itemId, { platform: 'tiktok', account: 'main' });
  setSetting(db, 'distribution', {
    timezone: 'Europe/London',
    schedule: { days: ['wed'], horizonDays: 1 },
  });

  // 2026-01-14 is a Wednesday, winter: London is UTC+0, Lagos would be UTC+1.
  const engine = new DistributionEngine(db, {
    clock: () => new Date('2026-01-14T12:00:00.000Z'),
  });
  engine.schedule();

  assert.equal(postsOf(db, itemId)[0].scheduled_at, '2026-01-14T18:00:00.000Z');
  db.close();
});

// ============================================================================
// ONE SLOT PER ITEM, ONE ROW PER ACCOUNT
// ============================================================================

test('schedule: every account of an item shares one slot with its own calendar row', () => {
  const db = freshDb();
  const itemId = seedItem(db);
  const assetId = seedAsset(db, itemId);
  const main = seedPost(db, itemId, { platform: 'tiktok', account: 'main', assetId });
  const clips = seedPost(db, itemId, { platform: 'tiktok', account: 'clips', assetId });
  const creator = seedPost(db, itemId, { platform: 'instagram', account: 'creator', assetId });
  setSetting(db, 'platforms', {
    tiktok: { cadence: '5x/week' },
    instagram: { cadence: '3x/week' },
  });

  const result = new DistributionEngine(db, { clock }).schedule();

  assert.equal(result.processed, 1);
  assert.equal(result.scheduled, 3);
  assert.deepEqual(
    [...new Set(postsOf(db, itemId).map((post) => post.scheduled_at))],
    [FIRST_SLOT]
  );

  const rows = calendarRows(db, itemId);
  assert.equal(rows.length, 3);
  assert.deepEqual([...new Set(rows.map((row) => row.date))], [FIRST_SLOT]);
  assert.deepEqual(
    rows.map((row) => row.post_id).sort((a, b) => a - b),
    [main, clips, creator].sort((a, b) => a - b)
  );
  assert.ok(rows.every((row) => row.status === 'planned'));
  db.close();
});

test('schedule: repeated runs keep the slot and add no calendar rows', () => {
  const db = freshDb();
  const itemId = seedItem(db);
  seedAsset(db, itemId);
  seedPost(db, itemId, { platform: 'tiktok', account: 'main' });
  seedPost(db, itemId, { platform: 'instagram', account: 'creator' });

  const engine = new DistributionEngine(db, { clock });
  engine.schedule();
  const before = calendarRows(db, itemId);

  const second = engine.schedule();

  assert.equal(second.scheduled, 0);
  assert.equal(second.preserved, 2);
  assert.deepEqual(calendarRows(db, itemId), before);
  assert.deepEqual(
    [...new Set(postsOf(db, itemId).map((post) => post.scheduled_at))],
    [FIRST_SLOT]
  );
  db.close();
});

// ============================================================================
// PRESERVATION, PAST SLOTS, PUBLISHED AND SKIPPED POSTS
// ============================================================================

test('schedule: keeps a valid future slot and repairs a missing calendar row', () => {
  const db = freshDb();
  const itemId = seedItem(db);
  seedAsset(db, itemId);
  const future = '2026-10-30T17:00:00.000Z';
  seedPost(db, itemId, { platform: 'tiktok', account: 'main', scheduledAt: future });

  const result = new DistributionEngine(db, { clock }).schedule();

  assert.equal(result.preserved, 1);
  assert.equal(result.scheduled, 0);
  assert.equal(postsOf(db, itemId)[0].scheduled_at, future);
  const rows = calendarRows(db, itemId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, future);
  assert.equal(rows[0].status, 'planned');
  db.close();
});

test('schedule: reschedules a past slot and marks the old row missed', () => {
  const db = freshDb();
  const itemId = seedItem(db);
  seedAsset(db, itemId);
  const past = '2026-10-14T17:00:00.000Z';
  const postId = seedPost(db, itemId, {
    platform: 'tiktok', account: 'main', scheduledAt: past,
  });
  addCalendarEntry(db, { date: past, itemId, postId });

  const result = new DistributionEngine(db, { clock }).schedule();

  assert.equal(result.scheduled, 1);
  assert.equal(postsOf(db, itemId)[0].scheduled_at, FIRST_SLOT);

  const rows = calendarRows(db, itemId);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].status, 'missed');
  assert.equal(rows[0].date, past);
  assert.equal(rows[1].status, 'planned');
  assert.equal(rows[1].date, FIRST_SLOT);
  db.close();
});

test('schedule: never touches a published post or its calendar row', () => {
  const db = freshDb();
  const itemId = seedItem(db);
  seedAsset(db, itemId);
  const publishedAt = '2026-10-10T17:00:00.000Z';
  const published = seedPost(db, itemId, {
    platform: 'tiktok', account: 'main', status: 'published', scheduledAt: publishedAt,
  });
  const active = seedPost(db, itemId, { platform: 'instagram', account: 'creator' });
  addCalendarEntry(db, {
    date: publishedAt, itemId, postId: published, platform: 'tiktok', status: 'published',
  });

  const result = new DistributionEngine(db, { clock }).schedule();

  assert.equal(result.scheduled, 1);
  const rowsForPublished = calendarRows(db, itemId)
    .filter((row) => row.post_id === published);
  assert.equal(rowsForPublished.length, 1);
  assert.equal(rowsForPublished[0].status, 'published');
  assert.equal(rowsForPublished[0].date, publishedAt);
  assert.equal(calendarRows(db, itemId).filter((row) => row.post_id === active).length, 1);
  db.close();
});

test('schedule: an item with only published or skipped posts is skipped', () => {
  const db = freshDb();
  const itemId = seedItem(db);
  seedAsset(db, itemId);
  seedPost(db, itemId, { platform: 'tiktok', account: 'main', status: 'published' });
  seedPost(db, itemId, { platform: 'instagram', account: 'creator', status: 'skipped' });

  const result = new DistributionEngine(db, { clock }).schedule();

  assert.equal(result.skipped, 1);
  assert.equal(calendarRows(db, itemId).length, 0);
  db.close();
});

test('schedule: a skipped post gets no slot and its future plan is dropped', () => {
  const db = freshDb();
  const itemId = seedItem(db);
  seedAsset(db, itemId);
  const active = seedPost(db, itemId, { platform: 'tiktok', account: 'main' });
  const skippedAt = '2026-10-23T17:00:00.000Z';
  const skipped = seedPost(db, itemId, {
    platform: 'instagram', account: 'creator',
    status: 'skipped', scheduledAt: skippedAt,
  });
  addCalendarEntry(db, {
    date: skippedAt, itemId, postId: skipped, platform: 'instagram',
  });

  const result = new DistributionEngine(db, { clock }).schedule();

  assert.equal(result.missed, 1);
  assert.equal(postsOf(db, itemId).find((post) => post.id === skipped).scheduled_at, null);

  const rows = calendarRows(db, itemId);
  assert.equal(rows.filter((row) => row.post_id === skipped)[0].status, 'missed');
  assert.equal(rows.filter((row) => row.post_id === active).length, 1);
  assert.equal(rows.filter((row) => row.post_id === active)[0].date, FIRST_SLOT);
  db.close();
});

// ============================================================================
// COLLISIONS, SPACING, CADENCE
// ============================================================================

test('schedule: skips a slot held by another item and preserves that item', () => {
  const db = freshDb();
  const first = seedItem(db, { title: 'First' });
  const second = seedItem(db, { title: 'Second' });
  seedAsset(db, first);
  seedAsset(db, second);
  seedPost(db, first, { platform: 'tiktok', account: 'main' });
  const secondPost = seedPost(db, second, {
    platform: 'tiktok', account: 'main', scheduledAt: FIRST_SLOT,
  });
  addCalendarEntry(db, { date: FIRST_SLOT, itemId: second, postId: secondPost });

  const result = new DistributionEngine(db, { clock }).schedule();

  assert.equal(result.scheduled, 1);
  assert.equal(result.preserved, 1);
  assert.equal(postsOf(db, first)[0].scheduled_at, SECOND_SLOT);
  assert.equal(postsOf(db, second)[0].scheduled_at, FIRST_SLOT);
  db.close();
});

test('schedule: a blocked slot with no alternative is cleared, not published', () => {
  const db = freshDb();
  const first = seedItem(db, { title: 'First' });
  const second = seedItem(db, { title: 'Second' });
  seedAsset(db, first);
  seedAsset(db, second);
  const firstPost = seedPost(db, first, {
    platform: 'tiktok', account: 'main', scheduledAt: FIRST_SLOT,
  });
  addCalendarEntry(db, { date: FIRST_SLOT, itemId: first, postId: firstPost });
  seedPost(db, second, {
    platform: 'tiktok', account: 'main', scheduledAt: FIRST_SLOT,
  });
  setSetting(db, 'distribution', {
    schedule: { days: ['wed'], horizonDays: 1 },
  });

  const result = new DistributionEngine(db, { clock }).schedule();

  assert.equal(result.preserved, 1);
  assert.equal(result.deferred, 1);
  assert.equal(postsOf(db, first)[0].scheduled_at, FIRST_SLOT);
  assert.equal(postsOf(db, second)[0].scheduled_at, null);
  db.close();
});

test('schedule: enforces minimum spacing between different items', () => {
  const db = freshDb();
  const first = seedItem(db, { title: 'First' });
  const second = seedItem(db, { title: 'Second' });
  seedAsset(db, first);
  seedAsset(db, second);
  seedPost(db, first, { platform: 'tiktok', account: 'main' });
  seedPost(db, second, { platform: 'tiktok', account: 'main' });
  setSetting(db, 'distribution', {
    schedule: {
      days: ['wed', 'thu'],
      times: ['18:00', '19:00'],
      minSpacingMinutes: 90,
      horizonDays: 2,
    },
  });

  new DistributionEngine(db, { clock }).schedule();

  assert.equal(postsOf(db, first)[0].scheduled_at, FIRST_SLOT);
  assert.equal(
    postsOf(db, second)[0].scheduled_at,
    SECOND_SLOT,
    'Wed 19:00 is 60 minutes away; the 90 minute rule pushes to Thursday'
  );
  db.close();
});

test('schedule: cadence caps the batch and defers the rest deterministically', () => {
  const db = freshDb();
  const first = seedItem(db, { title: 'First' });
  const second = seedItem(db, { title: 'Second' });
  const third = seedItem(db, { title: 'Third' });
  for (const itemId of [first, second, third]) {
    seedAsset(db, itemId);
    seedPost(db, itemId, { platform: 'tiktok', account: 'main' });
    seedPost(db, itemId, { platform: 'instagram', account: 'creator' });
  }
  setSetting(db, 'platforms', {
    tiktok: { cadence: '5x/week' },
    instagram: { cadence: '1x/week' },
  });
  setSetting(db, 'distribution', { schedule: { horizonDays: 6 } });

  const firstRun = new DistributionEngine(db, { clock }).schedule();

  assert.equal(firstRun.scheduled, 4, 'two items, two posts each');
  assert.equal(firstRun.deferred, 1);
  assert.equal(postsOf(db, first)[0].scheduled_at, FIRST_SLOT);
  assert.equal(postsOf(db, second)[0].scheduled_at, MONDAY_SLOT);
  assert.equal(postsOf(db, third)[0].scheduled_at, null);

  // Longer horizon on the next run picks up the deferred item, in id order.
  setSetting(db, 'distribution', { schedule: { horizonDays: 21 } });
  const secondRun = new DistributionEngine(db, { clock }).schedule();

  assert.equal(secondRun.scheduled, 2);
  assert.equal(secondRun.deferred, 0);
  assert.equal(postsOf(db, first)[0].scheduled_at, FIRST_SLOT);
  assert.equal(postsOf(db, second)[0].scheduled_at, MONDAY_SLOT);
  assert.equal(postsOf(db, third)[0].scheduled_at, NEXT_MONDAY_SLOT);
  db.close();
});

// ============================================================================
// ASSETS AND DRY RUN
// ============================================================================

test('schedule: an item with no approved asset is skipped', () => {
  const db = freshDb();
  const itemId = seedItem(db);
  seedAsset(db, itemId, 'review');
  seedPost(db, itemId, { platform: 'tiktok', account: 'main' });

  const result = new DistributionEngine(db, { clock }).schedule();

  assert.equal(result.skipped, 1);
  assert.equal(result.scheduled, 0);
  assert.equal(postsOf(db, itemId)[0].scheduled_at, null);
  assert.equal(calendarRows(db, itemId).length, 0);
  db.close();
});

test('schedule: dry run returns placements without writing', () => {
  const db = freshDb();
  const itemId = seedItem(db);
  seedAsset(db, itemId);
  seedPost(db, itemId, { platform: 'tiktok', account: 'main' });
  seedPost(db, itemId, { platform: 'instagram', account: 'creator' });

  const result = new DistributionEngine(db, { clock }).schedule({ dryRun: true });

  assert.equal(result.scheduled, 2);
  assert.ok(postsOf(db, itemId).every((post) => post.scheduled_at === null));
  assert.equal(calendarRows(db, itemId).length, 0);
  db.close();
});
