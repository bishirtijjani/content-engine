#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync, chmodSync, renameSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makePaths } from '../packages/core/src/paths.js';
import { defaultEnvFile, readEnvFile, writeEnvValues } from '../packages/engine-distribution/src/credentials.mjs';
import { HttpError, requestJson } from '../packages/engine-distribution/src/publishers/http.mjs';

const args = process.argv.slice(2);
const value = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const has = (flag) => args.includes(flag);

const DEFAULT_AUTH_BASE = 'https://accounts.google.com';
const DEFAULT_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DEFAULT_API_BASE = 'https://www.googleapis.com';
const SCOPES = 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube';
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

function oauthStatePath() {
  const dir = makePaths().tmpDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return path.join(dir, 'youtube-oauth-state.json');
}

export function loadOAuthStates() {
  const file = oauthStatePath();
  if (!existsSync(file)) return { states: [] };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Array.isArray(parsed.states)) return { states: [] };
    const now = Date.now();
    return { states: parsed.states.filter((r) => r && typeof r.state === 'string' && Date.parse(r.expiresAt) > now) };
  } catch { return { states: [] }; }
}

export function saveOAuthStates(states) {
  const file = oauthStatePath();
  const active = (Array.isArray(states) ? states : []).filter((r) => r && typeof r.state === 'string' && Date.parse(r.expiresAt) > Date.now());
  if (!active.length) { try { unlinkSync(file); } catch {} return; }
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify({ states: active }, null, 2), { mode: 0o600 });
  chmodSync(temp, 0o600);
  renameSync(temp, file);
}

export function createOAuthState({ slot, account, redirectUri, ttlMs = OAUTH_STATE_TTL_MS }) {
  const now = Date.now();
  const record = { state: randomBytes(32).toString('base64url'), slot: Number(slot), account: String(account).toLowerCase(), redirectUri, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + ttlMs).toISOString() };
  const store = loadOAuthStates();
  store.states.push(record);
  saveOAuthStates(store.states);
  return record;
}

export function consumeOAuthState(state) {
  if (typeof state !== 'string' || !state) return null;
  const store = loadOAuthStates();
  const idx = store.states.findIndex((r) => r.state === state);
  if (idx < 0) return null;
  const [record] = store.states.splice(idx, 1);
  saveOAuthStates(store.states);
  if (Date.parse(record.expiresAt) <= Date.now()) return null;
  return record;
}

export function buildAuthorizationUrl({ clientId, redirectUri, state }) {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', SCOPES);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', state);
  return url.toString();
}

export async function exchangeAuthorizationCode({ code, clientId, clientSecret, redirectUri }) {
  const token = await requestJson(DEFAULT_TOKEN_URL, {
    method: 'POST',
    bodyType: 'form',
    body: { code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' },
    attempts: 3,
    timeoutMs: 30000,
  });
  if (token?.error) throw new Error(token.error_description || token.error);
  if (!token?.access_token) throw new Error('YouTube did not return an access token');
  const now = Date.now();
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? null,
    expiresAt: token.expires_in ? new Date(now + Number(token.expires_in) * 1000).toISOString() : null,
    refreshExpiresAt: null,
    scope: token.scope ?? SCOPES,
  };
}

export async function fetchChannelId(accessToken) {
  const info = await requestJson(`${DEFAULT_API_BASE}/youtube/v3/channels?part=id&mine=true`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    attempts: 3,
    timeoutMs: 30000,
  });
  const id = info?.items?.[0]?.id;
  if (!id) throw new Error('YouTube did not return a channel id');
  return { channelId: id };
}

export async function handleCallbackRequest(req, res, deps = {}) {
  const readEnv = deps.readEnv ?? (() => readEnvFile(defaultEnvFile()));
  const consumeState = deps.consumeState ?? consumeOAuthState;
  const exchangeCode = deps.exchangeCode ?? exchangeAuthorizationCode;
  const fetchChannel = deps.fetchChannel ?? fetchChannelId;
  const logger = deps.logger ?? console.error;

  const send = (status, body) => {
    if (!res.headersSent) { res.statusCode = status; res.setHeader('Content-Type','text/plain; charset=utf-8'); res.setHeader('Cache-Control','no-store'); }
    res.end(body);
  };

  try {
    if (req.method !== 'GET') { send(405,'Method not allowed.'); return; }
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname === '/healthz') { send(200,'ok'); return; }
    if (url.pathname !== '/youtube/callback') { send(404,'Not found.'); return; }
    const oauthError = url.searchParams.get('error');
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (oauthError) { send(400,'YouTube authorization failed.'); return; }
    if (!code || !state) { send(400,'Missing authorization code or state.'); return; }
    const metadata = consumeState(state);
    if (!metadata) { send(400,'Invalid or expired authorization state.'); return; }
    const env = readEnv();
    const clientId = env.YOUTUBE_CLIENT_ID;
    const clientSecret = env.YOUTUBE_CLIENT_SECRET;
    if (!clientId || !clientSecret) { send(500,'YouTube authorization failed.'); return; }
    const token = await exchangeCode({ code, clientId, clientSecret, redirectUri: metadata.redirectUri });
    const channel = await fetchChannel(token.accessToken);
    // save
    const slot = metadata.slot;
    const account = metadata.account;
    const updates = {
      [`YOUTUBE_ACCOUNT_${slot}_NAME`]: account,
      [`YOUTUBE_ACCOUNT_${slot}_CHANNEL_ID`]: channel.channelId,
      [`YOUTUBE_ACCOUNT_${slot}_ACCESS_TOKEN`]: token.accessToken,
      [`YOUTUBE_ACCOUNT_${slot}_EXPIRES_AT`]: token.expiresAt,
      [`YOUTUBE_ACCOUNT_${slot}_SCOPE`]: token.scope,
    };
    if (token.refreshToken) updates[`YOUTUBE_ACCOUNT_${slot}_REFRESH_TOKEN`] = token.refreshToken;
    if (token.refreshExpiresAt) updates[`YOUTUBE_ACCOUNT_${slot}_REFRESH_EXPIRES_AT`] = token.refreshExpiresAt;
    writeEnvValues(defaultEnvFile(), updates);
    send(200, `YouTube account connected (channel ${channel.channelId}). You can close this window.`);
  } catch (err) {
    logger('YouTube OAuth callback failed');
    if (!res.headersSent) send(500,'YouTube authorization failed.');
  }
}

export function startCallbackServer() { return null; }

async function main() {
  if (has('--help') || has('-h')) {
    console.log(`
Usage:
  node scripts/youtube-auth.mjs --slot N --account NAME --authorize [--redirect-uri URI]
  node scripts/youtube-auth.mjs --slot N --account NAME --code CODE
  node scripts/youtube-auth.mjs --check --slot N
`);
    process.exit(0);
  }
  const envFile = value('--env-file') || process.env.CONTENT_OS_ENV_FILE || defaultEnvFile();
  let fileEnv = {};
  try { fileEnv = readEnvFile(envFile); } catch (err) { console.error(err.message); process.exit(1); }
  const clientId = process.env.YOUTUBE_CLIENT_ID || fileEnv.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET || fileEnv.YOUTUBE_CLIENT_SECRET;
  const redirectUri = value('--redirect-uri') || process.env.YOUTUBE_REDIRECT_URI || fileEnv.YOUTUBE_REDIRECT_URI;

  const slot = value('--slot') ? Number(value('--slot')) : null;
  const account = value('--account');

  if (has('--check')) {
    const token = fileEnv[`YOUTUBE_ACCOUNT_${slot}_ACCESS_TOKEN`];
    if (!token) { console.error('no token'); process.exit(1); }
    console.log(`Slot ${slot} account ${account} has token`);
    process.exit(0);
  }

  if (has('--serve') || has('--callback-server')) {
    console.error('Use the Content OS UI server (ui/server.mjs) for OAuth callbacks.');
    process.exit(1);
  }

  if (!Number.isInteger(slot) || slot < 1) { console.error('--slot required'); process.exit(1); }
  if (!account) { console.error('--account required'); process.exit(1); }

  if (has('--authorize')) {
    if (!clientId) { console.error('YOUTUBE_CLIENT_ID required'); process.exit(1); }
    if (!redirectUri) { console.error('YOUTUBE_REDIRECT_URI required'); process.exit(1); }
    const stateRecord = createOAuthState({ slot, account, redirectUri });
    const url = buildAuthorizationUrl({ clientId, redirectUri, state: stateRecord.state });
    console.log('Open this URL, authorize, then copy the code:');
    console.log(url);
    console.log(`Then run: node scripts/youtube-auth.mjs --slot ${slot} --account ${account} --code <CODE> --redirect-uri ${redirectUri}`);
    process.exit(0);
  }

  const code = value('--code');
  if (!code) { console.error('--code required'); process.exit(1); }
  if (!clientId || !clientSecret) { console.error('client credentials required'); process.exit(1); }
  if (!redirectUri) { console.error('redirect uri required'); process.exit(1); }

  const token = await exchangeAuthorizationCode({ code, clientId, clientSecret, redirectUri });
  const channel = await fetchChannelId(token.accessToken);
  const updates = {
    [`YOUTUBE_ACCOUNT_${slot}_NAME`]: String(account).toLowerCase(),
    [`YOUTUBE_ACCOUNT_${slot}_CHANNEL_ID`]: channel.channelId,
    [`YOUTUBE_ACCOUNT_${slot}_ACCESS_TOKEN`]: token.accessToken,
    [`YOUTUBE_ACCOUNT_${slot}_EXPIRES_AT`]: token.expiresAt,
    [`YOUTUBE_ACCOUNT_${slot}_SCOPE`]: token.scope,
  };
  if (token.refreshToken) updates[`YOUTUBE_ACCOUNT_${slot}_REFRESH_TOKEN`] = token.refreshToken;
  if (token.refreshExpiresAt) updates[`YOUTUBE_ACCOUNT_${slot}_REFRESH_EXPIRES_AT`] = token.refreshExpiresAt;
  writeEnvValues(envFile, updates);
  console.log(`Wrote ${envFile}. Channel: ${channel.channelId}`);
}

const isMain = import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main().catch((err) => { console.error(err.message); process.exit(1); });