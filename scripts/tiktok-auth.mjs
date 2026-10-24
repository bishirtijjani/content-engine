#!/usr/bin/env node
// TikTok Content Posting API setup and check.
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
//   Repeat with --slot 2 --account <second account>.
//
// Check:
//   node scripts/tiktok-auth.mjs --slot 1 --account main --check
//
// Public Direct Post requires the Content Posting API audit. Unaudited apps
// are limited to private viewing; the script reports that requirement.
import { randomBytes } from 'node:crypto';
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

if (has('--help') || has('-h')) {
  console.log(`
Usage:
  node scripts/tiktok-auth.mjs --slot N --account NAME --authorize
  node scripts/tiktok-auth.mjs --slot N --account NAME --code CODE
  node scripts/tiktok-auth.mjs --slot N --account NAME --check

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
  TIKTOK_ACCOUNT_<N>_PRIVACY_LEVEL=PUBLIC_TO_EVERYONE
`);
  process.exit(0);
}

const envFile = value('--env-file') || process.env.CONTENT_OS_ENV_FILE || defaultEnvFile();
const slot = Number(value('--slot'));
const account = (value('--account') || '').toLowerCase();
const env = process.env;

let fileEnv = {};
try {
  fileEnv = readEnvFile(envFile);
} catch (err) {
  console.error(`Cannot read ${envFile}: ${err.message}`);
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

const clientKey = env.TIKTOK_CLIENT_KEY || fileEnv.TIKTOK_CLIENT_KEY || null;
const clientSecret = env.TIKTOK_CLIENT_SECRET || fileEnv.TIKTOK_CLIENT_SECRET || null;
const redirectUri = value('--redirect-uri') || env.TIKTOK_REDIRECT_URI || fileEnv.TIKTOK_REDIRECT_URI || null;
const apiBase = 'https://open.tiktokapis.com';

try {
  if (has('--authorize')) {
    if (!clientKey || !redirectUri) {
      throw new Error('TIKTOK_CLIENT_KEY and TIKTOK_REDIRECT_URI are required');
    }
    const authorize = new URL('https://www.tiktok.com/v2/auth/authorize/');
    authorize.searchParams.set('client_key', clientKey);
    authorize.searchParams.set('scope', 'user.info.basic,video.publish');
    authorize.searchParams.set('response_type', 'code');
    authorize.searchParams.set('redirect_uri', redirectUri);
    authorize.searchParams.set('state', randomBytes(12).toString('hex'));

    console.log('Open this URL, authorize the account, then copy the code from the redirect:');
    console.log(authorize.toString());
    console.log(`Then run: node scripts/tiktok-auth.mjs --slot ${slot} --account ${account} --code <CODE>`);
    process.exit(0);
  }

  if (has('--check')) {
    const accessToken = fileEnv[`TIKTOK_ACCOUNT_${slot}_ACCESS_TOKEN`];
    if (!accessToken) {
      throw new Error(`no TIKTOK_ACCOUNT_${slot}_ACCESS_TOKEN in ${envFile}`);
    }
    const creator = await creatorInfo(accessToken, apiBase);
    printCreator(creator);
    console.log(`Credentials file: ${envFile}`);
    process.exit(0);
  }

  const code = value('--code') || env.TIKTOK_AUTHORIZATION_CODE;
  if (!code) throw new Error('--code is required (or use --authorize first)');
  if (!clientKey || !clientSecret) {
    throw new Error('TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET are required');
  }
  if (!redirectUri) {
    throw new Error('TIKTOK_REDIRECT_URI is required and must match the value used for authorization');
  }

  const token = await requestJson(`${apiBase}/v2/oauth/token/`, {
    method: 'POST',
    bodyType: 'form',
    body: {
      client_key: clientKey,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    },
    attempts: 3,
    timeoutMs: 30000,
  });

  if (token?.error) {
    throw new Error(token.error_description || token.error);
  }
  if (!token?.access_token || !token?.refresh_token || !token?.open_id) {
    throw new Error('TikTok did not return access_token, refresh_token and open_id');
  }

  const scopes = String(token.scope ?? '').split(',').map((scope) => scope.trim());
  if (!scopes.includes('video.publish')) {
    throw new Error(
      `the token does not include video.publish (granted: ${token.scope || 'none'}). ` +
      'Request video.publish in the TikTok app and authorize again.'
    );
  }

  const now = Date.now();
  const expiresAt = Number(token.expires_in) > 0
    ? new Date(now + Number(token.expires_in) * 1000).toISOString()
    : null;
  const refreshExpiresAt = Number(token.refresh_expires_in) > 0
    ? new Date(now + Number(token.refresh_expires_in) * 1000).toISOString()
    : null;

  const privacy = value('--privacy-level') || null;
  const updates = {
    TIKTOK_CLIENT_KEY: clientKey,
    TIKTOK_CLIENT_SECRET: clientSecret,
    TIKTOK_REDIRECT_URI: redirectUri,
    [`TIKTOK_ACCOUNT_${slot}_NAME`]: account,
    [`TIKTOK_ACCOUNT_${slot}_OPEN_ID`]: token.open_id,
    [`TIKTOK_ACCOUNT_${slot}_ACCESS_TOKEN`]: token.access_token,
    [`TIKTOK_ACCOUNT_${slot}_REFRESH_TOKEN`]: token.refresh_token,
    [`TIKTOK_ACCOUNT_${slot}_EXPIRES_AT`]: expiresAt,
    [`TIKTOK_ACCOUNT_${slot}_REFRESH_EXPIRES_AT`]: refreshExpiresAt,
    [`TIKTOK_ACCOUNT_${slot}_SCOPE`]: token.scope,
    [`TIKTOK_ACCOUNT_${slot}_MODE`]: 'direct',
  };
  if (privacy) updates[`TIKTOK_ACCOUNT_${slot}_PRIVACY_LEVEL`] = privacy;

  writeEnvValues(envFile, updates);

  const creator = await creatorInfo(token.access_token, apiBase);
  console.log(`Wrote ${envFile} (mode 600).`);
  console.log(`Slot: ${slot}  Account: ${account}`);
  console.log(`Scopes: ${token.scope}`);
  console.log(`Access token expires: ${expiresAt ?? 'unknown'}`);
  console.log(`Refresh token expires: ${refreshExpiresAt ?? 'unknown'}`);
  printCreator(creator);
  console.log('Public Direct Post requires the TikTok Content Posting API audit.');
  console.log(`Set TIKTOK_ACCOUNT_${slot}_PRIVACY_LEVEL to an allowed public option after the audit.`);
} catch (err) {
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
}

async function creatorInfo(accessToken, base) {
  const body = await requestJson(`${base}/v2/post/publish/creator_info/query/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    attempts: 3,
    timeoutMs: 30000,
  });
  const code = body?.error?.code;
  if (code && code !== 'ok') {
    throw new Error(body.error.message || code);
  }
  return body?.data ?? {};
}

function printCreator(creator) {
  console.log(`Creator: @${creator.creator_username ?? '(unknown)'} (${creator.creator_nickname ?? ''})`);
  console.log(`Privacy options: ${(creator.privacy_level_options ?? []).join(', ') || 'none'}`);
  console.log(`Max video duration: ${creator.max_video_post_duration_sec ?? 'unknown'}s`);
}
