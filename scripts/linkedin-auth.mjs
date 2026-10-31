#!/usr/bin/env node
// LinkedIn OAuth 2.0 setup and callback.
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync, chmodSync, renameSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makePaths } from '../packages/core/src/paths.js';
import { defaultEnvFile, readEnvFile, writeEnvValues } from '../packages/engine-distribution/src/credentials.mjs';
import { HttpError, requestJson } from '../packages/engine-distribution/src/publishers/http.mjs';

const args = process.argv.slice(2);
const value = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const has = (flag) => args.includes(flag);

const DEFAULT_API_BASE = 'https://api.linkedin.com';
const DEFAULT_AUTH_BASE = 'https://www.linkedin.com';
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const SCOPES = 'openid profile w_member_social';

function oauthStatePath() {
  const dir = makePaths().tmpDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return path.join(dir, 'linkedin-oauth-state.json');
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
  const record = {
    state: randomBytes(32).toString('base64url'),
    slot: Number(slot),
    account: String(account).toLowerCase(),
    redirectUri,
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
  const idx = store.states.findIndex((r) => r.state === state);
  if (idx < 0) return null;
  const [record] = store.states.splice(idx, 1);
  saveOAuthStates(store.states);
  if (Date.parse(record.expiresAt) <= Date.now()) return null;
  return record;
}

export function buildAuthorizationUrl({ clientId, redirectUri, state }) {
  const url = new URL(`${DEFAULT_AUTH_BASE}/oauth/v2/authorization`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', SCOPES);
  url.searchParams.set('state', state);
  return url.toString();
}

export async function exchangeAuthorizationCode({ code, clientId, clientSecret, redirectUri }) {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  });
  const token = await requestJson(`${DEFAULT_AUTH_BASE}/oauth/v2/accessToken`, {
    method: 'POST',
    bodyType: 'form',
    body: Object.fromEntries(params),
    attempts: 3,
    timeoutMs: 30000,
  });
  if (token?.error) throw new Error(token.error_description || token.error);
  if (!token?.access_token) throw new Error('LinkedIn did not return an access token');
  const now = Date.now();
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? null,
    expiresAt: token.expires_in ? new Date(now + Number(token.expires_in) * 1000).toISOString() : null,
    refreshExpiresAt: token.refresh_token_expires_in ? new Date(now + Number(token.refresh_token_expires_in) * 1000).toISOString() : null,
    scope: token.scope ?? SCOPES,
  };
}

export async function fetchMemberUrn(accessToken) {
  const info = await requestJson(`${DEFAULT_API_BASE}/v2/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    attempts: 3,
    timeoutMs: 30000,
  });
  const sub = info?.sub;
  if (!sub) throw new Error('LinkedIn userinfo did not return a member id');
  return { memberUrn: `urn:li:person:${sub}`, name: info?.name ?? null };
}

export async function handleCallbackRequest(req, res, deps = {}) {
  const readEnv = deps.readEnv ?? (() => readEnvFile(defaultEnvFile()));
  const consumeState = deps.consumeState ?? consumeOAuthState;
  const exchangeCode = deps.exchangeCode ?? exchangeAuthorizationCode;
  const fetchMember = deps.fetchMember ?? fetchMemberUrn;
  const saveTokens = deps.saveTokens ?? null;
  const logger = deps.logger ?? console.error;

  const send = (status, body) => {
    if (!res.headersSent) {
      res.statusCode = status;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
    }
    res.end(body);
  };

  try {
    if (req.method !== 'GET') { send(405, 'Method not allowed.'); return; }
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname === '/healthz') { send(200, 'ok'); return; }
    if (url.pathname !== '/linkedin/callback') { send(404, 'Not found.'); return; }

    const oauthError = url.searchParams.get('error');
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (oauthError) { send(400, 'LinkedIn authorization failed.'); return; }
    if (!code || !state) { send(400, 'Missing authorization code or state.'); return; }

    const metadata = consumeState(state);
    if (!metadata) { send(400, 'Invalid or expired authorization state.'); return; }

    const env = readEnv();
    const clientId = env.LINKEDIN_CLIENT_ID;
    const clientSecret = env.LINKEDIN_CLIENT_SECRET;
    if (!clientId || !clientSecret) { send(500, 'LinkedIn authorization failed.'); return; }

    let token;
    try {
      token = await exchangeCode({ code, clientId, clientSecret, redirectUri: metadata.redirectUri });
    } catch (err) {
      logger('LinkedIn OAuth callback failed');
      send(500, 'LinkedIn authorization failed.');
      return;
    }

    const member = await fetchMember(token.accessToken);

    if (saveTokens) {
      await saveTokens({
        envFile: defaultEnvFile(),
        slot: metadata.slot,
        account: metadata.account,
        token: { ...token, memberUrn: member.memberUrn },
        redirectUri: metadata.redirectUri,
        env,
      });
    } else {
      // fallback write
      const updates = {
        [`LINKEDIN_ACCOUNT_${metadata.slot}_NAME`]: metadata.account,
        [`LINKEDIN_ACCOUNT_${metadata.slot}_MEMBER_URN`]: member.memberUrn,
        [`LINKEDIN_ACCOUNT_${metadata.slot}_ACCESS_TOKEN`]: token.accessToken,
        [`LINKEDIN_ACCOUNT_${metadata.slot}_EXPIRES_AT`]: token.expiresAt,
        [`LINKEDIN_ACCOUNT_${metadata.slot}_SCOPE`]: token.scope,
      };
      if (token.refreshToken) updates[`LINKEDIN_ACCOUNT_${metadata.slot}_REFRESH_TOKEN`] = token.refreshToken;
      if (token.refreshExpiresAt) updates[`LINKEDIN_ACCOUNT_${metadata.slot}_REFRESH_EXPIRES_AT`] = token.refreshExpiresAt;
      writeEnvValues(defaultEnvFile(), updates);
    }

    send(200, `LinkedIn account connected (${member.name ?? member.memberUrn}). You can close this window.`);
  } catch (err) {
    logger('LinkedIn OAuth callback failed');
    if (!res.headersSent) send(500, 'LinkedIn authorization failed.');
  }
}

// Callback serving is centralized in ui/server.mjs.
export function startCallbackServer() { return null; }

async function main() {
  if (has('--help') || has('-h')) {
    console.log(`
Usage:
  node scripts/linkedin-auth.mjs --slot N --account NAME --authorize [--redirect-uri URI]
  node scripts/linkedin-auth.mjs --slot N --account NAME --code CODE
  node scripts/linkedin-auth.mjs --serve [--host HOST] [--port PORT]
  node scripts/linkedin-auth.mjs --check --slot N
`);
    process.exit(0);
  }

  const envFile = value('--env-file') || process.env.CONTENT_OS_ENV_FILE || defaultEnvFile();
  let fileEnv = {};
  try { fileEnv = readEnvFile(envFile); } catch (err) { console.error(err.message); process.exit(1); }

  const clientId = process.env.LINKEDIN_CLIENT_ID || fileEnv.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET || fileEnv.LINKEDIN_CLIENT_SECRET;
  const redirectUri = value('--redirect-uri') || process.env.LINKEDIN_REDIRECT_URI || fileEnv.LINKEDIN_REDIRECT_URI;

  if (has('--serve') || has('--callback-server')) {
    console.error('Use the Content OS UI server (ui/server.mjs) for OAuth callbacks.');
    process.exit(1);
  }

  const slot = value('--slot') ? Number(value('--slot')) : null;
  const account = value('--account');

  if (has('--check')) {
    const token = fileEnv[`LINKEDIN_ACCOUNT_${slot}_ACCESS_TOKEN`];
    if (!token) { console.error('no token'); process.exit(1); }
    const memberUrn = fileEnv[`LINKEDIN_ACCOUNT_${slot}_MEMBER_URN`];
    console.log(`Slot ${slot} account ${account} memberUrn ${memberUrn}`);
    process.exit(0);
  }

  if (!Number.isInteger(slot) || slot < 1) { console.error('--slot required'); process.exit(1); }
  if (!account) { console.error('--account required'); process.exit(1); }

  if (has('--authorize')) {
    if (!clientId) { console.error('LINKEDIN_CLIENT_ID required'); process.exit(1); }
    if (!redirectUri) { console.error('LINKEDIN_REDIRECT_URI required'); process.exit(1); }
    const stateRecord = createOAuthState({ slot, account, redirectUri });
    const url = buildAuthorizationUrl({ clientId, redirectUri, state: stateRecord.state });
    console.log('Open this URL, authorize, then copy the code:');
    console.log(url);
    console.log(`Then run: node scripts/linkedin-auth.mjs --slot ${slot} --account ${account} --code <CODE> --redirect-uri ${redirectUri}`);
    process.exit(0);
  }

  const code = value('--code');
  if (!code) { console.error('--code required'); process.exit(1); }
  if (!clientId || !clientSecret) { console.error('client credentials required'); process.exit(1); }
  if (!redirectUri) { console.error('redirect uri required'); process.exit(1); }

  const token = await exchangeAuthorizationCode({ code, clientId, clientSecret, redirectUri });
  const member = await fetchMemberUrn(token.accessToken);
  const updates = {
    [`LINKEDIN_ACCOUNT_${slot}_NAME`]: String(account).toLowerCase(),
    [`LINKEDIN_ACCOUNT_${slot}_MEMBER_URN`]: member.memberUrn,
    [`LINKEDIN_ACCOUNT_${slot}_ACCESS_TOKEN`]: token.accessToken,
    [`LINKEDIN_ACCOUNT_${slot}_EXPIRES_AT`]: token.expiresAt,
    [`LINKEDIN_ACCOUNT_${slot}_SCOPE`]: token.scope,
  };
  if (token.refreshToken) updates[`LINKEDIN_ACCOUNT_${slot}_REFRESH_TOKEN`] = token.refreshToken;
  if (token.refreshExpiresAt) updates[`LINKEDIN_ACCOUNT_${slot}_REFRESH_EXPIRES_AT`] = token.refreshExpiresAt;
  writeEnvValues(envFile, updates);
  console.log(`Wrote ${envFile}. Member: ${member.memberUrn} (${member.name})`);
}

const isMain = import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main().catch((err) => { console.error(err.message); process.exit(1); });