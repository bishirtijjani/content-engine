# AGENTS.md — how to operate content-os

Read this before touching anything. It tells you what the system is, who does
what, and the exact rules that keep it working.

## Communication style (required)

- No idioms, no metaphors, no figures of speech. Say things directly.
- Short, direct sentences. No filler phrases or unnecessary words.
- When there are multiple issues, answer each one separately.
- Keep technical detail; remove decorative language.
- Present results in a complete, readable format the first time — tables for
  ranked lists, URLs for rendered artifacts. Never make the human ask for
  details that belong in the first response.

## What this is

A content automation engine for Bishir Tijjani (custom software & AI).
It takes fresh ideas → scored picks → planned topics → researched → finished
scripts → **ready to shoot**, then cleans the raw recording and turns it into a
**finished, on-brand video**. The master's orientation follows the footage:
portrait footage makes a portrait (9:16) master, landscape makes landscape
(16:9). A plan can override it with `output.orientation`. Other shapes are
derived from the master. Publishing lives downstream.

Architecture: deterministic engines ("muscle") + AI agent ("brain"), sharing
one SQLite database (`data/content.db`). Zero npm runtime deps; `node:sqlite`.

## The division of labor

- **The engine never writes content.** `research()` and `script()` only
  FINALIZE agent-written content and request human gates.
- **The agent never moves state directly.** Use engine actions; they enforce
  the state machine, gates, validation, and audit trail.
- **Humans decide gates.** Never approve a gate on the human's behalf.

## The loop

```
addIdeas() → evaluate() → [human: idea_approval] → plan()
→ agent writes research_notes → research()
→ agent writes script (structured JSON) → script() → render
→ [human: script_review] → ready() → ready_to_shoot
```

`ready()` also creates `data/item-<id>/` and writes `script.txt` there (the spoken
lines, one per line). The human records by reading it, then the clean and
production steps both work from that folder.

Rejected at script review? Agent edits the script, then
`engine.resubmit({ targetId })` requests a fresh review.

## Engine actions

```js
import { connect } from '@content-os/core';
import { ContentEngine } from '@content-os/engine-content';
const engine = new ContentEngine(connect());

engine.addIdeas([{ title, source, pillar, hook_style, priority, tags }]); // fresh ideas only
engine.run({ action })   // discover | evaluate | plan | research | script | ready | resubmit
engine.run({ targetId }) // single item
engine.run({ dryRun: true })
```

- `discover()` — picks up audience ideas from engagement items
- `evaluate()` — scores 0–100 (writes `evaluation_score`/`evaluation_reason`),
  requests idea_approval gates
- `plan()` — fills pillar/format/hook/length/angle/CTA after gate approval
- `research()` / `script()` — finalize agent-written content; skip + log
  anything missing or structurally invalid (placeholders, wrong length,
  plain-text scripts)
- `ready()` — moves gate-approved scripts to `ready_to_shoot`
- `resubmit({ targetId })` — revision loop after a rejected script review

## Script contract

`content_items.script` is structured JSON:

```json
{ "hook": "...", "script": "spoken words only",
  "points": [{ "title": "...", "detail": "..." }],
  "cta": "...", "shot_notes": "..." }
```

Narration length must match `desired_length_seconds × 2.5 words/sec ±20%`
(default 60s → 120–180 words). Thresholds come from
`settings.script_framework.length_math`. Read `settings.script_framework`
before writing — hooks, structure beats, voice, platform fit, checklist.

## Data layout — one folder per item

`data/` (gitignored) has ONE shape, and `packages/core/src/paths.js` is the only
place that decides it. Never hand-build a path into `data/`.

| Path | What lives there |
|---|---|
| `data/content.db` | the database |
| `data/inbox/` | raw footage nobody has attached yet (`list_footage` scans it) |
| `data/item-<id>/` | **one folder per `content_items.id`** — everything that item owns, flat |
| `data/item-<id>/source.mp4` | the recording (`process_footage` adopts it; ONE copy on disk) |
| `data/item-<id>/source.transcript.json` | its transcript — always a sibling of the video it describes |
| `data/item-<id>/script.txt` | the spoken lines the human records from (`ready()`) |
| `data/item-<id>/script.json` | mirror of `content_items.script` — the DB stays the source of truth |
| `data/item-<id>/<name>.cleaned.mp4`, `.review.json`, `.cuts.json`, … | cleaner outputs |
| `data/item-<id>/production/` | production work: `snapshots.plan.json`, `index.html`, `plan/` (stills, html, beats, contact sheet) |
| `data/renders/` | **finished videos only** + detached render logs `_job.out` / `_job.err` / `_job.pid` |
| `data/tmp/` | scratch — HyperFrames work dirs, test output. Never real data |

**The rule:** a file belongs to an item → `data/item-<id>/`. It is a finished
deliverable → `data/renders/`. Neither → `data/tmp/` or delete it. Nothing else
may sit directly under `data/`.

- **The item's id decides the folder**, never a plan's free-text `video.id` —
  that is how `data/compositions/{video,sg-smoke,agent-loop,item-fin,…}` got
  minted one ad-hoc plan at a time. `save_snapshot_plan` stamps `video.item` and
  the plan tools resolve against it, refuse to resolve to nothing, and refuse to
  write outside `data/`.
- **One transcript per recording**, `<video>.transcript.json` next to that
  video. No copies inside the composition folder.
- **The a-roll is hardlinked, not copied:** `production/source.mp4` links to
  `data/item-<id>/source.mp4`, so a 116MB source costs 116MB once, not twice.
- **Legacy folders keep resolving** (`data/compositions/item-<id>`,
  `data/vid1-test`) through the same resolver, so an item under human review
  never has to move mid-flight. Migrate one with
  `node scripts/migrate-data.mjs --item <id> [--dry-run]`; `--all` for every
  item; `--verify` reports every DB pointer that no longer exists.

## Cleaning (raw → one clean video)

The cleaner turns one raw recording into one clean video, before production. The
human puts one video, the separate audio recording, and `script.txt` in
`data/item-<id>/`. The script is the spine: the cleaner aligns the spoken words to
the script lines, keeps the **last take of each line**, and cuts everything else.

When the item came from the content engine, `ready()` already created the folder
as `data/item-<id>/` and wrote `script.txt` there from the approved script — the
human records by reading it and drops the video + audio into the same folder.

```bash
npm run clean -- data/item-1            # propose: cut list + read + review file
npm run clean -- data/item-1 --apply    # cut, after the human approves
```

- The engine works; the agent decides. The engine cannot judge meaning, so it
  hands every judgement to the agent in **one file**,
  `data/<folder>/<name>.review.json` (for an item:
  `data/item-1/item-1.review.json`):
  - `lines` — each script line, found or not, the words `heard`, `decision`
    `keep`/`skip`, and `start`/`end` to trim the window.
  - `words` — heard vs the script word, `decision` `fix`/`leave` (default
    `leave`; the engine never edits text on its own).
  - `asides` — stretches between takes, `decision` `keep` (relevant) / `drop`.
  - `cuts` — hand cuts the agent adds (`{ start, end, why }`) for a repeated
    take or a stumble the engine missed.
  Decisions and windows are preserved across re-runs.
- **The agent reads `<name>.read.txt`** — the whole edit, one paragraph per kept
  line — and clears every warning the run prints (`SILENCE` left inside a take,
  `REPEAT` of a phrase in one line) before `--apply`.
- **Repeated takes:** the last try is kept; the first try and everything said up
  to it is removed. Improvised asides between takes are dropped unless the agent
  marks them `keep`.
- **Tags:** a watermark a service baked into the audio (Auphonic's free tag,
  "free audio post production by auphonic.com") is removed when it sits at the
  very start or end. The phrases live in `config/style.json` under `clean.tags`.
- Pauses come from measured audio silence, never from transcript gaps, so a word
  the speech model missed can never be cut.
- It never writes to the video or the audio; it refuses any output path equal to
  an input.
- **Never `--apply` without the human reading `<name>.read.txt` and saying yes.**
- Thresholds live in `config/style.json` under `clean`. Steps are cached next to
  the video; only the cut re-encodes.
- Full procedure: the `clean-recording` skill.

## Production (footage → finished video)

The production engine turns one cleaned recording into a finished video. The
model is **Video → Segments → Beats**: the agent writes a segment plan (footage +
snapshots); the engine derives the word-timed footage, validates the plan,
renders one still per snapshot plus a contact sheet, and STOPS for the human. On
approval it builds one composition, renders it, and lays sound under the voice.

```js
import { connect } from '@content-os/core';
import { ProductionEngine } from '@content-os/engine-production';
const engine = new ProductionEngine(connect());

engine.listFootage();                          // what is waiting in data/
engine.processFootage({ targetId, filePath }); // attach the cleaned file -> shot
engine.menu({ targetId });                     // read the menu FIRST
engine.saveSnapshotPlan({ targetId, plan });   // store the segment plan
await engine.planSnapshots({ targetId });      // derive + validate + render the plan, stop for approval
engine.approveSnapshotPlan({ targetId });      // the human approves (in chat)
engine.preview({ targetId });                  // fast low-res render while iterating
engine.edit({ targetId });                     // build + render the final -> editing
engine.requestReview({ targetId });            // ask the human to watch
engine.schedule({ targetId });                 // after approval -> scheduled
```

- The plan is **mandatory and gated**. `planSnapshots()` derives the narration
  beats, validates the plan, renders the stills + contact sheet, opens
  `snapshot_plan_review`, and stops. `preview()`/`edit()` refuse until the human
  approves it (`approve_snapshot_plan`). No plan → no video.
- The engine never writes content, and it never cuts footage. Cleaning is the
  `clean-recording` skill's job, and it happens before this.
- `edit()` reuses the cleaner's transcript (`<video>.transcript.json`) for
  captions and the word clock instead of listening again, and renders at
  `output.crf` from the style. Final size is predictable.

### Rendering (required) — detached, never block the chat

A render on this machine takes ~8–16 min for a full-length video. The agent MUST
launch it as a detached background process and keep talking to the human while
it runs. Never sit and wait, and never make the human wait in silence.

**The one rule that matters: after launching a render, RETURN IMMEDIATELY.**
Do not run a long `sleep`, do not poll in a loop, do not run any command whose
only job is to wait for the render. Hand control straight back to the chat and
answer the human. A queued human message means the agent is parked inside a
blocking command — that is the bug. The render does not need the agent to watch
it; it needs the agent to be reachable.

1. **Preview while editing, final once locked.** The human iterates with the
   fast preview (`render.preview` in `config/style.json`, 480×270) and only
   locks the full render (`render.final`, 1080p) when the cut is approved.
   Captions never change between them.
2. **Launch detached.** Start the render with a real background process and
   write logs + a PID file, e.g.
   `data/renders/_<job>.out`, `data/renders/_<job>.err`,
   `data/renders/_<job>.pid`. The render keeps running independent of the chat.
   Then stop — say "started at HH:MM, ETA ~N min" and return to the chat.
3. **Poll only when asked.** The human asks "status" (or anything); the agent
   runs ONE read-only check and answers in a line or two: process alive, phase
   (capture / encode / assemble), frames done / total, elapsed, ETA, and the
   output path when finished. Then return. Never chain polls; never wait.
4. **Direct HyperFrames is the proven path.** The direct CLI completes reliably:
   ```
   node --disable-warning=ExperimentalWarning node_modules/hyperframes/bin/hyperframes.mjs \
     render <compositionDir> -o <out.mp4> --crf 18 -w 2 -f 24 -q standard \
     --browser-gpu --no-low-memory-mode
   ```
   Set `HYPERFRAMES_BROWSER_PATH` to Chrome first. `-w 2` is the ceiling on an
   8 GB machine (HyperFrames' own budget is 1536 MB/worker); passing `-w`
   explicitly bypasses HyperFrames' low-memory pin and 1-worker choice.
   Do NOT pass `--experimental-fast-capture`: drawElement self-verification
   fails on these compositions.
5. **Machine must stay awake.** A render dies if the machine sleeps mid-render
   (the human's lid-close sleeps are intentional; coordinate, don't disable
   power settings).

### Style-owned render settings

`config/style.json` → `render` is the ONE place render behavior lives:
`workers`, `quality`, `browserGpu`, `lowMemoryMode`, `protocolTimeoutMs`,
`timeoutMs`, and the two canvases `preview` (640×360) and `final` (1920×1080).
The engine owns these; HyperFrames never decides for us.

### The plan contract — Video → Segments → Beats

The video is an ordered list of SEGMENTS. A segment is either FOOTAGE (you
talking — the face, no visuals) or a SNAPSHOT (a b-roll section on the orange
backdrop, ONE completed composition built by its beats). You author the
snapshots and any footage you want to force; the engine derives the rest of the
footage word-accurately.

```json
{ "video": { "id": "vid", "duration": 86 },
  "segments": [
    { "id": "f1", "kind": "footage", "start": 0.1, "end": 4.5 },
    { "id": "s3", "kind": "snapshot", "concept": "equation", "start": 26.3, "end": 42.5,
      "composition": { "kicker": "The cost",
        "terms":  [ { "value": "$25", "unit": "/hr", "label": "a person" } ],
        "result": { "value": "$2,500", "unit": "/mo", "label": "of human time" } },
      "beats": [
        { "id": "b8",  "start": 26.3, "end": 28.4, "spoken": "Now let's put a cost on those hours.",
          "action": { "op": "introduce", "target": ["head"] } },
        { "id": "b10", "start": 29.2, "end": 36.5, "spoken": "…$25 an hour, that's roughly $2,500",
          "action": { "op": "introduce", "target": ["term-0", "result"], "cue": { "term-0": "$25" } } }
      ] }
  ] }
```

**Footage is derived, never placed by hand.** A snapshot is on screen only while
its content builds and shows (its first body element → its last content word);
every remaining stretch — a lead-in, a gap between snapshots, the hook, the tail
— becomes footage, snapped to the narration words. A gap shorter than
`footage.minGapSeconds` (3s) holds the previous scene (seamless b-roll); a
snapshot shorter than `footage.minSnapshotSeconds` (2s) is held longer. The
emitted plan lists every footage segment with the narration over it.

`validateSnapshotPlan()` refuses: an unknown concept, an empty composition, a
beat with no `spoken`, a slot no beat introduces, a target that is not a slot of
the concept, a beat past its segment window, a narration beat not covered by any
segment, and — given the words — a slot cued on a phrase **not spoken inside its
own beat**. Nothing renders if the plan fails.

The plan may set `output.orientation` (`"portrait"`/`"landscape"`) to override
the master's shape; omit it to follow the footage.

### Beats and cues

A beat names an `action.op` (`introduce`, `reveal`, `move`, `resize`, `restyle`,
`retext`, `replace`, `highlight`, `hold`) and the slot(s) it acts on. A reveal
lands on the exact narration word: a figure is cued automatically on the number
it shows; otherwise set `action.cue` to the word/phrase (a string, or a
`{slot: phrase}` map). A cue must be spoken inside that beat — so nothing appears
on unrelated narration. Figures count up to their exact stated value. Every slot
MUST be introduced by a beat: nothing shows before its narration.

### The menu (read it before writing a plan)

`engine.menu()` returns everything you are allowed to name: the brand doctrine,
the segment model, the snapshot concepts + their slots, the beat actions and
transitions, the cue rule, and the icon vocabulary.

```js
engine.menu({ targetId });
```

Snapshot concepts and their slots (`0..n` = one per array item). A beat's
`action.target` must name these slots:

| Concept | Slots | Use it for |
|---|---|---|
| `title-steps` | head, headline, step-0..n | a short process / "how to" |
| `equation` | head, term-0..n, result, note | a cost / math build |
| `keypoint` | head, text, chip-0..n | one statement + chips |
| `worksheet` | head, headline, header, row-0..n | a fill-in-the-blank form |
| `decision` | head, question, branch-0..n | a yes/no test |
| `bars` | head, headline, bar-0..n | a comparison |
| `quote` | head, struck, text | a reframe |
| `cta` | head, text, handle, sub | the closing ask |

### Diagrams (native layouts)

A snapshot segment can carry a named diagram instead of a concept:

```json
{ "id": "d3", "kind": "snapshot", "start": 12.4, "end": 27.8,
  "diagram": { "name": "flow", "spec": { "title": "How it runs", "steps": ["Capture", "Classify", "Act"], "active": 2 } } }
```

- `engine.menu().plan.diagrams` lists every layout, its fields and its gates. Read it before choosing one.
- **58 layouts.** Process: `flow`, `pipeline`, `cycle`, `swimlane`, `sequence`, `state-machine`, `fork-join`, `approval-chain`, `decision`. Structure: `architecture`, `hierarchy`, `relationship`, `layers`, `erd`, `data-flow`, `deployment`, `mind-map`, `venn`, `pyramid`, `matrix`, `quadrant`, `treemap`. Time: `timeline`, `funnel`, `gantt`, `calendar`, `milestones`, `before-after`, `journey-map`, `flywheel`. Charts: `table`, `line-chart`, `area-chart`, `scatter`, `pie`, `stacked-bars`, `waterfall`, `sankey`, `heatmap`, `gauge`, `ranking`, `bullet`. Narrative: `comparison`, `pros-cons`, `old-vs-new`, `iceberg`, `spectrum`, `balance`, `bullseye`. Interface: `annotated-screenshot`, `wireframe`, `code`, `terminal`, `chat`, `post`, `map`, `lower-third`, `icon-grid`.
- Slots are stable across portrait and landscape (`node-0`, `link-0`, `bar-1`, `cell-0-1`, …). Every slot must be introduced by a beat.
- Leave `beats` empty and the engine synthesises them from the narration in build order; explicit beats always win.
- `npm run gallery` renders the catalog (`data/gallery/`) with neutral copy. Layouts read the locked style; never introduce a colour or font of your own.

### Doctrine (required)

Everything on screen must earn its place, and on-screen content must be
narration-supported: never show a figure, label or term the speaker does not
say. The rule lives in `config/style.json` under `doctrine`. For each narration
beat, decide:

1. **Leave the face?** Only when a snapshot gives more information, clarity or
   narrative value than staying on the face. If it does not materially improve
   the communication, leave it to footage.
2. **Which concept?** cost/math → `equation`; a short process → `title-steps`;
   one statement → `keypoint`; a fill-in form → `worksheet`; a test → `decision`;
   a comparison → `bars`; a reframe → `quote`; the close → `cta`.
3. **Design the completed composition first**, then give every slot a beat that
   reveals it on its word (the cue). Every slot must be introduced by a beat.
4. **Motion?** Only for a hit: figures count up; a `highlight` pulses a payoff.
   Default is still.
5. **Required or optional?** Delete it in your head. If the explanation is still
   complete, it was optional — delete it.

### The locked style

`packages/engine-production/config/style.json` is the ONE style file: colors,
fonts, captions, cards, the motion vocabulary, the footage/snapshot timing
thresholds, grade, the backdrop pointer, and the voice rule. Per-video choices
live in the plan, not here. The backdrop is a designed file,
`packages/engine-production/backdrop/brand.svg`, the base layer of every
snapshot. `brand.colors.bg` is the fallback color.

### Icons

Snapshots can carry icons from Tabler (MIT). Geometry is inlined at build time
into `src/diagrams/icons.generated.mjs` by `tools/build-icons.mjs`; runtime reads
a plain object, no dependency. `src/diagrams/icons.custom.mjs` is the empty
fallback for a concept Tabler does not cover. Rebuild with
`npm --workspace @content-os/engine-production run icons`.

### Voice (required)

The engine's messages to the human are plain and short. No technical words.
"Made it. Want to watch?" — not "composition assembled, beat map validated."
The rule lives in `config/style.json` under `voice`.

## Distribution (approved video → scheduled → published)

The distribution engine schedules and publishes. It never writes copy and never
approves a human gate. Full setup and recovery: `docs/DISTRIBUTION.md`.

Preconditions:

1. The item is `scheduled` (Production `schedule()` after an approved
   `asset_review` gate).
2. The post's asset is `approved`. Publishing re-checks this and refuses
   anything else.
3. `settings.distribution.accounts` names every account. Names must match the
   `.env` names.
4. The agent has written per-platform copy. `adapt()` validates it; it never
   generates it.

Flow:

```js
engine.adapt({ targetId, copy });   // one post per eligible account
engine.schedule({ targetId });      // UTC slots + calendar rows
await engine.publish({ targetId }); // due posts, through real publishers
```

Worker (one pass, systemd timer every 5 minutes):

```bash
node --disable-warning=ExperimentalWarning scripts/distribution-worker.mjs --schedule --publish --cleanup --json
```

- The worker takes an exclusive PID lock. A second run exits without working.
  Lock acquisition is bounded and a live lock older than two hours is replaced.
- Each post is claimed atomically with a lease (schema v7). A manual publish and
  the worker cannot publish the same post concurrently. The lease is renewed
  before every attempt, released on success/failure, and reclaimed after a
  crash once it expires.
- `--dry-run` is side-effect-free: no claims, posts, calendar rows,
  `engine_logs`, media cleanup, or migration. It refuses a database below v7.
- It logs a `worker` row to `engine_logs` on non-dry passes.
- It never generates copy. Adaptation requires `--adapt --copy-file <json>`.
- Instagram uses Graph API v26.0 and enforces 300 MB, 3 seconds to 15 minutes,
  and 23-60 fps. It polls the container once per minute for up to five minutes.
  Partial successes such as `config_issue` stay published and are logged.
- Instagram uses the nginx media host. TikTok uses `FILE_UPLOAD`.
- Instagram Creator and both TikTok accounts are independent. TikTok public
  Direct Post requires the Content Posting API audit.
- Credentials live in `/opt/docker/apps/content-os/.env`, mode 600.
  `scripts/instagram-auth.mjs` and `scripts/tiktok-auth.mjs --slot N --account NAME`
  write them. Never ask for tokens in chat.
- `publish_state` is written before every irreversible step. `adapt()` refuses
  to erase it while a publish is in progress or unresolved. Check the platform
  before using `scripts/distribution-worker.mjs --reset-post <id> --confirm`.
- Tests: `node --disable-warning=ExperimentalWarning --test packages/engine-distribution/test/*.test.js`.

## Captions

Captions are part of production, not scripting. They are generated from the
transcript after the script is finalized.

### Engine rules (mandatory)

The caption engine at `packages/engine-production/tools/lib/captions.mjs`
enforces structural rules. All captions must pass `validateCaptions()`.

- **Max 5 words per caption.** Hard limit. If a phrase exceeds 5 words, split
  it into two captions at a natural break point.
- **Max 30 characters per caption.** Includes spaces and punctuation.
- **Min 0.6s duration.** If the spoken words are shorter, add hold time.
- **No dangling function words.** A caption cannot end with a preposition,
  conjunction, or determiner (the FUNC_TAIL set: of, the, a, an, in, on, at,
  to, for, with, and, but, or, so, yet, both, either, neither, nor, not,
  only, also, just, even, still, already, yet, ever, never, always, often,
  sometimes, rather, quite, almost, just, only).
- **No two clauses in one caption.** If a caption contains a conjunction
  splitting two complete thoughts, split it.
- **One emphasis per caption max.** Never highlight two words in the same
  caption frame.

### Generating captions

Use `groupCaptions()` from the engine — do not write captions by hand.

```js
import { groupCaptions, validateCaptions } from '@content-os/engine-production/tools/lib/captions.mjs';

const words = JSON.parse(fs.readFileSync('transcript.json', 'utf8'));
const captions = groupCaptions(words);
const valid = validateCaptions(captions); // throws if any rule fails
```

### Emphasis selection

The engine groups words but does not pick emphasis. The agent selects
emphasis words based on content meaning. Rules:

- **One emphasis word or phrase per caption.** Never two.
- **Emphasis candidates:** key terms, numbers, names, action verbs, branded
  terms. Examples: "automated", "30 seconds", "level 3", "CRM", "process".
- **Alternating colors:** blue `#0f4c81` and orange `#EA580C`, alternating
  per caption.
- **Never emphasize filler words:** "here's", "there are", "and most",
  "but then", "for example".
- **Every caption does NOT need emphasis.** Plain captions are normal. Only
  emphasize when a word genuinely stands out in that phrase.

### Caption band

Captions sit at `top: 72%` of the frame (bottom 28%). The value comes from
`config/style.json` under `captions.band`. Visual content must stay in the top
65%. See the `visual-layer` skill for the full composition doctrine.

## Settings that drive behavior

`brand`, `pillars`, `pillar_details`, `target_audience`, `platforms`,
`hooks_preferred`, `content_weights`, `script_framework`, `idea_framework`.
Re-seed with `npm run seed` after editing `scripts/seed-*.mjs`.

## Commands

```
npm test                                  # full suite — must stay green
npm run seed                              # brand + script + idea frameworks
npm run clean -- data/item-1              # clean a recording (propose; --apply to cut)
node --disable-warning=ExperimentalWarning scripts/distribution-worker.mjs --schedule --publish --cleanup --json   # distribution pass
npm --workspace @content-os/engine-production run icons     # rebuild diagrams/icons.generated.mjs (Tabler, MIT)
node --disable-warning=ExperimentalWarning scripts/serve-script.mjs <id>   # render script
node --disable-warning=ExperimentalWarning scripts/reset-content.mjs       # purge placeholder content
node --disable-warning=ExperimentalWarning scripts/cleanup-db.mjs          # wipe all items/gates/history
node --disable-warning=ExperimentalWarning scripts/migrate-data.mjs --item <id> [--dry-run]   # fold an item's files into data/item-<id>/
node --disable-warning=ExperimentalWarning scripts/migrate-data.mjs --verify                 # report DB pointers that no longer exist
```

## Environment notes (Windows)

- Inline `node -e "..."` breaks on PowerShell quote escaping — write a temp
  `.mjs` file inside the workspace instead (temp dirs can't resolve
  `@content-os/core`), run it, delete it.
- Always pass `--disable-warning=ExperimentalWarning`.

## Hard rules

1. No placeholder content ever enters the database. Not even scaffolding.
2. Gates are human decisions. The agent records them only when told to.
3. Ideas are generated fresh each cycle — no static idea bank, no recycling.
4. Don't edit generated files (`data/`) by hand except through documented paths.
5. `docs/FOUNDATION.md` is a historical record — don't update it.
6. **Visual layers over captions follow the `visual-layer` skill.** Any composition that layers a diagram/chart/graphic on a branded canvas and carries captions must obey it: visuals sit directly on the canvas (no white box), fill the frame (override baked-in `max-width`), scale preserving aspect ratio, never reach the caption band (`top: 72%` is a hard keep-out zone), stay within render timeout weight, and be pre-rendered static SVG (no async diagram rendering).
7. **The cleaner never modifies its inputs.** It reads the video and the audio and refuses any output path equal to an input. Never run `--apply` without showing the cut list and getting the human's yes.
8. **Never publish an unapproved asset.** Distribution `publish()` re-checks the asset status and refuses anything that is not `approved`.
9. **Never clear `publish_state` for an in-progress or ambiguous post.** Check the platform first; only then use `scripts/distribution-worker.mjs --reset-post <id> --confirm`. `adapt()` refuses to change copy while that state exists.
10. **Never invent platform copy or credentials.** The agent writes copy and passes it to `adapt()`; the setup scripts write credentials to `/opt/docker/apps/content-os/.env` (mode 600).
11. **The distribution worker never approves gates.** Human approval remains required for `asset_review`.

## Out of scope for v1 (by design)

`content_links` (series/remix), calendar planning, analytics integration.
