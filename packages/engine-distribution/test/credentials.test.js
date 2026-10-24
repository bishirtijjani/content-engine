// Credentials stay outside source control and are written with mode 600.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  instagramAccounts,
  instagramApp,
  loadCredentials,
  loadStoredCredentials,
  mediaHostConfig,
  readEnvFile,
  saveCredentials,
  saveInstagramToken,
  saveTikTokToken,
  tikTokConfig,
  writeEnvValues,
} from '../src/credentials.mjs';

function tempFile() {
  return path.join(mkdtempSync(path.join(tmpdir(), 'credentials-')), 'credentials.json');
}

const STORED = {
  instagram: {
    appId: 'app-id',
    appSecret: 'app-secret',
    apiVersion: 'v26.0',
    accounts: {
      creator: {
        userId: '1784',
        accessToken: 'old-token',
        expiresAt: '2026-12-21T00:00:00.000Z',
      },
    },
  },
  mediaHost: {
    provider: 's3',
    bucket: 'bucket',
    region: 'us-east-1',
    accessKeyId: 'key',
    secretAccessKey: 'secret',
  },
};

test('credentials: save writes mode 600 and load reads the same values', () => {
  const file = tempFile();
  saveCredentials(STORED, { path: file });

  if (process.platform !== 'win32') {
    assert.equal(statSync(file).mode & 0o777, 0o600);
  }
  assert.deepEqual(loadStoredCredentials({ path: file }), STORED);
});

test('credentials: an insecure file is refused', { skip: process.platform === 'win32' }, () => {
  const file = tempFile();
  saveCredentials(STORED, { path: file });
  chmodSync(file, 0o644);
  assert.throws(() => loadStoredCredentials({ path: file }), /chmod 600/);
  chmodSync(file, 0o600);
});

test('credentials: environment variables override stored values', () => {
  const file = tempFile();
  const loaded = loadCredentials({
    path: file,
    env: {
      INSTAGRAM_ACCOUNT: 'creator',
      INSTAGRAM_USER_ID: '999',
      INSTAGRAM_ACCESS_TOKEN: 'env-token',
      INSTAGRAM_TOKEN_EXPIRES_AT: '2027-01-01T00:00:00.000Z',
      MEDIA_HOST_BUCKET: 'env-bucket',
      MEDIA_HOST_ACCESS_KEY_ID: 'env-key',
      MEDIA_HOST_SECRET_ACCESS_KEY: 'env-secret',
    },
  });

  assert.equal(loaded.instagram.accounts.creator.userId, '999');
  assert.equal(loaded.instagram.accounts.creator.accessToken, 'env-token');
  assert.equal(loaded.mediaHost.bucket, 'env-bucket');
  assert.equal(loaded.mediaHost.accessKeyId, 'env-key');
});

test('credentials: a refreshed token is persisted without losing other data', () => {
  const file = tempFile();
  saveCredentials(STORED, { path: file });

  saveInstagramToken(
    'creator',
    { accessToken: 'new-token', expiresAt: '2027-02-01T00:00:00.000Z' },
    { path: file }
  );

  const stored = loadStoredCredentials({ path: file });
  assert.equal(stored.instagram.accounts.creator.accessToken, 'new-token');
  assert.equal(stored.instagram.accounts.creator.expiresAt, '2027-02-01T00:00:00.000Z');
  assert.equal(stored.instagram.accounts.creator.userId, '1784');
  assert.equal(stored.instagram.appId, 'app-id');
  assert.equal(stored.mediaHost.bucket, 'bucket');
  if (process.platform !== 'win32') {
    assert.equal(statSync(file).mode & 0o777, 0o600);
  }
});

test('credentials: account names are normalized and flat configs still work', () => {
  const accounts = instagramAccounts({
    instagram: {
      accounts: {
        Creator: { userId: '1', accessToken: 'a' },
        Clips: { userId: '2', accessToken: 'b' },
      },
    },
  });
  assert.deepEqual(Object.keys(accounts).sort(), ['clips', 'creator']);

  const flat = instagramAccounts({
    instagram: { userId: '3', accessToken: 'c', account: 'creator' },
  });
  assert.equal(flat.creator.userId, '3');

  assert.deepEqual(instagramAccounts({}), {});
});

test('credentials: app and media host config are resolved with defaults', () => {
  assert.deepEqual(instagramApp(STORED), {
    appId: 'app-id', appSecret: 'app-secret', apiVersion: 'v26.0',
  });

  const host = mediaHostConfig(STORED);
  assert.equal(host.bucket, 'bucket');
  assert.equal(host.forcePathStyle, false);
  assert.equal(host.keyPrefix, 'content-os/instagram');
  assert.equal(host.signedGetSeconds, 7200);
  assert.equal(mediaHostConfig({}), null);
});

// ============================================================================
// DEPLOYMENT .env
// ============================================================================

function tempEnv() {
  return path.join(mkdtempSync(path.join(tmpdir(), 'content-env-')), '.env');
}

test('env: read, update and append preserve comments and mode 600', () => {
  const file = tempEnv();
  writeFileSync(file, [
    '# content-os deployment',
    'MEDIA_HOST_PROVIDER=nginx',
    'INSTAGRAM_ACCESS_TOKEN=old-token',
    '',
  ].join('\n'), { mode: 0o600 });

  assert.equal(readEnvFile(file).MEDIA_HOST_PROVIDER, 'nginx');
  assert.equal(readEnvFile(file).INSTAGRAM_ACCESS_TOKEN, 'old-token');

  writeEnvValues(file, {
    INSTAGRAM_ACCESS_TOKEN: 'new-token',
    INSTAGRAM_TOKEN_EXPIRES_AT: '2027-02-01T00:00:00.000Z',
    MEDIA_HOST_ROOT_DIR: '/opt/docker/apps/content-os/media',
  });

  const updated = readEnvFile(file);
  assert.equal(updated.INSTAGRAM_ACCESS_TOKEN, 'new-token');
  assert.equal(updated.MEDIA_HOST_PROVIDER, 'nginx');
  assert.equal(updated.MEDIA_HOST_ROOT_DIR, '/opt/docker/apps/content-os/media');
  assert.match(readFileSync(file, 'utf8'), /# content-os deployment/);

  if (process.platform !== 'win32') {
    assert.equal(statSync(file).mode & 0o777, 0o600);
  }
});

test('env: values override the JSON store and process env wins', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'content-env-'));
  const envFile = path.join(dir, '.env');
  const missingJson = path.join(dir, 'missing.json');

  writeFileSync(envFile, [
    'INSTAGRAM_ACCOUNT=creator',
    'INSTAGRAM_USER_ID=from-env',
    'INSTAGRAM_ACCESS_TOKEN=env-token',
    '',
  ].join('\n'), { mode: 0o600 });

  const loaded = loadCredentials({
    path: missingJson,
    envFile,
    env: { INSTAGRAM_USER_ID: 'from-process' },
  });

  assert.equal(loaded.instagram.accounts.creator.userId, 'from-process');
  assert.equal(loaded.instagram.accounts.creator.accessToken, 'env-token');
});

test('env: a refreshed token is persisted to the .env', () => {
  const envFile = tempEnv();
  writeFileSync(envFile, 'MEDIA_HOST_PROVIDER=nginx\n', { mode: 0o600 });

  saveInstagramToken(
    'creator',
    {
      accessToken: 'refreshed-token',
      expiresAt: '2027-03-01T00:00:00.000Z',
      userId: '1784',
    },
    { envFile }
  );

  const values = readEnvFile(envFile);
  assert.equal(values.INSTAGRAM_ACCOUNT, 'creator');
  assert.equal(values.INSTAGRAM_USER_ID, '1784');
  assert.equal(values.INSTAGRAM_ACCESS_TOKEN, 'refreshed-token');
  assert.equal(values.INSTAGRAM_TOKEN_EXPIRES_AT, '2027-03-01T00:00:00.000Z');
  assert.equal(values.MEDIA_HOST_PROVIDER, 'nginx');
});

test('env: two TikTok accounts map to independent numbered slots', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'content-env-'));
  const loaded = loadCredentials({
    path: path.join(dir, 'missing.json'),
    env: {
      TIKTOK_CLIENT_KEY: 'client-key',
      TIKTOK_CLIENT_SECRET: 'client-secret',
      TIKTOK_ACCOUNT_1_NAME: 'main',
      TIKTOK_ACCOUNT_1_OPEN_ID: 'open-1',
      TIKTOK_ACCOUNT_1_ACCESS_TOKEN: 'access-1',
      TIKTOK_ACCOUNT_1_REFRESH_TOKEN: 'refresh-1',
      TIKTOK_ACCOUNT_1_EXPIRES_AT: '2026-10-23T00:00:00.000Z',
      TIKTOK_ACCOUNT_1_REFRESH_EXPIRES_AT: '2027-10-23T00:00:00.000Z',
      TIKTOK_ACCOUNT_1_PRIVACY_LEVEL: 'PUBLIC_TO_EVERYONE',
      TIKTOK_ACCOUNT_2_NAME: 'clips',
      TIKTOK_ACCOUNT_2_OPEN_ID: 'open-2',
      TIKTOK_ACCOUNT_2_ACCESS_TOKEN: 'access-2',
      TIKTOK_ACCOUNT_2_REFRESH_TOKEN: 'refresh-2',
      TIKTOK_ACCOUNT_2_EXPIRES_AT: '2026-10-23T00:00:00.000Z',
      TIKTOK_ACCOUNT_2_REFRESH_EXPIRES_AT: '2027-10-23T00:00:00.000Z',
    },
  });

  const config = tikTokConfig(loaded);
  assert.equal(config.clientKey, 'client-key');
  assert.equal(config.accounts.main.slot, 1);
  assert.equal(config.accounts.clips.slot, 2);
  assert.equal(config.accounts.main.accessToken, 'access-1');
  assert.equal(config.accounts.clips.refreshToken, 'refresh-2');
  assert.equal(config.accounts.main.privacyLevel, 'PUBLIC_TO_EVERYONE');
  assert.equal(config.accounts.clips.privacyLevel, null);
});

test('env: refreshed TikTok tokens are written back to the same slot', () => {
  const envFile = tempEnv();
  writeFileSync(envFile, [
    'TIKTOK_CLIENT_KEY=client-key',
    'TIKTOK_ACCOUNT_1_NAME=main',
    'TIKTOK_ACCOUNT_1_ACCESS_TOKEN=old',
    'TIKTOK_ACCOUNT_1_REFRESH_TOKEN=old-refresh',
    '',
  ].join('\n'), { mode: 0o600 });

  saveTikTokToken('main', {
    openId: 'open-1',
    accessToken: 'new-access',
    refreshToken: 'new-refresh',
    expiresAt: '2026-10-23T00:00:00.000Z',
    refreshExpiresAt: '2027-10-23T00:00:00.000Z',
  }, { slot: 1, envFile });

  const values = readEnvFile(envFile);
  assert.equal(values.TIKTOK_ACCOUNT_1_ACCESS_TOKEN, 'new-access');
  assert.equal(values.TIKTOK_ACCOUNT_1_REFRESH_TOKEN, 'new-refresh');
  assert.equal(values.TIKTOK_ACCOUNT_1_OPEN_ID, 'open-1');
  assert.equal(values.TIKTOK_CLIENT_KEY, 'client-key');
  assert.throws(
    () => saveTikTokToken('missing', { accessToken: 'x' }, { slot: null, envFile }),
    /no TikTok account slot/
  );
});

test('env: nginx media hosting is configured through the environment', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'content-env-'));
  const loaded = loadCredentials({
    path: path.join(dir, 'missing.json'),
    env: {
      MEDIA_HOST_PROVIDER: 'nginx',
      MEDIA_HOST_PUBLIC_BASE_URL: 'https://files.codeket.com/media',
      MEDIA_HOST_ROOT_DIR: '/opt/docker/apps/content-os/media',
      MEDIA_HOST_KEY_PREFIX: 'instagram',
      MEDIA_HOST_TTL_HOURS: '24',
    },
  });

  const host = mediaHostConfig(loaded);
  assert.deepEqual(host, {
    provider: 'nginx',
    publicBaseUrl: 'https://files.codeket.com/media',
    rootDir: '/opt/docker/apps/content-os/media',
    keyPrefix: 'instagram',
    ttlHours: 24,
  });
});
