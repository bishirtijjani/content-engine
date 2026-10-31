// Publisher composition: real Instagram plus existing platform publishers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPublisherFromSettings } from '../src/publishers/index.mjs';
import { InstagramPublisher } from '../src/publishers/instagram.mjs';
import { NginxMediaHost } from '../src/media-host.mjs';

const SETTINGS = {
  distribution: {
    accounts: [
      { platform: 'instagram', account: 'creator', type: 'creator', authorized: true },
      { platform: 'tiktok', account: 'main', authorized: true },
    ],
  },
};

function credentials() {
  return {
    instagram: {
      appId: 'app-id',
      appSecret: 'app-secret',
      apiVersion: 'v26.0',
      accounts: {
        creator: {
          userId: '1784',
          accessToken: 'token',
          expiresAt: '2027-01-01T00:00:00.000Z',
        },
      },
    },
    mediaHost: {
      provider: 'nginx',
      publicBaseUrl: 'https://files.codeket.com/media',
      rootDir: mkdtempSync(path.join(tmpdir(), 'composer-media-')),
      keyPrefix: 'instagram',
      ttlHours: 24,
    },
  };
}

const tiktok = {
  async publish({ platform, account }) {
    return { externalId: `${platform}-${account}-1`, url: null };
  },
};

test('composer: builds the Instagram publisher and keeps TikTok intact', async () => {
  const publisher = createPublisherFromSettings({
    settings: SETTINGS,
    credentials: credentials(),
    extraPublishers: { 'tiktok:main': tiktok },
  });

  assert.ok(publisher.publishers['instagram:creator'] instanceof InstagramPublisher);
  assert.ok(publisher.publishers['instagram:creator'].mediaHost instanceof NginxMediaHost);
  assert.equal(publisher.publishers['tiktok:main'], tiktok);

  const result = await publisher.publish({
    platform: 'tiktok', account: 'main', post: {}, asset: {}, item: {},
  });
  assert.equal(result.externalId, 'tiktok-main-1');
});

test('composer: missing Instagram credentials do not break other platforms', async () => {
  const publisher = createPublisherFromSettings({
    settings: SETTINGS,
    credentials: { mediaHost: credentials().mediaHost },
    extraPublishers: { 'tiktok:main': tiktok },
  });

  await assert.rejects(
    publisher.publish({ platform: 'instagram', account: 'creator', post: {}, asset: {}, item: {} }),
    (err) => err.name === 'InstagramConfigError' && /no Instagram credentials/.test(err.message)
  );

  const result = await publisher.publish({
    platform: 'tiktok', account: 'main', post: {}, asset: {}, item: {},
  });
  assert.equal(result.externalId, 'tiktok-main-1');
});

test('composer: an unknown platform has a clear error', async () => {
  const publisher = createPublisherFromSettings({
    settings: SETTINGS,
    credentials: credentials(),
  });

  await assert.rejects(
    publisher.publish({ platform: 'youtube', account: 'main', post: {}, asset: {}, item: {} }),
    /no YouTube account is configured/
  );
});
