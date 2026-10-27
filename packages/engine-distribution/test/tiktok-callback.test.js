import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const SCRIPT = 'file:///opt/docker/apps/content-os/repo/scripts/tiktok-auth.mjs';

function makeResponse() {
  const res = {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name] = value; },
    end(value) { this.body = value ?? ''; },
  };
  return res;
}

test('tiktok oauth state is created, consumed once, and removed', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tiktok-oauth-'));
  process.env.CONTENT_OS_DATA_DIR = dir;
  const { createOAuthState, consumeOAuthState } = await import(SCRIPT);

  const record = createOAuthState({
    slot: 1,
    account: 'main',
    redirectUri: 'https://example.com/callback',
  });

  assert.equal(typeof record.state, 'string');
  assert.equal(record.slot, 1);
  assert.equal(record.account, 'main');

  const first = consumeOAuthState(record.state);
  assert.deepEqual(first, record);

  const second = consumeOAuthState(record.state);
  assert.equal(second, null);
});

test('tiktok oauth state expires and is not reusable', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tiktok-oauth-'));
  process.env.CONTENT_OS_DATA_DIR = dir;
  const { createOAuthState, consumeOAuthState } = await import(SCRIPT);

  const record = createOAuthState({
    slot: 1,
    account: 'main',
    redirectUri: 'https://example.com/callback',
    ttlMs: 1,
  });

  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(consumeOAuthState(record.state), null);
  assert.equal(consumeOAuthState(record.state), null);
});

test('tiktok oauth helpers validate redirect URIs and build the authorize URL', async () => {
  const { validateRedirectUri, buildAuthorizationUrl } = await import(SCRIPT);

  assert.throws(() => validateRedirectUri('http://example.com/callback'), /HTTPS/);
  assert.equal(
    validateRedirectUri('https://example.com/callback/'),
    'https://example.com/callback/'
  );

  const url = new URL(buildAuthorizationUrl({
    clientKey: 'client-key',
    redirectUri: 'https://example.com/callback',
    state: 'state-value',
  }));
  assert.equal(url.searchParams.get('client_key'), 'client-key');
  assert.equal(url.searchParams.get('scope'), 'user.info.basic,video.publish,video.upload');
  assert.equal(url.searchParams.get('state'), 'state-value');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://example.com/callback');
});

test('tiktok callback rejects missing and invalid state', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tiktok-oauth-'));
  process.env.CONTENT_OS_DATA_DIR = dir;
  const { createOAuthState, consumeOAuthState, handleCallbackRequest } = await import(SCRIPT);

  const missing = makeResponse();
  await handleCallbackRequest(
    { method: 'GET', url: '/tiktok/callback?code=abc' },
    missing,
    { readEnv: () => ({ TIKTOK_CLIENT_KEY: 'key', TIKTOK_CLIENT_SECRET: 'secret' }) }
  );
  assert.equal(missing.statusCode, 400);

  const invalid = makeResponse();
  await handleCallbackRequest(
    { method: 'GET', url: '/tiktok/callback?code=abc&state=not-a-state' },
    invalid,
    { readEnv: () => ({ TIKTOK_CLIENT_KEY: 'key', TIKTOK_CLIENT_SECRET: 'secret' }) }
  );
  assert.equal(invalid.statusCode, 400);

  const record = createOAuthState({
    slot: 1,
    account: 'main',
    redirectUri: 'https://example.com/callback',
  });
  const tiktokError = makeResponse();
  await handleCallbackRequest(
    { method: 'GET', url: `/tiktok/callback?error=access_denied&state=${record.state}` },
    tiktokError,
    { readEnv: () => ({ TIKTOK_CLIENT_KEY: 'key', TIKTOK_CLIENT_SECRET: 'secret' }) }
  );
  assert.equal(tiktokError.statusCode, 400);
});

test('tiktok callback does not expose secrets and stores a successful authorization', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tiktok-oauth-'));
  process.env.CONTENT_OS_DATA_DIR = dir;
  const { createOAuthState, consumeOAuthState, handleCallbackRequest } = await import(SCRIPT);

  const record = createOAuthState({
    slot: 1,
    account: 'main',
    redirectUri: 'https://example.com/callback',
    privacyLevel: 'SELF_ONLY',
  });

  const saved = [];
  const req = { method: 'GET', url: `/tiktok/callback?code=secret-code&state=${record.state}` };
  const res = makeResponse();
  await handleCallbackRequest(req, res, {
    readEnv: () => ({ TIKTOK_CLIENT_KEY: 'client-key', TIKTOK_CLIENT_SECRET: 'client-secret' }),
    exchangeCode: async ({ code, redirectUri }) => {
      assert.equal(code, 'secret-code');
      assert.equal(redirectUri, 'https://example.com/callback');
      return {
        openId: 'open-id',
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: '2026-10-25T00:00:00.000Z',
        refreshExpiresAt: '2027-10-25T00:00:00.000Z',
        scope: 'user.info.basic,video.publish',
      };
    },
    saveTokens: async (args) => { saved.push(args); },
    fetchCreator: async () => ({ creator_username: 'creator' }),
  });

  assert.equal(res.statusCode, 200);
  assert.match(res.body, /TikTok account connected/);
  assert.doesNotMatch(res.body, /secret-code|access-token|refresh-token|client-secret/);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].slot, 1);
  assert.equal(saved[0].account, 'main');
  assert.equal(saved[0].privacyLevel, 'SELF_ONLY');
  assert.equal(consumeOAuthState(record.state), null);
});

test('tiktok callback reports server failures without leaking details', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tiktok-oauth-'));
  process.env.CONTENT_OS_DATA_DIR = dir;
  const { createOAuthState, handleCallbackRequest } = await import(SCRIPT);

  const record = createOAuthState({
    slot: 1,
    account: 'main',
    redirectUri: 'https://example.com/callback',
  });

  const missingSecret = makeResponse();
  await handleCallbackRequest(
    { method: 'GET', url: `/tiktok/callback?code=abc&state=${record.state}` },
    missingSecret,
    { readEnv: () => ({ TIKTOK_CLIENT_KEY: 'client-key' }) }
  );
  assert.equal(missingSecret.statusCode, 500);
  assert.doesNotMatch(missingSecret.body, /client-key/);

  const exchangeFailureState = createOAuthState({
    slot: 1,
    account: 'main',
    redirectUri: 'https://example.com/callback',
  });
  const failedExchange = makeResponse();
  await handleCallbackRequest(
    { method: 'GET', url: `/tiktok/callback?code=abc&state=${exchangeFailureState.state}` },
    failedExchange,
    {
      readEnv: () => ({ TIKTOK_CLIENT_KEY: 'client-key', TIKTOK_CLIENT_SECRET: 'client-secret' }),
      exchangeCode: async () => { throw new Error('token exchange failed'); },
    }
  );
  assert.equal(failedExchange.statusCode, 500);

  const saveFailureState = createOAuthState({
    slot: 1,
    account: 'main',
    redirectUri: 'https://example.com/callback',
  });
  const failedSave = makeResponse();
  await handleCallbackRequest(
    { method: 'GET', url: `/tiktok/callback?code=abc&state=${saveFailureState.state}` },
    failedSave,
    {
      readEnv: () => ({ TIKTOK_CLIENT_KEY: 'client-key', TIKTOK_CLIENT_SECRET: 'client-secret' }),
      exchangeCode: async () => ({ openId: 'id', accessToken: 'token', refreshToken: 'refresh', expiresAt: null, refreshExpiresAt: null, scope: 'user.info.basic,video.publish' }),
      saveTokens: async () => { throw new Error('write failed'); },
    }
  );
  assert.equal(failedSave.statusCode, 500);
});

test('tiktok callback rejects unrelated methods and paths', async () => {
  const { handleCallbackRequest } = await import(SCRIPT);
  const post = makeResponse();
  await handleCallbackRequest({ method: 'POST', url: '/tiktok/callback' }, post, {});
  assert.equal(post.statusCode, 405);

  const wrongPath = makeResponse();
  await handleCallbackRequest({ method: 'GET', url: '/not-a-callback' }, wrongPath, {});
  assert.equal(wrongPath.statusCode, 404);
});