// S3-compatible media host: signing, upload, retries, idempotent reuse.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync, mkdtempSync, mkdirSync, readFileSync, statSync, utimesSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  NginxMediaHost, S3MediaHost, sigV4Presign,
} from '../src/media-host.mjs';
import { fakeFetch } from './fake-fetch.mjs';

const CONFIG = {
  provider: 's3',
  bucket: 'media-bucket',
  region: 'us-east-1',
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  keyPrefix: 'content-os/instagram',
  forcePathStyle: false,
  signedPutSeconds: 900,
  signedGetSeconds: 7200,
};

function videoFile(bytes = 'fake video bytes') {
  const dir = mkdtempSync(path.join(tmpdir(), 'media-host-'));
  const file = path.join(dir, 'master.mp4');
  writeFileSync(file, bytes);
  return file;
}

test('sigV4Presign matches the AWS query-string example', () => {
  const url = sigV4Presign({
    method: 'GET',
    host: 'examplebucket.s3.amazonaws.com',
    path: '/test.txt',
    region: 'us-east-1',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
    expires: 86400,
    now: new Date('2013-05-24T00:00:00.000Z'),
  });

  const parsed = new URL(url);
  assert.equal(parsed.host, 'examplebucket.s3.amazonaws.com');
  assert.equal(parsed.pathname, '/test.txt');
  assert.equal(
    parsed.searchParams.get('X-Amz-Credential'),
    'AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request'
  );
  assert.equal(
    parsed.searchParams.get('X-Amz-Signature'),
    '3ed0be64024db54d5574a27da223529635c383f911f80e636f0ccc13890053d2'
  );
});

test('upload puts the file with a presigned URL and returns a presigned GET', async () => {
  const file = videoFile();
  const fetchImpl = fakeFetch([
    { method: 'HEAD', response: { status: 404, body: null } },
    { method: 'PUT', response: { status: 200, body: null } },
  ]);
  const host = new S3MediaHost({
    config: CONFIG,
    fetchImpl,
    clock: () => new Date('2026-10-22T12:00:00.000Z'),
  });

  const uploaded = await host.upload({ itemId: 7, filePath: file });

  assert.equal(uploaded.uploaded, true);
  assert.match(uploaded.key, /^content-os\/instagram\/item-7\//);
  assert.match(uploaded.url, /^https:\/\/media-bucket\.s3\.us-east-1\.amazonaws\.com\//);
  assert.ok(new URL(uploaded.url).searchParams.get('X-Amz-Signature'));

  const put = fetchImpl.calls.find((call) => call.method === 'PUT');
  assert.ok(put, 'a PUT was made');
  assert.equal(put.headers['Content-Type'], 'video/mp4');
  assert.equal(put.headers['Content-Length'], String(Buffer.byteLength('fake video bytes')));
  assert.equal(Buffer.isBuffer(put.body), true);
  assert.equal(put.body.toString(), 'fake video bytes');
});

test('upload reuses an existing object instead of uploading again', async () => {
  const file = videoFile();
  const fetchImpl = fakeFetch([
    { method: 'HEAD', response: { status: 200, body: null } },
    { method: 'PUT', response: { status: 200, body: null } },
  ]);
  const host = new S3MediaHost({ config: CONFIG, fetchImpl });

  const uploaded = await host.upload({ itemId: 7, filePath: file });

  assert.equal(uploaded.uploaded, false);
  assert.equal(fetchImpl.calls.filter((call) => call.method === 'PUT').length, 0);
});

test('upload retries a failed PUT and then succeeds', async () => {
  const file = videoFile();
  let puts = 0;
  const sleepCalls = [];
  const fetchImpl = fakeFetch([
    { method: 'HEAD', response: { status: 404, body: null } },
    {
      method: 'PUT',
      response: () => {
        puts++;
        return puts === 1
          ? { status: 503, body: null }
          : { status: 200, body: null };
      },
    },
  ]);
  const host = new S3MediaHost({
    config: CONFIG,
    fetchImpl,
    attempts: 2,
    sleep: async (ms) => { sleepCalls.push(ms); },
  });

  const uploaded = await host.upload({ itemId: 7, filePath: file });

  assert.equal(uploaded.uploaded, true);
  assert.equal(puts, 2);
  assert.equal(sleepCalls.length, 1);
});

test('a custom endpoint uses path-style addressing', async () => {
  const file = videoFile();
  const fetchImpl = fakeFetch([
    { method: 'HEAD', response: { status: 404, body: null } },
    { method: 'PUT', response: { status: 200, body: null } },
  ]);
  const host = new S3MediaHost({
    config: {
      ...CONFIG,
      provider: 'r2',
      region: 'auto',
      endpoint: 'https://account.r2.cloudflarestorage.com',
      bucket: 'clip-bucket',
      forcePathStyle: true,
    },
    fetchImpl,
  });

  const uploaded = await host.upload({ itemId: 3, filePath: file });
  const url = new URL(uploaded.url);

  assert.equal(url.host, 'account.r2.cloudflarestorage.com');
  assert.match(url.pathname, /^\/clip-bucket\/content-os\/instagram\/item-3\//);
});

test('missing storage configuration is refused', () => {
  assert.throws(() => new S3MediaHost({}), /mediaHost configuration/);
  assert.throws(
    () => new S3MediaHost({ config: { bucket: 'b', region: 'us-east-1' } }),
    /accessKeyId/
  );
});

// ============================================================================
// NGINX MEDIA HOST
// ============================================================================

const NGINX_CONFIG = {
  provider: 'nginx',
  publicBaseUrl: 'https:///media',
  rootDir: null,
  keyPrefix: 'instagram',
  ttlHours: 24,
};

function nginxHost(overrides = {}) {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'nginx-media-'));
  return {
    rootDir,
    host: new NginxMediaHost({
      config: { ...NGINX_CONFIG, rootDir, ...overrides },
      clock: () => new Date('2026-10-22T12:00:00.000Z'),
    }),
  };
}

test('nginx media host hardlinks a render into the served directory', async () => {
  const source = videoFile('render bytes');
  const { rootDir, host } = nginxHost();

  const uploaded = await host.upload({ itemId: 7, filePath: source });

  assert.match(uploaded.key, /^instagram\/item-7\/[0-9a-f]{32}-master\.mp4$/);
  assert.match(uploaded.url, /^https:\/\/files.example.com\/media\/instagram\/item-7\//);

  const served = path.join(rootDir, uploaded.key);
  assert.ok(existsSync(served));
  assert.equal(readFileSync(served, 'utf8'), 'render bytes');
  assert.equal(statSync(served).nlink, 2, 'hardlinked to the render');

  assert.equal(host.release(uploaded.key), true);
  assert.ok(!existsSync(served));
  assert.ok(existsSync(source), 'the original render is untouched');
});

test('nginx media host refuses a release outside the served directory', () => {
  const { host } = nginxHost();
  assert.throws(() => host.release('../outside.mp4'), /outside the served directory/);
});

test('nginx media host removes stale files but never the source render', async () => {
  const source = videoFile('render bytes');
  const { rootDir, host } = nginxHost({ ttlHours: 1 });

  const oldDir = path.join(rootDir, 'instagram', 'item-1');
  mkdirSync(oldDir, { recursive: true });
  const oldFile = path.join(oldDir, 'old.mp4');
  writeFileSync(oldFile, 'old');
  const longAgo = new Date('2026-10-20T00:00:00.000Z');
  utimesSync(oldFile, longAgo, longAgo);

  await host.upload({ itemId: 2, filePath: source });

  assert.ok(!existsSync(oldFile), 'files older than ttlHours are removed');
  assert.ok(existsSync(source), 'the source render is outside the media root');
});

test('nginx media host does not create the root on construction', () => {
  const root = path.join(mkdtempSync(path.join(tmpdir(), 'nginx-media-')), 'missing');
  new NginxMediaHost({
    config: {
      publicBaseUrl: 'https://example.test/media',
      rootDir: root,
    },
  });
  assert.equal(existsSync(root), false);
});

test('nginx media host requires a public base URL and root directory', () => {
  assert.throws(() => new NginxMediaHost({}), /mediaHost configuration/);
  assert.throws(
    () => new NginxMediaHost({ config: { rootDir: '/tmp/media' } }),
    /publicBaseUrl/
  );
  assert.throws(
    () => new NginxMediaHost({ config: { publicBaseUrl: 'https://x/media' } }),
    /rootDir/
  );
});
