import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LinkedInPublisher } from '../src/publishers/linkedin.mjs';
import { createPublisherFromSettings } from '../src/publishers/index.mjs';

function makeFetch(responses) {
  const queue = [...responses];
  return async (url, opts) => {
    const next = queue.shift();
    if (typeof next === 'function') return next(url, opts);
    return next;
  };
}

function res(ok, status, body, headers = {}) {
  return {
    ok, status,
    headers: { get: (h) => headers[h.toLowerCase()] ?? null },
    async text() { return typeof body === 'string' ? body : JSON.stringify(body ?? {}); },
    async json() { return body ?? {}; },
  };
}

test('OAuth state validation', async () => {
  const mod = await import('../../../scripts/linkedin-auth.mjs');
  const state = mod.createOAuthState({ slot: 1, account: 'main', redirectUri: 'https://example.com/cb' });
  assert.ok(state.state);
  const consumed = mod.consumeOAuthState(state.state);
  assert.equal(consumed.account, 'main');
  assert.equal(mod.consumeOAuthState(state.state), null);
  const url = mod.buildAuthorizationUrl({ clientId: 'cid', redirectUri: 'https://example.com/cb', state: 's' });
  assert.match(url, /client_id=cid/);
  assert.match(url, /scope=openid\+profile\+w_member_social/);
});

test('LinkedIn text publish', async () => {
  const fetchImpl = makeFetch([
    res(true, 201, {}, { 'x-restli-id': 'urn:li:share:1' }),
  ]);
  const pub = new LinkedInPublisher({ memberUrn: 'urn:li:person:a', accessToken: 't', fetchImpl });
  const out = await pub.publish({ post: { caption: 'Hello', hashtags: ['#x'] }, asset: null, item: { id: 1 } });
  assert.equal(out.externalId, 'urn:li:share:1');
});

test('single image upload+publish', async () => {
  const fs = await import('node:fs');
  fs.writeFileSync('/tmp/x.png', Buffer.from([1,2,3]));
  const asset = { file_path: '/tmp/x.png' };
  const fetchImpl = makeFetch([
    res(true, 200, { value: { uploadUrl: 'https://up/img', image: 'urn:li:image:1' } }),
    res(true, 201, ''),
    res(true, 201, {}, { 'x-restli-id': 'urn:li:share:2' }),
  ]);
  const pub = new LinkedInPublisher({ memberUrn: 'urn:li:person:a', accessToken: 't', fetchImpl });
  const out = await pub.publish({ post: { caption: 'img' }, asset, item: { id: 1 }, assets: [asset] });
  assert.equal(out.externalId, 'urn:li:share:2');
  fs.unlinkSync('/tmp/x.png');
});

test('multi-image ordering', async () => {
  const fs = await import('node:fs');
  fs.writeFileSync('/tmp/a.png', Buffer.from([1]));
  fs.writeFileSync('/tmp/b.png', Buffer.from([2]));
  const a = { file_path: '/tmp/a.png' };
  const b = { file_path: '/tmp/b.png' };
  const calls = [];
  let lastBody = null;
  const fetchImpl = async (url, opts) => {
    if (url.includes('initializeUpload')) {
      const n = calls.filter((c) => c.includes('initializeUpload')).length;
      calls.push(url);
      return res(true, 200, { value: { uploadUrl: `https://up/${n}`, image: `urn:li:image:${n}` } });
    }
    if (url.startsWith('https://up/')) { calls.push(url); return res(true, 201, ''); }
    calls.push(url);
    lastBody = opts?.body;
    return res(true, 201, {}, { 'x-restli-id': 'urn:li:share:3' });
  };
  const pub = new LinkedInPublisher({ memberUrn: 'urn:li:person:a', accessToken: 't', fetchImpl });
  const out = await pub.publish({ post: { caption: 'multi' }, asset: a, item: { id: 1 }, assets: [a, b] });
  assert.equal(out.externalId, 'urn:li:share:3');
  const body = JSON.parse(lastBody);
  assert.deepEqual(body.content.multiImage.images.map((i) => i.id), ['urn:li:image:0', 'urn:li:image:1']);
  fs.unlinkSync('/tmp/a.png');
  fs.unlinkSync('/tmp/b.png');
});

test('PDF document publish', async () => {
  const fs = await import('node:fs');
  fs.writeFileSync('/tmp/d.pdf', Buffer.from('%PDF'));
  const asset = { file_path: '/tmp/d.pdf' };
  const fetchImpl = makeFetch([
    res(true, 200, { value: { uploadUrl: 'https://up/doc', document: 'urn:li:document:1' } }),
    res(true, 201, ''),
    res(true, 201, {}, { 'x-restli-id': 'urn:li:share:4' }),
  ]);
  const pub = new LinkedInPublisher({ memberUrn: 'urn:li:person:a', accessToken: 't', fetchImpl });
  const out = await pub.publish({ post: { caption: 'doc', title: 'My Doc' }, asset, item: { id: 1 }, assets: [asset] });
  assert.equal(out.externalId, 'urn:li:share:4');
  fs.unlinkSync('/tmp/d.pdf');
});

test('video upload instructions publish', async () => {
  const fs = await import('node:fs');
  fs.writeFileSync('/tmp/v.mp4', Buffer.alloc(10));
  const asset = { file_path: '/tmp/v.mp4' };
  const fetchImpl = makeFetch([
    res(true, 200, { value: { video: 'urn:li:video:1', uploadToken: '', uploadInstructions: [{ uploadUrl: 'https://up/v', firstByte: 0, lastByte: 9 }] } }),
    res(true, 200, '', { etag: 'etag1' }),
    res(true, 200, {}),
    res(true, 200, { status: 'AVAILABLE' }),
    res(true, 201, {}, { 'x-restli-id': 'urn:li:share:5' }),
  ]);
  const pub = new LinkedInPublisher({ memberUrn: 'urn:li:person:a', accessToken: 't', fetchImpl });
  const out = await pub.publish({ post: { caption: 'vid' }, asset, item: { id: 1 }, assets: [asset] });
  assert.equal(out.externalId, 'urn:li:share:5');
  fs.unlinkSync('/tmp/v.mp4');
});

test('token expiration reconnect', async () => {
  const pub = new LinkedInPublisher({
    memberUrn: 'urn:li:person:a',
    accessToken: 't',
    expiresAt: '2020-01-01T00:00:00Z',
    fetchImpl: makeFetch([]),
    clock: () => new Date('2026-01-01T00:00:00Z'),
  });
  await assert.rejects(() => pub.publish({ post: { caption: 'x' }, asset: null, item: { id: 1 } }), /expired|reconnect/i);
});

test('idempotency', async () => {
  const fetchImpl = makeFetch([]);
  const pub = new LinkedInPublisher({
    memberUrn: 'urn:li:person:a',
    accessToken: 't',
    state: { stage: 'published', postUrn: 'urn:li:share:9' },
    fetchImpl,
  });
  const out = await pub.publish({ post: { caption: 'x' }, asset: null, item: { id: 1 }, state: { stage: 'published', postUrn: 'urn:li:share:9' } });
  assert.equal(out.externalId, 'urn:li:share:9');
});

test('factory integration', () => {
  const settings = { distribution: { accounts: [{ platform: 'linkedin', account: 'main', authorized: true }] } };
  const creds = { linkedin: { clientId: 'c', clientSecret: 's', accounts: { main: { memberUrn: 'urn:li:person:x', accessToken: 't', expiresAt: null } } } };
  const publisher = createPublisherFromSettings({ settings, credentials: creds });
  assert.ok(publisher.publishers['linkedin:main'] instanceof LinkedInPublisher);
});

test('video processing failure stops publish', async () => {
  const fs = await import('node:fs');
  fs.writeFileSync('/tmp/v2.mp4', Buffer.alloc(10));
  const asset = { file_path: '/tmp/v2.mp4' };
  const fetchImpl = makeFetch([
    res(true, 200, { value: { video: 'urn:li:video:2', uploadToken: '', uploadInstructions: [{ uploadUrl: 'https://up/v2', firstByte: 0, lastByte: 9 }] } }),
    res(true, 200, '', { etag: 'etag2' }),
    res(true, 200, {}),
    res(true, 200, { status: 'PROCESSING_FAILED' }),
  ]);
  const pub = new LinkedInPublisher({ memberUrn: 'urn:li:person:a', accessToken: 't', fetchImpl });
  await assert.rejects(() => pub.publish({ post: { caption: 'vid' }, asset, item: { id: 1 }, assets: [asset] }), /processing failed/i);
  fs.unlinkSync('/tmp/v2.mp4');
});

test('profile identification export', async () => {
  const mod = await import('../../../scripts/linkedin-auth.mjs');
  assert.equal(typeof mod.fetchMemberUrn, 'function');
});