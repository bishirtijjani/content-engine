import test from 'node:test';
import assert from 'node:assert/strict';

const SCRIPT = 'file:///opt/docker/apps/content-os/repo/scripts/tiktok-auth.mjs';

test('tiktok auth: authorization URL requests user.info.basic, video.publish, and video.upload', async () => {
  const { buildAuthorizationUrl } = await import(SCRIPT);
  const url = new URL(buildAuthorizationUrl({
    clientKey: 'client-key',
    redirectUri: 'https://example.com/callback',
    state: 'state-value',
  }));

  assert.equal(url.searchParams.get('scope'), 'user.info.basic,video.publish,video.upload');
  assert.equal(url.searchParams.get('client_key'), 'client-key');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://example.com/callback');
  assert.equal(url.searchParams.get('state'), 'state-value');
});

test('tiktok auth: scope validation preserves Direct Post and supports draft upload', async () => {
  const { hasVideoPublishScope, hasVideoUploadScope } = await import(SCRIPT);

  const directScope = 'user.info.basic,video.publish';
  assert.equal(hasVideoPublishScope(directScope), true);
  assert.equal(hasVideoUploadScope(directScope), false);

  const draftScope = 'user.info.basic,video.publish,video.upload';
  assert.equal(hasVideoPublishScope(draftScope), true);
  assert.equal(hasVideoUploadScope(draftScope), true);
});

test('tiktok auth: redirect URI validation requires HTTPS', async () => {
  const { validateRedirectUri } = await import(SCRIPT);

  assert.throws(() => validateRedirectUri('http://example.com/callback'), /HTTPS/);
  assert.equal(
    validateRedirectUri('https://example.com/callback/'),
    'https://example.com/callback/'
  );
});