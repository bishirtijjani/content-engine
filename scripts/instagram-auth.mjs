#!/usr/bin/env node
// Instagram Creator setup and health check.
//
// Default credentials file is the deployment .env:
//   /opt/docker/apps/content-os/.env   (mode 600)
// Override with --env-file or CONTENT_OS_ENV_FILE.
//
// Setup:
//   INSTAGRAM_APP_ID=... INSTAGRAM_APP_SECRET=... \
//   INSTAGRAM_USER_ID=1784... INSTAGRAM_SHORT_LIVED_TOKEN=... \
//   node scripts/instagram-auth.mjs
//
// Check:
//   node scripts/instagram-auth.mjs --check
//
// The short-lived token comes from the Graph API Explorer with
// instagram_basic and instagram_content_publish. This script exchanges it for
// a 60-day token and writes it to the .env. Secrets are never printed.
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
  node scripts/instagram-auth.mjs [--account creator] [--env-file PATH]
  node scripts/instagram-auth.mjs --check [--account creator]

Environment:
  INSTAGRAM_APP_ID
  INSTAGRAM_APP_SECRET
  INSTAGRAM_USER_ID
  INSTAGRAM_SHORT_LIVED_TOKEN
  INSTAGRAM_ACCOUNT        (default: creator)
  INSTAGRAM_API_VERSION    (default: v26.0)
  CONTENT_OS_ENV_FILE      (default: /opt/docker/apps/content-os/.env)
`);
  process.exit(0);
}

const account = (value('--account') || process.env.INSTAGRAM_ACCOUNT || 'creator').toLowerCase();
const envFile = value('--env-file') || process.env.CONTENT_OS_ENV_FILE || defaultEnvFile();

let fileEnv = {};
try {
  fileEnv = readEnvFile(envFile);
} catch (err) {
  console.error(`Cannot read ${envFile}: ${err.message}`);
  process.exit(1);
}

const apiVersion = value('--api-version')
  || process.env.INSTAGRAM_API_VERSION
  || fileEnv.INSTAGRAM_API_VERSION
  || 'v26.0';
const base = `https://graph.facebook.com/${apiVersion}`;

try {
  if (has('--check')) {
    const token = process.env.INSTAGRAM_ACCESS_TOKEN || fileEnv.INSTAGRAM_ACCESS_TOKEN;
    const userId = process.env.INSTAGRAM_USER_ID || fileEnv.INSTAGRAM_USER_ID;
    if (!token || !userId) {
      throw new Error(`no access token for '${account}' in ${envFile}`);
    }

    const profile = await graph(userId, token, { fields: 'id,username' });
    const quota = await quotaFor(userId, token);

    console.log(`Credentials file: ${envFile}`);
    console.log(`Account: @${profile.username ?? '(unknown)'}`);
    console.log(`User id: ${profile.id ?? userId}`);
    console.log(`Token expires: ${fileEnv.INSTAGRAM_TOKEN_EXPIRES_AT ?? 'unknown'}`);
    if (quota) console.log(`Publishing quota: ${quota.usage}/${quota.total} used`);
    process.exit(0);
  }

  const appId = process.env.INSTAGRAM_APP_ID || fileEnv.INSTAGRAM_APP_ID || null;
  const appSecret = process.env.INSTAGRAM_APP_SECRET || fileEnv.INSTAGRAM_APP_SECRET || null;
  const userId = value('--user-id') || process.env.INSTAGRAM_USER_ID || fileEnv.INSTAGRAM_USER_ID || null;
  const shortToken = value('--token') || process.env.INSTAGRAM_SHORT_LIVED_TOKEN || null;

  if (!appId || !appSecret) {
    throw new Error('INSTAGRAM_APP_ID and INSTAGRAM_APP_SECRET are required');
  }
  if (!userId) throw new Error('INSTAGRAM_USER_ID is required');
  if (!shortToken) {
    throw new Error('INSTAGRAM_SHORT_LIVED_TOKEN is required (Graph API Explorer token)');
  }

  const exchange = new URL(`${base}/oauth/access_token`);
  exchange.searchParams.set('grant_type', 'fb_exchange_token');
  exchange.searchParams.set('client_id', appId);
  exchange.searchParams.set('client_secret', appSecret);
  exchange.searchParams.set('fb_exchange_token', shortToken);

  const longLived = await requestJson(exchange.toString(), {
    attempts: 3,
    timeoutMs: 30000,
  });
  if (!longLived?.access_token) {
    throw new Error('Meta did not return a long-lived access token');
  }

  const profile = await graph(userId, longLived.access_token, {
    fields: 'id,username',
  });

  const expiresIn = Number(longLived.expires_in);
  const expiresAt = Number.isFinite(expiresIn) && expiresIn > 0
    ? new Date(Date.now() + expiresIn * 1000).toISOString()
    : null;

  writeEnvValues(envFile, {
    INSTAGRAM_APP_ID: appId,
    INSTAGRAM_APP_SECRET: appSecret,
    INSTAGRAM_API_VERSION: apiVersion,
    INSTAGRAM_ACCOUNT: account,
    INSTAGRAM_USER_ID: userId,
    INSTAGRAM_ACCESS_TOKEN: longLived.access_token,
    INSTAGRAM_TOKEN_EXPIRES_AT: expiresAt,
  });

  const quota = await quotaFor(userId, longLived.access_token);

  console.log(`Wrote ${envFile} (mode 600).`);
  console.log(`Account: @${profile.username ?? '(unknown)'}`);
  console.log(`User id: ${profile.id ?? userId}`);
  console.log(`Token expires: ${expiresAt ?? 'unknown'}`);
  if (quota) console.log(`Publishing quota: ${quota.usage}/${quota.total} used`);
  console.log('Next: set settings.distribution.accounts to include instagram/creator.');
} catch (err) {
  if (err instanceof HttpError) {
    const message = err.body?.error?.message || err.message;
    console.error(`Instagram setup failed: ${message}`);
  } else {
    console.error(`Instagram setup failed: ${err.message}`);
  }
  process.exit(1);
}

async function graph(userId, token, query) {
  const url = new URL(`${base}/${userId}`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return requestJson(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
    attempts: 3,
    timeoutMs: 30000,
  });
}

async function quotaFor(userId, token) {
  try {
    const url = new URL(`${base}/${userId}/content_publishing_limit`);
    url.searchParams.set('fields', 'quota_usage,config');
    const body = await requestJson(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      attempts: 3,
      timeoutMs: 30000,
    });
    const entry = Array.isArray(body?.data) ? body.data[0] : null;
    if (!entry) return null;
    return {
      usage: Number(entry.quota_usage ?? 0),
      total: Number(entry.config?.quota_total ?? entry.quota_total ?? 0),
    };
  } catch {
    return null;
  }
}
