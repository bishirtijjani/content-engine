---
name: distribution
description: Schedule and publish approved content to Instagram and TikTok. Use when the user says "schedule this", "publish it", "put it on Instagram/TikTok", "run distribution", "check publishing", or asks why a post did not go out. Handles platform copy, slots, retries, and restart-safe publish state.
---

# Distribution

The distribution engine is a library plus a one-shot worker. It never writes
content and never approves a human gate.

## Preconditions

1. The item is in `scheduled`. Production moves it there only after the human
   approves the `asset_review` gate.
2. The post's asset is `approved`. Publishing re-checks this and refuses
   anything else.
3. `settings.distribution.accounts` names the Instagram Creator account and
   both TikTok accounts. Names must match the `.env`.
4. The agent has written per-platform copy. The engine validates it; it never
   generates it.

Never approve a gate, invent copy, invent credentials, or publish an asset the
human has not approved.

## Commands

All commands run from `/opt/docker/apps/content-os/repo`. Always pass
`--disable-warning=ExperimentalWarning`.

```bash
# Schedule eligible items and publish due posts
node scripts/distribution-worker.mjs --schedule --publish --cleanup --json

# One item only
node scripts/distribution-worker.mjs --target 2 --json

# Adapt with agent-written copy, then schedule
node scripts/distribution-worker.mjs --adapt --copy-file /path/copy.json --target 2

# Check what is configured without publishing
node scripts/distribution-worker.mjs --no-publish --no-cleanup --json
```

The worker takes an exclusive lock. A second run exits with `status: "locked"`.
It logs a `worker` row to `engine_logs` on non-dry passes.

Each post is claimed atomically with a lease, so a manual `engine.publish()` and
the worker cannot publish the same post concurrently. A crashed process leaves
an expired lease that the next pass reclaims. Never edit the claim columns by
hand.

`--dry-run` is side-effect-free: no claims, posts, calendar rows, logs, media
cleanup, or migration. It refuses a database below schema v7. Use it to inspect
a pass safely; it cannot publish.

## Copy contract

```json
{
  "instagram": { "caption": "...", "hashtags": ["#..."] },
  "tiktok:main": { "caption": "...", "hashtags": ["#..."] },
  "tiktok:clips": { "caption": "...", "hashtags": ["#..."] }
}
```

Lookup order: `platform:account`, `platform`, `default`.

## Reading results

- `posts.status` is `scheduled`, `published`, `failed`, or `skipped`.
- `posts.external_id` is the platform id.
- `posts.publish_state` is provider state. Do not clear it by hand.
- `posts.publish_error` is the last failure.

If `publish_state` says `publishing` for Instagram or `initiating` for TikTok,
a request may have reached the platform. Check the account before doing
anything. Do not re-adapt the post: `adapt()` refuses to change copy while an
in-flight state exists.

Only after confirming there is no existing post:

```bash
node scripts/distribution-worker.mjs --reset-post <POST_ID> --confirm
```

## Accounts and credentials

- Credentials live in `/opt/docker/apps/content-os/.env`, mode 600.
- Instagram setup: `scripts/instagram-auth.mjs`. The engine uses Graph API
  v26.0, enforces 300 MB / 3 s-15 min / 23-60 fps, and polls once per minute.
- TikTok setup: `scripts/tiktok-auth.mjs --slot N --account NAME`.
- TikTok public Direct Post requires the Content Posting API audit. Without it,
  the API restricts posts to private viewing; report that blocker.
- Two TikTok accounts are independent: separate open IDs, access tokens,
  refresh tokens, and slots.

Do not ask the user for tokens or passwords in chat. Point to the setup script
and the `.env` path.

## Schedule

Defaults: `Africa/Lagos`, Monday-Friday, 18:00 local, 60 minutes between
different items, 56-day horizon, cadence from `settings.platforms`. All
accounts of one item share one slot; each post has its own calendar row.

## Do not

- Do not run the worker against the live database or publish real posts unless
  the user explicitly asks for a real test.
- Do not modify Production or video encoding.
- Do not delete media or posts to work around a failure.
- Do not create a second upload or container after an ambiguous result.
