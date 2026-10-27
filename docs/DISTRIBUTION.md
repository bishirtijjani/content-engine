# Distribution operations

The distribution engine is a library plus a one-shot worker. It never writes
content and never approves a human gate.

```
scheduled item + approved asset
  -> adapt (agent copy)
  -> schedule (UTC slots + calendar rows)
  -> worker (systemd timer)
  -> publish (Instagram / TikTok)
  -> published / failed with publish_state preserved
```

## Preconditions

- The item is in `scheduled`. Production's `schedule()` moves it there only
  after an approved `asset_review` gate.
- The asset used by the post is `approved`. Publishing re-checks this and
  refuses anything else.
- `settings.distribution.accounts` names every account. Names must match the
  `.env` names exactly.

```js
db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('distribution', ?)").run(
  JSON.stringify({
    accounts: [
      { platform: 'instagram', account: 'creator', type: 'creator', authorized: true },
      { platform: 'tiktok', account: 'main', authorized: true },
      { platform: 'tiktok', account: 'clips', authorized: true }
    ]
  })
);
```

Without this setting the engines fall back to one `default` account per
platform from `settings.platforms`.

## Copy

The agent writes platform copy; the engine validates it. `adapt()` needs a copy
map:

```js
const copy = {
  'tiktok:main': { caption: 'Main account caption', hashtags: ['#automation'] },
  tiktok: { caption: 'Fallback for the second account', hashtags: ['#automation'] },
  instagram: { caption: 'Instagram caption', hashtags: ['#software'] }
};

engine.adapt({ targetId: 2, copy });
```

Lookup order is `platform:account`, then `platform`, then `default`. If no copy
exists for an account, that account is skipped. The worker never generates copy.

## Schedule

`engine.schedule()` uses `settings.distribution.schedule` or these defaults:

- timezone `Africa/Lagos`
- Monday-Friday
- 18:00 local
- 60 minutes between different items
- 56-day horizon
- cadence from `settings.platforms`

One slot is shared by all accounts of an item. Each post gets its own
`calendar_entries` row. Published posts are never moved. An unresolved publish
state blocks copy changes.

## Publishing claims, crashes and dry runs

Each post is claimed atomically before any publisher call. The lease lives in
`posts.publish_claim_id` / `publish_claim_expires_at` (schema v7), is renewed
before every attempt, and is released on success or failure. A second worker or
a manual `engine.publish()` sees the lease and skips the post, so concurrent
callers cannot publish it twice. A crashed process leaves an expired lease that
the next pass can reclaim.

`--dry-run` is side-effect-free:

- no publish claims or post/calendar rows
- no `engine_logs` rows, including the worker row
- no media cleanup
- no schema migration

A dry run against a database below schema v7 is refused; run once without
`--dry-run` to migrate. The worker PID lock is bounded and replaces a live PID
whose lock is older than two hours.

## Credentials

Path: `/opt/docker/apps/content-os/.env`, mode `600`, outside the repository.

```
# Instagram
INSTAGRAM_ACCOUNT=creator
INSTAGRAM_API_VERSION=v26.0
INSTAGRAM_APP_ID=...
INSTAGRAM_APP_SECRET=...
INSTAGRAM_USER_ID=1784...
INSTAGRAM_ACCESS_TOKEN=...
INSTAGRAM_TOKEN_EXPIRES_AT=...

# nginx media
MEDIA_HOST_PROVIDER=nginx
MEDIA_HOST_PUBLIC_BASE_URL=https://files.codeket.com/media
MEDIA_HOST_ROOT_DIR=/opt/docker/apps/content-os/media
MEDIA_HOST_KEY_PREFIX=instagram
MEDIA_HOST_TTL_HOURS=24

# TikTok app (shared by both accounts)
TIKTOK_CLIENT_KEY=...
TIKTOK_CLIENT_SECRET=...
TIKTOK_REDIRECT_URI=https://your-registered-redirect

# TikTok account 1
TIKTOK_ACCOUNT_1_NAME=main
TIKTOK_ACCOUNT_1_OPEN_ID=...
TIKTOK_ACCOUNT_1_ACCESS_TOKEN=...
TIKTOK_ACCOUNT_1_REFRESH_TOKEN=...
TIKTOK_ACCOUNT_1_EXPIRES_AT=...
TIKTOK_ACCOUNT_1_REFRESH_EXPIRES_AT=...
TIKTOK_ACCOUNT_1_PRIVACY_LEVEL=PUBLIC_TO_EVERYONE

# TikTok account 2
TIKTOK_ACCOUNT_2_NAME=clips
...
```

Never commit this file. The loader also accepts `CONTENT_OS_ENV_FILE` and a
JSON credentials file for other deployments.

## Media hosting

Instagram requires a public video URL. The nginx media host hardlinks the
render into `/opt/docker/apps/content-os/media`, under an unguessable path,
and returns `https://files.codeket.com/media/...`. The link is removed after a
successful publish; files older than `TTL_HOURS` are removed by the worker.

nginx must mount the directory read-only and serve it:

```nginx
location /media/ {
    alias /var/www/content-os-media/;
    autoindex off;
    add_header Cache-Control "no-store";
    add_header X-Content-Type-Options "nosniff";
}
```

TikTok uses `FILE_UPLOAD`, so it does not use the media host.

## Instagram setup

1. Create a Meta app and link the Instagram Creator account to a Facebook Page.
2. Permissions: `instagram_basic`, `instagram_content_publish`,
   `pages_read_engagement`, `pages_show_list`.
3. Generate a short-lived token in the Graph API Explorer.
4. Run:

```bash
cd /opt/docker/apps/content-os/repo
INSTAGRAM_APP_ID=... \
INSTAGRAM_APP_SECRET=... \
INSTAGRAM_USER_ID=1784... \
INSTAGRAM_SHORT_LIVED_TOKEN=... \
node --disable-warning=ExperimentalWarning scripts/instagram-auth.mjs

node --disable-warning=ExperimentalWarning scripts/instagram-auth.mjs --check
```

Long-lived tokens refresh automatically within 7 days of expiry and are written
back to the `.env`. Set `INSTAGRAM_API_VERSION=v26.0` (or omit it; the default is
now v26.0).

Instagram Reels requires a portrait master. The publisher refuses landscape
assets. It enforces Meta's documented limits: 300 MB, 3 seconds to 15 minutes,
23-60 fps, and verifies fps with ffprobe. It polls the container once per minute
for at most five minutes, per Meta's guidance. `media_publish` partial successes
(`config_issue`, caption add-on attachment) remain published and are recorded in
`engine_logs`.

The Production engine currently makes one master that follows the footage
orientation or `output.orientation`; it does not make per-platform cuts.

## TikTok setup

1. Create a TikTok developer app, add Login Kit and Content Posting API.
2. Request `user.info.basic`, `video.publish`, and `video.upload`.
3. Register the redirect URI.
4. Authorize each account separately:

```bash
node --disable-warning=ExperimentalWarning scripts/tiktok-auth.mjs \
  --slot 1 --account main --authorize

node --disable-warning=ExperimentalWarning scripts/tiktok-auth.mjs \
  --slot 1 --account main --code <CODE>

node --disable-warning=ExperimentalWarning scripts/tiktok-auth.mjs \
  --slot 2 --account clips --authorize

node --disable-warning=ExperimentalWarning scripts/tiktok-auth.mjs \
  --slot 2 --account clips --code <CODE>
```

Check either account:

```bash
node --disable-warning=ExperimentalWarning scripts/tiktok-auth.mjs \
  --slot 1 --account main --check
```

The publisher uses Direct Post with `FILE_UPLOAD` and chunks per the official
limits. Access tokens live 24 hours and refresh tokens 365 days; both are
refreshed automatically and written back to the same slot.

**External blocker:** public Direct Post requires the Content Posting API audit.
Unaudited clients can only post to private accounts and receive
`unaudited_client_can_only_post_to_private_accounts` at init. Inbox upload is
not used because it requires manual completion in the TikTok app.

## Worker

One pass:

```bash
cd /opt/docker/apps/content-os/repo
node --disable-warning=ExperimentalWarning scripts/distribution-worker.mjs \
  --schedule --publish --cleanup --json
```

Optional adaptation with explicit copy:

```bash
node --disable-warning=ExperimentalWarning scripts/distribution-worker.mjs \
  --adapt --copy-file /path/to/copy.json --target 2
```

Recovery after a human confirms no duplicate exists:

```bash
node --disable-warning=ExperimentalWarning scripts/distribution-worker.mjs \
  --reset-post <POST_ID> --confirm
```

The worker takes an exclusive PID lock at `data/tmp/distribution-worker.lock`.
A second run exits without working. A stale PID is replaced, bounded retries
avoid lock recursion, and a live PID older than two hours is treated as stale.
Each non-dry pass writes a `worker` row to `engine_logs`.

```bash
# Side-effect-free inspection
node scripts/distribution-worker.mjs --dry-run --json
```

## Systemd

Copy `deploy/systemd/content-os-distribution.service` and `.timer` to
`/etc/systemd/system/`, then:

```bash
systemctl daemon-reload
systemctl enable --now content-os-distribution.timer
systemctl list-timers content-os-distribution.timer
journalctl -u content-os-distribution.service -n 100 --no-pager
```

The service runs as root because the repository and `.env` are root-owned. If
you change ownership, update `User=`, `Group=`, and file permissions.

The timer runs every 5 minutes with `Persistent=true`. It does not need a
daemon: posts and publish state live in SQLite.

## Recovery rules

- `publish_state` is written before every irreversible step.
- `adapt()` refuses to change copy while a container, upload or publish is in
  progress or unresolved.
- Instagram recovery matches a caption hash and a time window. Zero matches
  means not published; more than one match is ambiguous and is never guessed.
- TikTok treats a lost init response as ambiguous and refuses to create a
  second upload.
- Use `--reset-post ... --confirm` only after checking the platform for an
  existing post.

## Tests

```bash
node --disable-warning=ExperimentalWarning --test packages/engine-distribution/test/*.test.js
npm test
```

The publisher tests run the production code against a deterministic HTTP
transport. They do not call Meta or TikTok.
