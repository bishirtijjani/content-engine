// Instagram Reels publisher. The production code is exercised end to end;
// only the HTTP transport is routed to deterministic responses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { S3MediaHost } from '../src/media-host.mjs';
import {
  InstagramPublisher, composeCaption, hashCaption, selectRecoveryMatch,
} from '../src/publishers/instagram.mjs';
import { fakeFetch, graphPath, graphQuery, jsonBody } from './fake-fetch.mjs';

const NOW = '2026-10-22T12:00:00.000Z';
const VERSION = 'v26.0';

const accountRoute = {
  method: 'GET',
  match: (href) => graphPath(href) === `/${VERSION}/1784`
    && graphQuery(href).get('fields')?.includes('account_type'),
  response: { id: '1784', username: 'creator', account_type: 'CREATOR' },
};

const quotaRoute = {
  method: 'GET',
  match: (href) => graphPath(href) === `/${VERSION}/1784/content_publishing_limit`,
  response: { data: [{ quota_usage: 0, config: { quota_total: 50, quota_duration: 86400 } }] },
};

const createRoute = {
  method: 'POST',
  match: (href) => graphPath(href) === `/${VERSION}/1784/media`,
  response: { id: 'container-1' },
};

const publishRoute = {
  method: 'POST',
  match: (href) => graphPath(href) === `/${VERSION}/1784/media_publish`,
  response: { id: 'media-1' },
};

const permalinkRoute = {
  method: 'GET',
  match: (href) => graphPath(href) === `/${VERSION}/media-1`,
  response: { permalink: 'https://www.instagram.com/reel/abc/' },
};

function statusRoute(responses) {
  let index = 0;
  return {
    method: 'GET',
    match: (href) => graphPath(href) === `/${VERSION}/container-1`,
    response: () => responses[Math.min(index++, responses.length - 1)],
  };
}

function recentMediaRoute(data) {
  return {
    method: 'GET',
    match: (href) => graphPath(href) === `/${VERSION}/1784/media`,
    response: { data },
  };
}

const storageRoutes = [
  { method: 'HEAD', response: { status: 404, body: null } },
  { method: 'PUT', response: { status: 200, body: null } },
];

function harness({
  routes,
  state = null,
  expiresAt = '2027-01-01T00:00:00.000Z',
  onTokenRefresh = null,
  maxAttempts = 2,
  maxPollMs = 5000,
  pollIntervalMs = 1000,
  probeVideo = () => ({ width: 1080, height: 1920, fps: 24 }),
} = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'instagram-publisher-'));
  const file = path.join(dir, 'master.mp4');
  writeFileSync(file, 'video bytes');

  let current = new Date(NOW);
  const clock = () => new Date(current);
  const sleepCalls = [];
  const sleep = async (ms) => {
    sleepCalls.push(ms);
    current = new Date(current.getTime() + ms);
  };

  const fetchImpl = fakeFetch(routes);
  const mediaHost = new S3MediaHost({
    config: {
      bucket: 'media-bucket',
      region: 'us-east-1',
      accessKeyId: 'access-key',
      secretAccessKey: 'secret-key',
      keyPrefix: 'content-os/instagram',
    },
    fetchImpl,
    sleep,
    clock,
  });

  let publishState = state ? { ...state } : null;
  const patches = [];
  const updateState = (patch) => {
    patches.push(patch);
    publishState = patch === null ? null : { ...(publishState ?? {}), ...patch };
  };

  const publisher = new InstagramPublisher({
    account: 'creator',
    userId: '1784',
    accessToken: 'token',
    expiresAt,
    appId: 'app-id',
    appSecret: 'app-secret',
    apiVersion: VERSION,
    mediaHost,
    fetchImpl,
    sleep,
    clock,
    pollIntervalMs,
    maxPollMs,
    probeVideo,
    timeoutMs: 1000,
    maxAttempts,
    logger: null,
    onTokenRefresh,
  });

  return {
    publisher,
    fetchImpl,
    sleepCalls,
    patches,
    getState: () => publishState,
    post: {
      id: 10,
      content_item_id: 1,
      caption: 'Caption',
      hashtags: ['#tag'],
    },
    asset: {
      id: 5,
      file_path: file,
      orientation: 'portrait',
      width: 1080,
      height: 1920,
    },
    item: { id: 1 },
    updateState,
  };
}

function publish(harnessValue) {
  return harnessValue.publisher.publish({
    account: 'creator',
    post: harnessValue.post,
    asset: harnessValue.asset,
    item: harnessValue.item,
    state: harnessValue.getState(),
    updateState: harnessValue.updateState,
  });
}

function callsTo(harnessValue, method, endpoint) {
  return harnessValue.fetchImpl.calls.filter((call) =>
    call.method === method && graphPath(call.url) === `/${VERSION}${endpoint}`
  );
}

// ============================================================================
// FULL FLOW
// ============================================================================

test('instagram: creates a Reels container, polls, publishes and records the permalink', async () => {
  const h = harness({
    routes: [
      accountRoute,
      quotaRoute,
      createRoute,
      statusRoute([
        { status_code: 'IN_PROGRESS', status: 'processing' },
        { status_code: 'FINISHED' },
      ]),
      publishRoute,
      permalinkRoute,
      ...storageRoutes,
    ],
  });

  const result = await publish(h);

  assert.deepEqual(result, {
    externalId: 'media-1',
    url: 'https://www.instagram.com/reel/abc/',
    warnings: [],
  });

  const created = callsTo(h, 'POST', '/1784/media');
  assert.equal(created.length, 1);
  const body = jsonBody(created[0]);
  assert.equal(body.media_type, 'REELS');
  assert.equal(body.caption, 'Caption\n\n#tag');
  assert.equal(body.share_to_feed, true);
  assert.match(body.video_url, /^https:\/\/media-bucket\.s3\.us-east-1\.amazonaws\.com\//);
  assert.ok(new URL(body.video_url).searchParams.get('X-Amz-Signature'));

  assert.equal(callsTo(h, 'POST', '/1784/media_publish').length, 1);
  assert.equal(callsTo(h, 'GET', '/container-1').length, 2);

  const state = h.getState();
  assert.equal(state.stage, 'published');
  assert.equal(state.mediaId, 'media-1');
  assert.equal(state.permalink, 'https://www.instagram.com/reel/abc/');
});

test('instagram: resumes an existing container without creating or uploading again', async () => {
  const h = harness({
    routes: [
      accountRoute,
      statusRoute([{ status_code: 'FINISHED' }]),
      publishRoute,
      permalinkRoute,
    ],
    state: {
      stage: 'created',
      containerId: 'container-1',
      containerCreatedAt: '2026-10-22T11:55:00.000Z',
    },
  });

  const result = await publish(h);

  assert.equal(result.externalId, 'media-1');
  assert.equal(callsTo(h, 'POST', '/1784/media').length, 0);
  assert.equal(callsTo(h, 'GET', '/1784/content_publishing_limit').length, 0);
  assert.equal(h.fetchImpl.calls.filter((call) => call.method === 'PUT').length, 0);
});

test('instagram: recovers a publish whose response was lost', async () => {
  const h = harness({
    routes: [
      accountRoute,
      recentMediaRoute([{
        id: 'media-1',
        permalink: 'https://www.instagram.com/reel/abc/',
        caption: 'Caption\n\n#tag',
        timestamp: '2026-10-22T11:56:00.000Z',
      }]),
    ],
    state: {
      stage: 'publishing',
      containerId: 'container-1',
      containerCreatedAt: '2026-10-22T11:55:00.000Z',
    },
  });

  const result = await publish(h);

  assert.equal(result.externalId, 'media-1');
  assert.equal(callsTo(h, 'POST', '/1784/media_publish').length, 0);
  assert.equal(callsTo(h, 'GET', '/container-1').length, 0);
  assert.equal(h.getState().stage, 'published');
});

// ============================================================================
// TOKEN MANAGEMENT
// ============================================================================

test('instagram: refreshes a token close to expiry and uses the new token', async () => {
  const refreshed = [];
  const oauthRoute = {
    method: 'GET',
    match: (href) => graphPath(href) === `/${VERSION}/oauth/access_token`,
    response: { access_token: 'new-token', expires_in: 5184000 },
  };

  const h = harness({
    routes: [
      oauthRoute,
      accountRoute,
      quotaRoute,
      createRoute,
      statusRoute([{ status_code: 'FINISHED' }]),
      publishRoute,
      permalinkRoute,
      ...storageRoutes,
    ],
    expiresAt: '2026-10-24T00:00:00.000Z',
    onTokenRefresh: async (value) => refreshed.push(value),
  });

  const result = await publish(h);

  assert.equal(result.externalId, 'media-1');
  assert.equal(refreshed.length, 1);
  assert.equal(refreshed[0].accessToken, 'new-token');

  const oauthCall = h.fetchImpl.calls.find((call) => graphPath(call.url) === `/${VERSION}/oauth/access_token`);
  assert.equal(oauthCall.headers.Authorization, undefined);

  const accountCall = h.fetchImpl.calls.find((call) =>
    graphPath(call.url) === `/${VERSION}/1784` && graphQuery(call.url).get('fields')?.includes('account_type')
  );
  assert.equal(accountCall.headers.Authorization, 'Bearer new-token');
});

test('instagram: an invalid token asks for reauthorization', async () => {
  const h = harness({
    routes: [{
      method: 'GET',
      match: (href) => graphPath(href) === `/${VERSION}/1784`,
      response: {
        status: 400,
        body: { error: { message: 'Invalid OAuth access token', code: 190 } },
      },
    }],
  });

  await assert.rejects(
    publish(h),
    (err) => err.name === 'InstagramAuthError' && err.reauthRequired === true
  );
  assert.equal(callsTo(h, 'POST', '/1784/media').length, 0);
});

// ============================================================================
// QUOTA, RATE LIMITS, TIMEOUTS
// ============================================================================

test('instagram: a full publishing quota is refused before upload', async () => {
  const h = harness({
    routes: [
      accountRoute,
      {
        method: 'GET',
        match: (href) => graphPath(href) === `/${VERSION}/1784/content_publishing_limit`,
        response: { data: [{ quota_usage: 50, config: { quota_total: 50 } }] },
      },
    ],
  });

  await assert.rejects(publish(h), (err) => err.name === 'InstagramRateLimitError');
  assert.equal(h.fetchImpl.calls.filter((call) => call.method === 'PUT').length, 0);
  assert.equal(callsTo(h, 'POST', '/1784/media').length, 0);
});

test('instagram: retries a rate-limited container request', async () => {
  let attempts = 0;
  const racingCreate = {
    method: 'POST',
    match: (href) => graphPath(href) === `/${VERSION}/1784/media`,
    response: () => {
      attempts++;
      return attempts === 1
        ? {
            status: 429,
            headers: { 'retry-after': '0' },
            body: { error: { message: 'rate limited', code: 4 } },
          }
        : { id: 'container-1' };
    },
  };

  const h = harness({
    routes: [
      accountRoute,
      quotaRoute,
      racingCreate,
      statusRoute([{ status_code: 'FINISHED' }]),
      publishRoute,
      permalinkRoute,
      ...storageRoutes,
    ],
  });

  const result = await publish(h);

  assert.equal(result.externalId, 'media-1');
  assert.equal(attempts, 2);
  assert.ok(h.sleepCalls.includes(0), 'honors Retry-After: 0');
});

test('instagram: processing timeout is retryable and keeps the container', async () => {
  const h = harness({
    routes: [
      accountRoute,
      quotaRoute,
      createRoute,
      statusRoute([{ status_code: 'IN_PROGRESS' }]),
      ...storageRoutes,
    ],
    maxPollMs: 3000,
    pollIntervalMs: 1000,
  });

  await assert.rejects(
    publish(h),
    (err) => err.code === 'PROCESSING_TIMEOUT' && err.retryable === true
  );

  assert.equal(h.getState().containerId, 'container-1');
  assert.equal(h.getState().stage, 'processing');
  assert.equal(callsTo(h, 'GET', '/container-1').length, 4);
});

test('instagram: a failed container is cleared for a clean retry', async () => {
  const h = harness({
    routes: [
      accountRoute,
      quotaRoute,
      createRoute,
      statusRoute([{ status_code: 'ERROR', status: 'download failed' }]),
      ...storageRoutes,
    ],
  });

  await assert.rejects(
    publish(h),
    (err) => err.name === 'InstagramMediaError' && err.retryable === true
  );
  assert.equal(h.getState(), null);
});

// ============================================================================
// AMBIGUOUS PUBLISH AND PERMALINK FAILURE
// ============================================================================

test('instagram: an "already published" error is resolved by finding the media', async () => {
  let publishAttempts = 0;
  const failingPublish = {
    method: 'POST',
    match: (href) => graphPath(href) === `/${VERSION}/1784/media_publish`,
    response: () => {
      publishAttempts++;
      return {
        status: 400,
        body: { error: { message: 'Media has already been published', code: 9007 } },
      };
    },
  };
  const status = statusRoute([
    { status_code: 'FINISHED' },
    { status_code: 'PUBLISHED' },
  ]);

  const h = harness({
    routes: [
      accountRoute,
      quotaRoute,
      createRoute,
      status,
      failingPublish,
      recentMediaRoute([{
        id: 'media-1',
        permalink: 'https://www.instagram.com/reel/abc/',
        caption: 'Caption\n\n#tag',
        timestamp: '2026-10-22T12:01:00.000Z',
      }]),
      ...storageRoutes,
    ],
  });

  const result = await publish(h);

  assert.equal(result.externalId, 'media-1');
  assert.equal(publishAttempts, 1, 'never publishes twice');
  assert.equal(h.getState().stage, 'published');
});

test('instagram: a permalink failure does not undo a successful publish', async () => {
  const h = harness({
    routes: [
      accountRoute,
      quotaRoute,
      createRoute,
      statusRoute([{ status_code: 'FINISHED' }]),
      publishRoute,
      {
        method: 'GET',
        match: (href) => graphPath(href) === `/${VERSION}/media-1`,
        response: { status: 500, body: { error: { message: 'temporary' } } },
      },
      ...storageRoutes,
    ],
    maxAttempts: 1,
  });

  const result = await publish(h);

  assert.deepEqual(result, { externalId: 'media-1', url: null, warnings: [] });
  assert.equal(h.getState().stage, 'published');
  assert.equal(h.getState().mediaId, 'media-1');
});

// ============================================================================
// MEDIA PREFLIGHT AND CAPTION
// ============================================================================

test('instagram: refuses a landscape master before uploading', async () => {
  const h = harness({
    routes: [accountRoute, quotaRoute],
  });
  h.asset = { ...h.asset, orientation: 'landscape', width: 1920, height: 1080 };

  await assert.rejects(
    publish(h),
    (err) => err.name === 'InstagramMediaError' && /portrait/.test(err.message)
  );
  assert.equal(h.fetchImpl.calls.filter((call) => call.method === 'PUT').length, 0);
  assert.equal(callsTo(h, 'POST', '/1784/media').length, 0);
});

test('instagram: composes the caption from the post and its hashtags', () => {
  assert.equal(
    composeCaption({ caption: ' Hello ', hashtags: ['#one', ' #two '] }),
    'Hello\n\n#one #two'
  );
  assert.equal(composeCaption({ caption: '', hashtags: [] }), '');
});

test('instagram: enforces the 300 MB Reels limit', async () => {
  const h = harness({ routes: [accountRoute, quotaRoute] });
  const large = path.join(path.dirname(h.asset.file_path), 'large.mp4');
  writeFileSync(large, '');
  truncateSync(large, 301 * 1024 * 1024);
  h.asset.file_path = large;

  await assert.rejects(publish(h), /300 MB/);
});

test('instagram: enforces the 3 second to 15 minute Reels duration', async () => {
  const h = harness({ routes: [accountRoute, quotaRoute] });
  h.asset.duration_seconds = 901;

  await assert.rejects(publish(h), /15 minutes/);
});

test('instagram: enforces the 23-60 fps Reels range', async () => {
  const h = harness({
    routes: [accountRoute, quotaRoute],
    probeVideo: () => ({ width: 1080, height: 1920, fps: 61 }),
  });

  await assert.rejects(publish(h), /23-60 fps/);
});

test('instagram: records config/caption warnings without failing the publish', async () => {
  const h = harness({
    routes: [
      accountRoute,
      quotaRoute,
      createRoute,
      statusRoute([{ status_code: 'FINISHED' }]),
      {
        method: 'POST',
        match: (href) => graphPath(href) === `/${VERSION}/1784/media_publish`,
        response: {
          id: 'media-1',
          config_issue: 'CAPTION_NOT_ATTACHED',
          caption_add_on_attachment_status: 'POLL_CREATION_FAILURE',
        },
      },
      permalinkRoute,
      ...storageRoutes,
    ],
  });

  const result = await publish(h);

  assert.equal(result.externalId, 'media-1');
  assert.deepEqual(result.warnings, [
    'config_issue=CAPTION_NOT_ATTACHED',
    'caption_add_on=POLL_CREATION_FAILURE',
  ]);
  assert.equal(h.getState().stage, 'published');
});

test('instagram: default container polling follows Meta guidance', () => {
  const publisher = new InstagramPublisher({
    account: 'creator',
    userId: '1784',
    accessToken: 'token',
    appId: 'app-id',
    appSecret: 'app-secret',
    mediaHost: {},
    probeVideo: () => ({ fps: 24 }),
  });

  assert.equal(publisher.pollIntervalMs, 60000);
  assert.equal(publisher.maxPollMs, 300000);
});

test('instagram: recovery refuses to guess between matching media', () => {
  const expectedHash = hashCaption({ caption: 'Caption', hashtags: ['#tag'] });
  const sinceMs = Date.parse('2026-10-22T12:00:00.000Z');
  const one = [{
    id: 'media-1',
    permalink: 'https://www.instagram.com/reel/abc/',
    caption: 'Caption\n\n#tag',
    timestamp: '2026-10-22T12:01:00.000Z',
  }];

  assert.deepEqual(
    selectRecoveryMatch(one, { expectedHash, sinceMs }),
    { id: 'media-1', url: 'https://www.instagram.com/reel/abc/' }
  );
  assert.equal(
    selectRecoveryMatch([{ ...one[0], timestamp: '2026-10-22T10:00:00.000Z' }], {
      expectedHash, sinceMs,
    }),
    null,
    'media outside the attempt window is ignored'
  );

  const two = [
    one[0],
    { ...one[0], id: 'media-2', timestamp: '2026-10-22T12:02:00.000Z' },
  ];
  assert.throws(
    () => selectRecoveryMatch(two, { expectedHash, sinceMs }),
    (err) => err.code === 'AMBIGUOUS_RECOVERY' && err.retryable === false
  );
});
