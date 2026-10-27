// TikTok Content Posting API publisher. The production code runs end to end;
// only the HTTP transport is routed to deterministic responses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  TikTokPublisher, composeTikTokTitle, planChunks,
} from '../src/publishers/tiktok.mjs';
import { createPublisherFromSettings } from '../src/publishers/index.mjs';
import { fakeFetch } from './fake-fetch.mjs';

const NOW = '2026-10-22T12:00:00.000Z';

function videoFile(size = 1024 * 1024) {
  const dir = mkdtempSync(path.join(tmpdir(), 'tiktok-publisher-'));
  const file = path.join(dir, 'master.mp4');
  writeFileSync(file, Buffer.alloc(size, 1));
  return file;
}

const creatorRoute = {
  method: 'POST',
  match: (href) => new URL(href).pathname === '/v2/post/publish/creator_info/query/',
  response: {
    data: {
      creator_username: 'creator',
      creator_nickname: 'Creator',
      privacy_level_options: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'],
      max_video_post_duration_sec: 600,
    },
    error: { code: 'ok', message: '', log_id: 'log' },
  },
};

const initRoute = {
  method: 'POST',
  match: (href) => new URL(href).pathname === '/v2/post/publish/video/init/',
  response: {
    data: {
      publish_id: 'pub-1',
      upload_url: 'https://upload.test/video?token=secret',
    },
    error: { code: 'ok', message: '', log_id: 'log' },
  },
};

const uploadRoute = {
  method: 'PUT',
  match: (href) => new URL(href).host === 'upload.test',
  response: { status: 201, body: null },
};

const inboxInitRoute = {
  method: 'POST',
  match: (href) => new URL(href).pathname === '/v2/post/publish/inbox/video/init/',
  response: {
    data: {
      publish_id: 'draft-1',
      upload_url: 'https://upload.test/video?token=secret',
    },
    error: { code: 'ok', message: '', log_id: 'log' },
  },
};

const statusRoute = (data) => ({
  method: 'POST',
  match: (href) => new URL(href).pathname === '/v2/post/publish/status/fetch/',
  response: { data, error: { code: 'ok', message: '', log_id: 'log' } },
});

function statusSequence(responses) {
  let index = 0;
  return {
    method: 'POST',
    match: (href) => new URL(href).pathname === '/v2/post/publish/status/fetch/',
    response: () => ({
      data: responses[Math.min(index++, responses.length - 1)],
      error: { code: 'ok', message: '', log_id: 'log' },
    }),
  };
}

function harness({
  routes,
  state = null,
  expiresAt = '2099-01-01T00:00:00.000Z',
  refreshExpiresAt = '2099-01-01T00:00:00.000Z',
  onTokenRefresh = null,
  maxAttempts = 3,
  maxPollMs = 5000,
  pollIntervalMs = 1000,
  mode = 'direct',
} = {}) {
  const file = videoFile();
  let current = new Date(NOW);
  const clock = () => new Date(current);
  const sleep = async (ms) => {
    current = new Date(current.getTime() + ms);
  };
  const fetchImpl = fakeFetch(routes);

  let publishState = state ? { ...state } : null;
  const patches = [];
  const updateState = (patch) => {
    patches.push(patch);
    publishState = patch === null ? null : { ...(publishState ?? {}), ...patch };
  };

  const publisher = new TikTokPublisher({
    account: 'main',
    slot: 1,
    clientKey: 'client-key',
    clientSecret: 'client-secret',
    openId: 'open-id',
    accessToken: 'token',
    refreshToken: 'refresh-token',
    expiresAt,
    refreshExpiresAt,
    fetchImpl,
    sleep,
    clock,
    pollIntervalMs,
    maxPollMs,
    timeoutMs: 1000,
    maxAttempts,
    privacyLevel: 'PUBLIC_TO_EVERYONE',
    mode,
    onTokenRefresh,
    logger: null,
  });

  return {
    publisher,
    fetchImpl,
    patches,
    getState: () => publishState,
    updateState,
    post: { caption: 'Caption', hashtags: ['#tag'] },
    asset: {
      file_path: file,
      duration_seconds: 86,
      width: 1080,
      height: 1920,
    },
    item: { id: 1 },
  };
}

function publish(h) {
  return h.publisher.publish({
    account: 'main',
    post: h.post,
    asset: h.asset,
    item: h.item,
    state: h.getState(),
    updateState: h.updateState,
  });
}

test('tiktok: direct post uploads one chunk, polls, and records the post', async () => {
  const h = harness({
    routes: [
      creatorRoute,
      initRoute,
      uploadRoute,
      statusSequence([
        { status: 'PROCESSING_UPLOAD' },
        { status: 'PUBLISH_COMPLETE', publicaly_available_post_id: [12345] },
      ]),
    ],
  });

  const result = await publish(h);

  assert.deepEqual(result, {
    externalId: '12345',
    url: 'https://www.tiktok.com/@creator/video/12345',
  });

  const init = h.fetchImpl.calls.find((call) =>
    new URL(call.url).pathname === '/v2/post/publish/video/init/'
  );
  const body = JSON.parse(init.body);
  assert.equal(body.post_info.title, 'Caption\n\n#tag');
  assert.equal(body.post_info.privacy_level, 'PUBLIC_TO_EVERYONE');
  assert.deepEqual(body.source_info, {
    source: 'FILE_UPLOAD',
    video_size: 1024 * 1024,
    chunk_size: 1024 * 1024,
    total_chunk_count: 1,
  });

  const upload = h.fetchImpl.calls.find((call) => call.method === 'PUT');
  assert.equal(upload.headers['Content-Range'], 'bytes 0-1048575/1048576');
  assert.equal(upload.headers['Content-Type'], 'video/mp4');
  assert.equal(h.getState().stage, 'published');
  assert.equal(h.getState().postId, 12345);
});

test('tiktok: refreshes an access token and persists the new pair to the callback', async () => {
  const oauthRoute = {
    method: 'POST',
    match: (href) => new URL(href).pathname === '/v2/oauth/token/',
    response: {
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      expires_in: 86400,
      refresh_expires_in: 31536000,
      open_id: 'open-id',
      scope: 'user.info.basic,video.publish',
    },
  };
  const refreshed = [];
  const h = harness({
    routes: [
      oauthRoute,
      creatorRoute,
      initRoute,
      uploadRoute,
      statusRoute({ status: 'PUBLISH_COMPLETE', publicaly_available_post_id: [777] }),
    ],
    expiresAt: '2026-10-22T12:30:00.000Z',
    onTokenRefresh: async (tokens) => refreshed.push(tokens),
  });

  const result = await publish(h);

  assert.equal(result.externalId, '777');
  assert.equal(refreshed.length, 1);
  assert.equal(refreshed[0].accessToken, 'new-access');
  assert.equal(refreshed[0].refreshToken, 'new-refresh');
  assert.equal(refreshed[0].slot, 1);

  const oauth = h.fetchImpl.calls.find((call) => new URL(call.url).pathname === '/v2/oauth/token/');
  const form = new URLSearchParams(oauth.body);
  assert.equal(form.get('grant_type'), 'refresh_token');
  assert.equal(form.get('refresh_token'), 'refresh-token');

  const creator = h.fetchImpl.calls.find((call) =>
    new URL(call.url).pathname === '/v2/post/publish/creator_info/query/'
  );
  assert.equal(creator.headers.Authorization, 'Bearer new-access');
});

test('tiktok: unaudited public direct post is a clear audit blocker', async () => {
  const h = harness({
    routes: [
      creatorRoute,
      {
        method: 'POST',
        match: (href) => new URL(href).pathname === '/v2/post/publish/video/init/',
        response: {
          status: 403,
          body: {
            error: {
              code: 'unaudited_client_can_only_post_to_private_accounts',
              message: 'Unaudited clients can only post to private accounts.',
              log_id: 'log',
            },
          },
        },
      },
    ],
  });

  await assert.rejects(
    publish(h),
    (err) => err.name === 'TikTokAuditError' && err.auditRequired === true
  );
  assert.equal(h.getState(), null);
  assert.equal(h.fetchImpl.calls.filter((call) => call.method === 'PUT').length, 0);
});

test('tiktok: a lost init response is ambiguous and never retried as a new upload', async () => {
  let initCalls = 0;
  const h = harness({
    routes: [
      creatorRoute,
      {
        method: 'POST',
        match: (href) => new URL(href).pathname === '/v2/post/publish/video/init/',
        response: () => {
          initCalls++;
          throw new Error('socket hang up');
        },
      },
    ],
    maxAttempts: 1,
  });

  await assert.rejects(
    publish(h),
    (err) => err.code === 'AMBIGUOUS_TIKTOK_INIT' && err.retryable === false
  );
  assert.equal(h.getState().stage, 'initiating');
  assert.equal(initCalls, 1);

  await assert.rejects(
    publish(h),
    (err) => err.code === 'AMBIGUOUS_TIKTOK_INIT'
  );
  assert.equal(initCalls, 1, 'no second init request');
});

test('tiktok: a failed status is terminal and clears the upload state', async () => {
  const h = harness({
    routes: [
      creatorRoute,
      initRoute,
      uploadRoute,
      statusRoute({ status: 'FAILED', fail_reason: 'file_format_check_failed' }),
    ],
  });

  await assert.rejects(
    publish(h),
    (err) => err.name === 'TikTokError'
      && err.retryable === false
      && /file_format_check_failed/.test(err.message)
  );
  assert.equal(h.getState(), null);
});

test('tiktok: chunk planning follows the official limits', () => {
  assert.deepEqual(planChunks(4 * 1024 * 1024), { chunkSize: 4 * 1024 * 1024, totalChunks: 1 });
  assert.deepEqual(planChunks(100 * 1024 * 1024), {
    chunkSize: 64 * 1024 * 1024,
    totalChunks: 2,
  });
  assert.deepEqual(planChunks(64 * 1024 * 1024), {
    chunkSize: 64 * 1024 * 1024,
    totalChunks: 1,
  });
  assert.deepEqual(planChunks(65 * 1024 * 1024), {
    chunkSize: 64 * 1024 * 1024,
    totalChunks: 2,
  });
  assert.deepEqual(planChunks(128 * 1024 * 1024), {
    chunkSize: 64 * 1024 * 1024,
    totalChunks: 2,
  });
  assert.deepEqual(planChunks(129 * 1024 * 1024), {
    chunkSize: 64 * 1024 * 1024,
    totalChunks: 3,
  });
  assert.deepEqual(planChunks(130 * 1024 * 1024), {
    chunkSize: 64 * 1024 * 1024,
    totalChunks: 3,
  });
});

test('tiktok: title composition uses the agent copy and hashtags', () => {
  assert.equal(
    composeTikTokTitle({ caption: ' Caption ', hashtags: ['#one', ' #two '] }),
    'Caption\n\n#one #two'
  );
  assert.throws(
    () => composeTikTokTitle({ caption: 'x'.repeat(2201), hashtags: [] }),
    /2200/
  );
});

test('composer: two TikTok accounts are independent publishers', () => {
  const settings = {
    distribution: {
      accounts: [
        { platform: 'tiktok', account: 'main', authorized: true },
        { platform: 'tiktok', account: 'clips', authorized: true },
      ],
    },
  };
  const credentials = {
    tiktok: {
      clientKey: 'key',
      clientSecret: 'secret',
      accounts: {
        main: {
          slot: 1,
          openId: 'open-1',
          accessToken: 'access-1',
          refreshToken: 'refresh-1',
          expiresAt: '2099-01-01T00:00:00.000Z',
          refreshExpiresAt: '2099-01-01T00:00:00.000Z',
          privacyLevel: 'PUBLIC_TO_EVERYONE',
        },
        clips: {
          slot: 2,
          openId: 'open-2',
          accessToken: 'access-2',
          refreshToken: 'refresh-2',
          expiresAt: '2099-01-01T00:00:00.000Z',
          refreshExpiresAt: '2099-01-01T00:00:00.000Z',
          privacyLevel: 'PUBLIC_TO_EVERYONE',
        },
      },
    },
  };

  const publisher = createPublisherFromSettings({ settings, credentials });

  assert.ok(publisher.publishers['tiktok:main'] instanceof TikTokPublisher);
  assert.ok(publisher.publishers['tiktok:clips'] instanceof TikTokPublisher);
  assert.equal(publisher.publishers['tiktok:main'].openId, 'open-1');
  assert.equal(publisher.publishers['tiktok:clips'].openId, 'open-2');
  assert.equal(publisher.publishers['tiktok:main'].accessToken, 'access-1');
  assert.equal(publisher.publishers['tiktok:clips'].accessToken, 'access-2');

  const health = publisher.health();
  assert.deepEqual(health.publishers.sort(), ['tiktok:clips', 'tiktok:main']);
  assert.deepEqual(health.missing, {});
});

test('composer: a missing second TikTok account does not break the first', async () => {
  const settings = {
    distribution: {
      accounts: [
        { platform: 'tiktok', account: 'main', authorized: true },
        { platform: 'tiktok', account: 'clips', authorized: true },
      ],
    },
  };
  const credentials = {
    tiktok: {
      clientKey: 'key',
      clientSecret: 'secret',
      accounts: {
        main: {
          slot: 1,
          openId: 'open-1',
          accessToken: 'access-1',
          refreshToken: 'refresh-1',
          expiresAt: '2099-01-01T00:00:00.000Z',
          refreshExpiresAt: '2099-01-01T00:00:00.000Z',
        },
      },
    },
  };

  const publisher = createPublisherFromSettings({ settings, credentials });

  assert.ok(publisher.publishers['tiktok:main'] instanceof TikTokPublisher);
  assert.match(publisher.health().missing['tiktok:clips'], /no TikTok credentials/);
  await assert.rejects(
    publisher.publish({ platform: 'tiktok', account: 'clips', post: {}, asset: {}, item: {} }),
    (err) => err.name === 'TikTokConfigError' && /no TikTok credentials/.test(err.message)
  );
});


test('tiktok: inbox upload initializes the inbox endpoint and records a manual-completion draft', async () => {
  const h = harness({
    mode: 'inbox',
    routes: [
      creatorRoute,
      inboxInitRoute,
      uploadRoute,
      statusSequence([{ status: 'SEND_TO_USER_INBOX' }]),
    ],
  });

  const result = await publish(h);

  assert.deepEqual(result, {
    externalId: 'draft-1',
    draft: true,
    manualCompletionRequired: true,
    url: null,
  });

  const init = h.fetchImpl.calls.find((call) =>
    new URL(call.url).pathname === '/v2/post/publish/inbox/video/init/'
  );
  assert.ok(init);
  const body = JSON.parse(init.body);
  assert.deepEqual(body.source_info, {
    source: 'FILE_UPLOAD',
    video_size: 1024 * 1024,
    chunk_size: 1024 * 1024,
    total_chunk_count: 1,
  });
  assert.equal(body.post_info, undefined);

  const directInit = h.fetchImpl.calls.find((call) =>
    new URL(call.url).pathname === '/v2/post/publish/video/init/'
  );
  assert.equal(directInit, undefined);

  assert.equal(h.getState().stage, 'inbox_uploaded');
  assert.equal(h.getState().publishId, 'draft-1');
  assert.equal(h.getState().uploadedAt, NOW);
});

test('tiktok: inbox upload resumes an interrupted upload without reinitializing', async () => {
  const h = harness({
    mode: 'inbox',
    state: {
      stage: 'uploading',
      publishId: 'draft-1',
      uploadUrl: 'https://upload.test/video?token=secret',
      videoSize: 1024 * 1024,
      chunkSize: 1024 * 1024,
      totalChunks: 1,
      uploadedBytes: 0,
      mode: 'inbox',
    },
    routes: [
      creatorRoute,
      uploadRoute,
      statusSequence([{ status: 'SEND_TO_USER_INBOX' }]),
    ],
  });

  const result = await publish(h);

  assert.deepEqual(result, {
    externalId: 'draft-1',
    draft: true,
    manualCompletionRequired: true,
    url: null,
  });
  assert.equal(
    h.fetchImpl.calls.filter((call) => new URL(call.url).pathname === '/v2/post/publish/inbox/video/init/').length,
    0
  );
  assert.equal(h.fetchImpl.calls.filter((call) => call.method === 'PUT').length, 1);
});

test('tiktok: an already accepted inbox upload is not uploaded twice', async () => {
  const h = harness({
    mode: 'inbox',
    state: {
      stage: 'inbox_uploaded',
      publishId: 'draft-1',
      url: null,
      uploadedAt: NOW,
      mode: 'inbox',
    },
    routes: [
      creatorRoute,
      statusSequence([{ status: 'SEND_TO_USER_INBOX' }]),
    ],
  });

  const result = await publish(h);

  assert.deepEqual(result, {
    externalId: 'draft-1',
    draft: true,
    manualCompletionRequired: true,
    url: null,
  });
  assert.equal(h.fetchImpl.calls.filter((call) => call.method === 'PUT').length, 0);
  assert.equal(
    h.fetchImpl.calls.filter((call) => new URL(call.url).pathname === '/v2/post/publish/inbox/video/init/').length,
    0
  );
});

test('tiktok: inbox upload init failure clears state for a definite rejection', async () => {
  const h = harness({
    mode: 'inbox',
    routes: [
      creatorRoute,
      {
        method: 'POST',
        match: (href) => new URL(href).pathname === '/v2/post/publish/inbox/video/init/',
        response: {
          status: 403,
          body: {
            error: {
              code: 'scope_not_authorized',
              message: 'missing video.upload',
              log_id: 'log',
            },
          },
        },
      },
    ],
  });

  await assert.rejects(publish(h), (err) => err.name === 'TikTokAuthError');
  assert.equal(h.getState(), null);
  assert.equal(h.fetchImpl.calls.filter((call) => call.method === 'PUT').length, 0);
});

test('tiktok: inbox upload failure leaves resumable upload state', async () => {
  const h = harness({
    mode: 'inbox',
    maxAttempts: 1,
    routes: [
      creatorRoute,
      inboxInitRoute,
      {
        method: 'PUT',
        match: (href) => new URL(href).host === 'upload.test',
        response: { status: 500, body: null },
      },
    ],
  });

  await assert.rejects(publish(h));
  assert.equal(h.getState().stage, 'uploading');
  assert.equal(h.getState().publishId, 'draft-1');
  assert.equal(h.getState().uploadedBytes, 0);
});

test('tiktok: inbox upload reports a failed upload status and clears state', async () => {
  const h = harness({
    mode: 'inbox',
    routes: [
      creatorRoute,
      inboxInitRoute,
      uploadRoute,
      statusSequence([{ status: 'FAILED', fail_reason: 'internal' }]),
    ],
  });

  await assert.rejects(publish(h), (err) => err.code === 'INBOX_UPLOAD_FAILED');
  assert.equal(h.getState(), null);
});

test('tiktok: an inbox upload with an ambiguous initiating state is not reinitialized', async () => {
  let initCalls = 0;
  const h = harness({
    mode: 'inbox',
    state: {
      stage: 'initiating',
      initRequestedAt: NOW,
      mode: 'inbox',
    },
    routes: [
      {
        method: 'POST',
        match: (href) => new URL(href).pathname === '/v2/post/publish/inbox/video/init/',
        response: () => {
          initCalls++;
          return inboxInitRoute.response;
        },
      },
    ],
  });

  await assert.rejects(
    publish(h),
    (err) => err.code === 'AMBIGUOUS_TIKTOK_INIT'
  );
  assert.equal(h.getState().stage, 'initiating');
  assert.equal(initCalls, 0);
});

test('tiktok: inbox upload does not require privacy options it does not send', async () => {
  const noPrivacyCreator = {
    method: 'POST',
    match: (href) => new URL(href).pathname === '/v2/post/publish/creator_info/query/',
    response: {
      data: {
        creator_username: 'creator',
        creator_nickname: 'Creator',
        privacy_level_options: [],
        max_video_post_duration_sec: 600,
      },
      error: { code: 'ok', message: '', log_id: 'log' },
    },
  };
  const h = harness({
    mode: 'inbox',
    routes: [
      noPrivacyCreator,
      inboxInitRoute,
      uploadRoute,
      statusSequence([{ status: 'SEND_TO_USER_INBOX' }]),
    ],
  });

  const result = await publish(h);
  assert.equal(result.draft, true);
  assert.equal(result.externalId, 'draft-1');
});

test('tiktok: direct post still requires privacy options', async () => {
  const noPrivacyCreator = {
    method: 'POST',
    match: (href) => new URL(href).pathname === '/v2/post/publish/creator_info/query/',
    response: {
      data: {
        creator_username: 'creator',
        creator_nickname: 'Creator',
        privacy_level_options: [],
        max_video_post_duration_sec: 600,
      },
      error: { code: 'ok', message: '', log_id: 'log' },
    },
  };
  const h = harness({
    mode: 'direct',
    routes: [noPrivacyCreator],
  });

  await assert.rejects(
    publish(h),
    (err) => err.name === 'TikTokConfigError' && /privacy_level_options/.test(err.message)
  );
});

test('tiktok: an accepted inbox upload re-verifies the creator before status', async () => {
  const h = harness({
    mode: 'inbox',
    state: {
      stage: 'inbox_uploaded',
      publishId: 'draft-1',
      url: null,
      uploadedAt: NOW,
      mode: 'inbox',
    },
    routes: [
      creatorRoute,
      statusSequence([{ status: 'SEND_TO_USER_INBOX' }]),
    ],
  });

  const result = await publish(h);
  assert.equal(result.draft, true);
  assert.equal(
    h.fetchImpl.calls.filter((call) =>
      new URL(call.url).pathname === '/v2/post/publish/creator_info/query/'
    ).length,
    1
  );
  assert.equal(
    h.fetchImpl.calls.filter((call) =>
      new URL(call.url).pathname === '/v2/post/publish/status/fetch/'
    ).length,
    1
  );
});
