import assert from 'node:assert/strict';
import { test } from 'node:test';
import { YouTubePublisher } from '../src/publishers/youtube.mjs';
import { createPublisherFromSettings } from '../src/publishers/index.mjs';

function res(ok, status, body, headers = {}) {
  return { ok, status, headers: { get: (h) => headers[h.toLowerCase()] ?? null }, async text() { return typeof body === 'string' ? body : JSON.stringify(body ?? {}); }, async json() { return body ?? {}; } };
}

test('YouTube factory integration', () => {
  const settings = { distribution: { accounts: [{ platform: 'youtube', account: 'main', authorized: true }] } };
  const creds = { youtube: { clientId: 'c', clientSecret: 's', accounts: { main: { accessToken: 't', expiresAt: null, privacyLevel: 'private' } } } };
  const publisher = createPublisherFromSettings({ settings, credentials: creds });
  assert.ok(publisher.publishers['youtube:main'] instanceof YouTubePublisher);
});

test('YouTube publish init+upload+process', async () => {
  const fs = await import('node:fs');
  fs.writeFileSync('/tmp/yt.mp4', Buffer.alloc(10));
  const asset = { file_path: '/tmp/yt.mp4' };
  const fetchImpl = async (url, opts) => {
    if (url.includes('uploadType=resumable')) {
      return res(true, 200, {}, { location: 'https://upload/yt' });
    }
    if (url === 'https://upload/yt') {
      return res(true, 200, { id: 'vid123' });
    }
    if (url.includes('/videos?part=status')) {
      return res(true, 200, { items: [{ status: { uploadStatus: 'processed' } }] });
    }
    return res(true, 200, {});
  };
  const pub = new YouTubePublisher({ accessToken: 't', fetchImpl, clock: () => new Date('2026-01-01T00:00:00Z') });
  const out = await pub.publish({ post: { title: 'T', caption: 'desc', scheduled_at: null }, asset, item: { id: 1 } });
  assert.equal(out.externalId, 'vid123');
  fs.unlinkSync('/tmp/yt.mp4');
});

test('YouTube processing failure stops publish', async () => {
  const fs = await import('node:fs');
  fs.writeFileSync('/tmp/yt2.mp4', Buffer.alloc(10));
  const asset = { file_path: '/tmp/yt2.mp4' };
  const fetchImpl = async (url, opts) => {
    if (url.includes('uploadType=resumable')) return res(true, 200, {}, { location: 'https://upload/yt2' });
    if (url === 'https://upload/yt2') return res(true, 200, { id: 'vidX' });
    if (url.includes('/videos?part=status')) return res(true, 200, { items: [{ status: { uploadStatus: 'failed' } }] });
    return res(true, 200, {});
  };
  const pub = new YouTubePublisher({ accessToken: 't', fetchImpl, clock: () => new Date('2026-01-01T00:00:00Z') });
  await assert.rejects(() => pub.publish({ post: { title: 'T', caption: 'desc' }, asset, item: { id: 1 } }), /processing/i);
  fs.unlinkSync('/tmp/yt2.mp4');
});