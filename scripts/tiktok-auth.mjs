#!/usr/bin/env node
// TikTok Content Posting API setup and OAuth callback.
//
// Each TikTok account is independently authorized with the same app client
// key/secret, and stored in its own numbered .env slot:
//   TIKTOK_ACCOUNT_1_NAME, _OPEN_ID, _ACCESS_TOKEN, _REFRESH_TOKEN, ...
//
// Setup:
//   1. Register a TikTok app with Login Kit and Content Posting API.
//   2. Add the redirect URI and request video.publish (+ user.info.basic).
//   3. node scripts/tiktok-auth.mjs --slot 1 --account main --authorize
//      Open the printed URL, authorize, and copy the code from the redirect.
//   4. node scripts/tiktok-auth.mjs --slot 1 --account main --code <CODE>
//      Or run the callback server and use --redirect-uri https://content-os.codeket.com/tiktok/callback
//
// Callback server:
//   node scripts/tiktok-auth.mjs --serve --host 0.0.0.0 --port 8787
//
// Check:
//   node scripts/tiktok-auth.mjs --slot 1 --account main --check
//
// Public Direct Post requires the Content Posting API audit. Unaudited apps
// are limited to private viewing; the script reports that requirement.
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import {
  chmodSync,
  chownSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { makePaths } from '../packages/core/src/paths.js';
import {
  defaultEnvFile,
  readEnvFile,
  writeEnvValues,
} from '../packages/engine-distribution/src/credentials.mjs';
import { HttpError, requestJson } from '../packages/engine-distribution/src/publishers/http.mjs';

const args = process.argv.slice(2);
const value = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
};
const has = (flag) => args.includes(flag);

const DEFAULT_API_BASE = 'https://open.tiktokapis.com';
const DEFAULT_CALLBACK_HOST = '0.0.0.0';
const DEFAULT_CALLBACK_PORT = 8787;
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

function printUsage() {
  console.log(`
Usage:
  node scripts/tiktok-auth.mjs --slot N --account NAME --authorize [--redirect-uri URI] [--privacy-level LEVEL] [--draft]
  node scripts/tiktok-auth.mjs --slot N --account NAME --code CODE [--privacy-level LEVEL]
  node scripts/tiktok-auth.mjs --slot N --account NAME --check
  node scripts/tiktok-auth.mjs --serve [--host HOST] [--port PORT] [--socket PATH]

Environment / .env:
  TIKTOK_CLIENT_KEY
  TIKTOK_CLIENT_SECRET
  TIKTOK_REDIRECT_URI
  CONTENT_OS_ENV_FILE      (default: /opt/docker/apps/content-os/.env)

Per account:
  TIKTOK_ACCOUNT_<N>_NAME
  TIKTOK_ACCOUNT_<N>_OPEN_ID
  TIKTOK_ACCOUNT_<N>_ACCESS_TOKEN
  TIKTOK_ACCOUNT_<N>_REFRESH_TOKEN
  TIKTOK_ACCOUNT_<N>_EXPIRES_AT
  TIKTOK_ACCOUNT_<N>_REFRESH_EXPIRES_AT
  TIKTOK_ACCOUNT_<N>_MODE=direct
  TIKTOK_ACCOUNT_<N>_PRIVACY_LEVEL=<allowed private level>
`);
}

export function normalizeSlot(slot) {
  const parsed = Number(slot);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error('TikTok slot must be a positive integer');
  }
  return parsed;
}

export function normalizeAccount(account) {
  return String(account ?? '').trim().toLowerCase();
}

export function validateRedirectUri(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('TikTok redirect URI is required');
  }
  const url = new URL(value.trim());
  if (url.protocol !== 'https:') {
    throw new Error('TikTok redirect URI must use HTTPS');
  }
  if (url.username || url.password || url.hash) {
    throw new Error('TikTok redirect URI must not contain credentials or a fragment');
  }
  return url.toString();
}

export function oauthStatePath() {
  const dir = makePaths().tmpDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return path.join(dir, 'tiktok-oauth-state.json');
}

function isValidStateRecord(record) {
  return Boolean(
    record && typeof record === 'object' && !Array.isArray(record) &&
    typeof record.state === 'string' && record.state &&
    Number.isInteger(record.slot) && record.slot > 0 &&
    typeof record.account === 'string' && record.account &&
    typeof record.redirectUri === 'string' && record.redirectUri &&
    typeof record.expiresAt === 'string' && Number.isFinite(Date.parse(record.expiresAt))
  );
}

function pruneExpiredStates(states, now = Date.now()) {
  return (Array.isArray(states) ? states : [])
    .filter(isValidStateRecord)
    .filter((record) => Date.parse(record.expiresAt) > now);
}

function writeJsonAtomic(file, value) {
  const dir = path.dirname(file);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  chmodSync(temp, 0o600);
  renameSync(temp, file);
  chmodSync(file, 0o600);
}

export function loadOAuthStates() {
  const file = oauthStatePath();
  if (!existsSync(file)) return { states: [] };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Array.isArray(parsed.states)) {
      return { states: [] };
    }
    return { states: pruneExpiredStates(parsed.states) };
  } catch {
    return { states: [] };
  }
}

export function saveOAuthStates(states) {
  const file = oauthStatePath();
  const active = pruneExpiredStates(Array.isArray(states) ? states : []);
  if (active.length === 0) {
    try {
      unlinkSync(file);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    return;
  }
  writeJsonAtomic(file, { states: active });
}

export function createOAuthState({ slot, account, redirectUri, privacyLevel = null, ttlMs = OAUTH_STATE_TTL_MS }) {
  const normalizedSlot = normalizeSlot(slot);
  const normalizedAccount = normalizeAccount(account);
  if (!normalizedAccount) throw new Error('TikTok account name is required');
  const normalizedRedirectUri = validateRedirectUri(redirectUri);

  const now = Date.now();
  const record = {
    state: randomBytes(32).toString('base64url'),
    slot: normalizedSlot,
    account: normalizedAccount,
    redirectUri: normalizedRedirectUri,
    privacyLevel: privacyLevel || null,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString(),
  };

  const store = loadOAuthStates();
  store.states.push(record);
  saveOAuthStates(store.states);
  return record;
}

export function consumeOAuthState(state) {
  if (typeof state !== 'string' || !state) return null;

  const store = loadOAuthStates();
  const index = store.states.findIndex((record) => record.state === state);
  if (index < 0) return null;

  const [record] = store.states.splice(index, 1);
  saveOAuthStates(store.states);
  if (Date.parse(record.expiresAt) <= Date.now()) return null;
  return record;
}

export function buildAuthorizationUrl({ clientKey, redirectUri, state }) {
  if (!clientKey) throw new Error('TikTok client key is required');
  const normalizedRedirectUri = validateRedirectUri(redirectUri);
  if (typeof state !== 'string' || !state) throw new Error('OAuth state is required');

  const authorize = new URL('https://www.tiktok.com/v2/auth/authorize/');
  authorize.searchParams.set('client_key', clientKey);
  authorize.searchParams.set('scope', 'user.info.basic,video.publish,video.upload');
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('redirect_uri', normalizedRedirectUri);
  authorize.searchParams.set('state', state);
  return authorize.toString();
}

export function hasVideoPublishScope(scope) {
  return String(scope ?? '').split(',').map((item) => item.trim()).includes('video.publish');
}

export function hasVideoUploadScope(scope) {
  return String(scope ?? '').split(',').map((item) => item.trim()).includes('video.upload');
}

export async function exchangeAuthorizationCode({
  code,
  clientKey,
  clientSecret,
  redirectUri,
  apiBase = DEFAULT_API_BASE,
  fetchImpl = globalThis.fetch,
}) {
  if (!code) throw new Error('authorization code is required');
  if (!clientKey || !clientSecret) throw new Error('TikTok client credentials are required');
  const normalizedRedirectUri = validateRedirectUri(redirectUri);

  const token = await requestJson(`${apiBase}/v2/oauth/token/`, {
    method: 'POST',
    bodyType: 'form',
    body: {
      client_key: clientKey,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: normalizedRedirectUri,
    },
    attempts: 3,
    timeoutMs: 30000,
    fetchImpl,
  });

  if (token?.error) {
    throw new Error(token.error_description || token.error);
  }
  if (!token?.access_token || !token?.refresh_token || !token?.open_id) {
    throw new Error('TikTok did not return access_token, refresh_token and open_id');
  }
  const draftWorkflow = has('--draft');
  if (!hasVideoPublishScope(token.scope)) {
    throw new Error(
      `the token does not include video.publish (granted: ${token.scope || 'none'}). ` +
      'Request video.publish in the TikTok app and authorize again.'
    );
  }
  if (draftWorkflow && !hasVideoUploadScope(token.scope)) {
    throw new Error(
      `the token does not include video.upload (granted: ${token.scope || 'none'}). ` +
      'Request video.upload in the TikTok app and authorize again.'
    );
  }

  const now = Date.now();
  return {
    openId: token.open_id,
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: Number(token.expires_in) > 0
      ? new Date(now + Number(token.expires_in) * 1000).toISOString()
      : null,
    refreshExpiresAt: Number(token.refresh_expires_in) > 0
      ? new Date(now + Number(token.refresh_expires_in) * 1000).toISOString()
      : null,
    scope: token.scope,
  };
}

export function saveTikTokTokens({ envFile, slot, account, token, redirectUri, privacyLevel = null, env = null }) {
  const resolvedEnvFile = envFile || defaultEnvFile();
  const resolvedEnv = env ?? readEnvFile(resolvedEnvFile);
  const clientKey = resolvedEnv.TIKTOK_CLIENT_KEY;
  const clientSecret = resolvedEnv.TIKTOK_CLIENT_SECRET;
  const normalizedRedirectUri = validateRedirectUri(redirectUri);
  const normalizedSlot = normalizeSlot(slot);
  const normalizedAccount = normalizeAccount(account);
  if (!normalizedAccount) throw new Error('TikTok account name is required');
  if (!clientKey || !clientSecret) throw new Error('TikTok client credentials are required');

  const updates = {
    TIKTOK_CLIENT_KEY: clientKey,
    TIKTOK_CLIENT_SECRET: clientSecret,
    TIKTOK_REDIRECT_URI: normalizedRedirectUri,
    [`TIKTOK_ACCOUNT_${normalizedSlot}_NAME`]: normalizedAccount,
    [`TIKTOK_ACCOUNT_${normalizedSlot}_OPEN_ID`]: token.openId,
    [`TIKTOK_ACCOUNT_${normalizedSlot}_ACCESS_TOKEN`]: token.accessToken,
    [`TIKTOK_ACCOUNT_${normalizedSlot}_REFRESH_TOKEN`]: token.refreshToken,
    [`TIKTOK_ACCOUNT_${normalizedSlot}_EXPIRES_AT`]: token.expiresAt,
    [`TIKTOK_ACCOUNT_${normalizedSlot}_REFRESH_EXPIRES_AT`]: token.refreshExpiresAt,
    [`TIKTOK_ACCOUNT_${normalizedSlot}_SCOPE`]: token.scope,
    [`TIKTOK_ACCOUNT_${normalizedSlot}_MODE`]: 'direct',
  };
  if (privacyLevel) {
    updates[`TIKTOK_ACCOUNT_${normalizedSlot}_PRIVACY_LEVEL`] = privacyLevel;
  }
  writeEnvValues(resolvedEnvFile, updates);
  return resolvedEnvFile;
}

export async function fetchCreatorInfo(accessToken, apiBase = DEFAULT_API_BASE, fetchImpl = globalThis.fetch) {
  const body = await requestJson(`${apiBase}/v2/post/publish/creator_info/query/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    attempts: 3,
    timeoutMs: 30000,
    fetchImpl,
  });
  const code = body?.error?.code;
  if (code && code !== 'ok') {
    throw new Error(body?.error?.message || code);
  }
  return body?.data ?? {};
}

export async function handleCallbackRequest(req, res, deps = {}) {
  const readEnv = deps.readEnv ?? (() => readEnvFile(defaultEnvFile()));
  const consumeState = deps.consumeState ?? consumeOAuthState;
  const exchangeCode = deps.exchangeCode ?? exchangeAuthorizationCode;
  const saveTokens = deps.saveTokens ?? saveTikTokTokens;
  const fetchCreator = deps.fetchCreator ?? fetchCreatorInfo;
  const logger = deps.logger ?? console.error;

  const send = (status, body) => {
    if (!res.headersSent) {
      res.statusCode = status;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
    }
    res.end(body);
  };

  try {
    if (req.method !== 'GET') {
      send(405, 'Method not allowed.');
      return;
    }

    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname === '/healthz') {
      send(200, 'ok');
      return;
    }
    if (url.pathname === '/linkedin/callback') {
      const linkedin = await import('./linkedin-auth.mjs');
      return linkedin.handleCallbackRequest(req, res, deps);
    }
    if (url.pathname !== '/tiktok/callback') {
      send(404, 'Not found.');
      return;
    }

    const oauthError = url.searchParams.get('error');
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (oauthError) {
      send(400, 'TikTok authorization failed.');
      return;
    }
    if (!code || !state) {
      send(400, 'Missing authorization code or state.');
      return;
    }

    const metadata = consumeState(state);
    if (!metadata) {
      send(400, 'Invalid or expired authorization state.');
      return;
    }

    const env = readEnv();
    const clientKey = env.TIKTOK_CLIENT_KEY;
    const clientSecret = env.TIKTOK_CLIENT_SECRET;
    if (!clientKey || !clientSecret) {
      logger('TikTok OAuth callback failed');
      send(500, 'TikTok authorization failed.');
      return;
    }

    let token;
    try {
      token = await exchangeCode({
        code,
        clientKey,
        clientSecret,
        redirectUri: metadata.redirectUri,
      });
    } catch (err) {
      logger('TikTok OAuth callback failed');
      send(500, 'TikTok authorization failed.');
      return;
    }

    try {
      await saveTokens({
        envFile: defaultEnvFile(),
        slot: metadata.slot,
        account: metadata.account,
        token,
        redirectUri: metadata.redirectUri,
        privacyLevel: metadata.privacyLevel,
        env,
      });
    } catch (err) {
      logger('TikTok OAuth callback failed');
      send(500, 'TikTok authorization failed.');
      return;
    }

    try {
      await fetchCreator(token.accessToken);
    } catch (err) {
      logger('TikTok OAuth callback completed, but creator metadata was unavailable');
    }

    send(200, 'TikTok account connected. You can close this window.');
  } catch (err) {
    logger('TikTok OAuth callback failed');
    if (!res.headersSent) {
      send(500, 'TikTok authorization failed.');
    } else {
      try { res.end(); } catch { /* ignore */ }
    }
  }
}

// Callback serving is centralized in ui/server.mjs. This module only provides
// handleCallbackRequest for the shared server to invoke.
export function startCallbackServer() { return null; }

async function main() {
  if (has('--help') || has('-h')) {
    printUsage();
    process.exit(0);
  }

  const slot = value('--slot') ? Number(value('--slot')) : null;
  const account = value('--account');
  const envFile = value('--env-file') || process.env.CONTENT_OS_ENV_FILE || defaultEnvFile();

  let fileEnv = {};
  try {
    fileEnv = readEnvFile(envFile);
  } catch (err) {
    console.error(`Cannot read ${envFile}: ${err.message}`);
    process.exit(1);
  }

  const clientKey = process.env.TIKTOK_CLIENT_KEY || fileEnv.TIKTOK_CLIENT_KEY || null;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET || fileEnv.TIKTOK_CLIENT_SECRET || null;
  const redirectUri = value('--redirect-uri') || process.env.TIKTOK_REDIRECT_URI || fileEnv.TIKTOK_REDIRECT_URI || null;
  const apiBase = 'https://open.tiktokapis.com';

  if (has('--serve') || has('--callback-server')) {
    console.error('Use the Content OS UI server (ui/server.mjs) for OAuth callbacks.');
    process.exit(1);
  }

  if (!Number.isInteger(slot) || slot < 1) {
    console.error('--slot is required and must be >= 1');
    process.exit(1);
  }
  if (!account) {
    console.error('--account is required (must match settings.distribution.accounts)');
    process.exit(1);
  }

  const normalizedAccount = normalizeAccount(account);
  if (!normalizedAccount) {
    console.error('TikTok account name is required');
    process.exit(1);
  }

  if (has('--authorize')) {
    let normalizedRedirectUri;
    try {
      normalizedRedirectUri = validateRedirectUri(redirectUri);
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
    if (!clientKey) {
      console.error('TIKTOK_CLIENT_KEY is required');
      process.exit(1);
    }

    const privacy = value('--privacy-level') || null;
    const stateRecord = createOAuthState({
      slot,
      account: normalizedAccount,
      redirectUri: normalizedRedirectUri,
      privacyLevel: privacy,
    });
    const authorize = buildAuthorizationUrl({
      clientKey,
      redirectUri: normalizedRedirectUri,
      state: stateRecord.state,
    });

    console.log('Open this URL, authorize the account, then copy the code from the redirect:');
    console.log(authorize);
    console.log(`State expires: ${stateRecord.expiresAt}`);
    console.log(`Then run: node scripts/tiktok-auth.mjs --slot ${slot} --account ${account} --code <CODE> --redirect-uri ${normalizedRedirectUri}`);
    if (privacy) console.log(`Privacy level requested: ${privacy}`);
    process.exit(0);
  }

  if (has('--check')) {
    const accessToken = fileEnv[`TIKTOK_ACCOUNT_${slot}_ACCESS_TOKEN`];
    if (!accessToken) {
      throw new Error(`no TIKTOK_ACCOUNT_${slot}_ACCESS_TOKEN in ${envFile}`);
    }
    const creator = await fetchCreatorInfo(accessToken, apiBase);
    console.log(`Credentials file: ${envFile}`);
    console.log(`Slot: ${slot}  Account: ${account}`);
    printCreator(creator);
    process.exit(0);
  }

  const code = value('--code') || process.env.TIKTOK_AUTHORIZATION_CODE;
  if (!code) throw new Error('--code is required (or use --authorize first)');
  if (!clientKey || !clientSecret) {
    throw new Error('TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET are required');
  }
  if (!redirectUri) {
    throw new Error('TIKTOK_REDIRECT_URI is required and must match the value used for authorization');
  }
  const normalizedRedirectUri = validateRedirectUri(redirectUri);

  const token = await exchangeAuthorizationCode({
    code,
    clientKey,
    clientSecret,
    redirectUri: normalizedRedirectUri,
    apiBase,
  });

  const privacy = value('--privacy-level') || null;
  saveTikTokTokens({
    envFile,
    slot,
    account: normalizedAccount,
    token,
    redirectUri: normalizedRedirectUri,
    privacyLevel: privacy,
  });

  const creator = await fetchCreatorInfo(token.accessToken, apiBase);
  console.log(`Wrote ${envFile} (mode 600).`);
  console.log(`Slot: ${slot}  Account: ${account}`);
  console.log(`Scopes: ${token.scope}`);
  console.log(`Access token expires: ${token.expiresAt ?? 'unknown'}`);
  console.log(`Refresh token expires: ${token.refreshExpiresAt ?? 'unknown'}`);
  printCreator(creator);
  console.log('Public Direct Post requires the TikTok Content Posting API audit.');
  console.log(`Set TIKTOK_ACCOUNT_${slot}_PRIVACY_LEVEL to an allowed public option after the audit.`);
}

const isMainModule = import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main().catch((err) => {
    if (err instanceof HttpError) {
      const payload = err.body?.error;
      const message = (payload && typeof payload === 'object' ? payload.message : null)
        || err.body?.error_description
        || err.message;
      console.error(`TikTok setup failed: ${message}`);
    } else {
      console.error(`TikTok setup failed: ${err.message}`);
    }
    process.exit(1);
  });
}

function printCreator(creator) {
  console.log(`Creator: @${creator.creator_username ?? '(unknown)'} (${creator.creator_nickname ?? ''})`);
  console.log(`Privacy options: ${(creator.privacy_level_options ?? []).join(', ') || 'none'}`);
  console.log(`Max video duration: ${creator.max_video_post_duration_sec ?? 'unknown'}s`);
}