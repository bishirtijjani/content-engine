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
**finished, on-brand video** (long form + vertical shorts). Publishing lives
downstream.

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

## Cleaning (raw → one clean video)

The cleaner turns one raw recording into one clean video, before production. The
human puts one video and the separate audio recording in `data/<name>/`; the
cleaner syncs them, then cuts the pauses, the self-talk, and the repeated takes.

```bash
npm run clean -- data/vid1            # propose: print the cut list, cut nothing
npm run clean -- data/vid1 --apply    # cut, after the human approves
```

- The cleaner adds no captions and no overlays — it only syncs and cuts.
  Production does the rest.
- **Repeated takes:** when a line is said more than once, the **last** try is
  kept; the first try and everything said up to it (including any aside in
  between) is removed. Self-talk ("start again", "I'm supposed to", counting
  "three two one") is removed on its own. This is what makes a line-by-line
  read with restarts usable. No script is needed — decisions come from the
  transcript alone, so improvised lines are always kept.
- **Tags:** a watermark a service baked into the audio (Auphonic's free tag,
  "free audio post production by auphonic.com") is removed when it sits at the
  very start or end. The phrases live in `config/style.json` under `clean.tags`.
- Pauses come from measured audio silence, never from transcript gaps, so a word
  the speech model missed can never be cut.
- It never writes to the video or the audio; it refuses any output path equal to
  an input.
- Always show the cut list and wait for the human's yes before `--apply`.
- Thresholds live in `config/style.json` under `clean`. Steps are cached next to
  the video; only the cut re-encodes.
- Full procedure: the `clean-recording` skill.

## Production (footage → finished video)

The production engine turns one cleaned recording into a finished video. The
human drops the cleaned file in `data/` and points at it; the agent writes a
plan; the engine checks the plan against the locked style, builds one
composition, renders it, lays sound effects under the voice, and asks the
human to review.

```js
import { connect } from '@content-os/core';
import { ProductionEngine } from '@content-os/engine-production';
const engine = new ProductionEngine(connect());

engine.listFootage();                          // what is waiting in data/
engine.processFootage({ targetId, filePath }); // attach the cleaned file -> shot
engine.edit({ targetId });                     // build + render from the plan -> editing
engine.makeShort({ targetId, start, end });    // package a range as a 9:16 short
engine.requestReview({ targetId });            // ask the human to watch
engine.schedule({ targetId });                 // after approval -> scheduled
```

- `edit()` requires footage and an agent-written plan. No plan, or an off-style
  plan, means it skips and logs why. The engine never writes content.
- The engine never cuts footage. It only adds layers on top. Cleaning is the
  `clean-recording` skill's job, and it happens before this.
- `edit()` reuses the cleaner's transcript (`<video>.transcript.json`) for
  captions instead of listening again, and renders at `output.crf` from the
  style. Final size is predictable.
- `make_short()` only packages a start/end the human and agent agreed on. The
  agent suggests candidates; it does not decide.

### Plan contract

`content_items.video_plan` is structured JSON. Every field is optional; an
empty plan is a plain captioned video. Two overlay kinds: `visual` (a file you
supply) and `graphic` (a template we draw). Every overlay carries a `why`.

```json
{ "captions": { "emphasis": ["automated", "30 seconds"] },
  "overlays": [
    { "start": 12, "end": 18, "kind": "graphic", "name": "stat-callout",
      "why": "show the hours saved",
      "fields": { "value": "8 hrs", "label": "saved per week" } },
    { "start": 30, "end": 36, "kind": "visual", "frame": "full",
      "file": "data/myvideo.visuals/dashboard.png",
      "why": "show the real dashboard" } ],
  "zooms": [ { "at": 12, "scale": 1.15 } ],
  "sfx":   [ { "at": 12, "sound": "whoosh" } ] }
```

`validatePlan()` refuses: wrong length, overlapping overlays, a visual or
graphic not in the library, a field the graphic does not take, an unknown
frame, an overlay with no purpose (or a filler purpose), too many zooms, a bad
zoom scale. Nothing renders if the plan fails.

### Frames and modes (the model never sets a size or a position)

Every overlay snaps into one of four frames. A graphic gets its frame from the
template; a visual picks one.

| Frame | Mode | What goes there |
|---|---|---|
| `full` | take over | screenshots, screen recordings, diagrams, charts |
| `center` | take over | big stat, quote, CTA, title, prompt |
| `left` | split | a supporting visual or note; face on the right |
| `right` | split | a supporting visual or button; face on the left |

**Take over** hides the video and fills the frame on the orange. **Split**
insets the video to the far side and puts the element in its frame. The rule:
if they need to look at it, it takes the screen (`full` or `center`); if it
only supports what is being said, it shares the screen (`left` or `right`).

### The menu and the builder

Before writing a plan, the model reads the menu:

```js
engine.menu({ targetId }); // frames, templates (name, fields, frame), this video's visuals, sound cues
```

Then it writes the plan with small functions, never raw JSON:

```js
const plan = engine.newPlan()
  .caption({ emphasis: ['automated'] })
  .graphic({ at: [12, 18], name: 'stat-callout', fields: { value: '8 hrs', label: 'saved' }, why: 'show the hours saved' })
  .visual({ at: [30, 36], frame: 'full', file: 'data/myvideo.visuals/dashboard.png', why: 'show the real dashboard' })
  .zoom({ at: 12, scale: 1.15 })
  .sfx({ at: 12, sound: 'whoosh' });

engine.savePlan({ targetId, plan }); // validates against the menu, then stores
```

### Doctrine (required)

Everything on screen must earn its place. If you cannot say why it is there in
one plain sentence, it does not go on screen. On-screen content is only:
screenshots, screen recordings, your own video, graphics, diagrams. No stock
footage. All of it sits on the burnt orange canvas; the orange shows around the
edges. Visuals never enter the caption band. The rule lives in
`config/style.json` under `doctrine`.

### The locked style

`packages/engine-production/config/style.json` is the ONE style file. How a
video looks and sounds lives there: colors, fonts, captions, cards, frames,
motion, sfx, grade, the backdrop pointer, and the voice rule. Per-video choices
live in the plan, not here.

The backdrop is a designed file: `packages/engine-production/backdrop/brand.svg`
(a grid with depth). It is the base layer of every composition. The talking
head is full-screen and covers it; the backdrop shows during take-over (the
video is hidden) and split (the video is inset). Edit the one SVG to change the
look; every future video follows. `brand.colors.bg` is the fallback color.

### The library

- **Visuals are per video.** They are not stockpiled. For a video `data/myvideo.mp4`,
  `process_footage` makes the folder `data/myvideo.visuals/` next to it. Drop that
  video's screenshots, screen recordings, and clips there, and point the plan's
  `file` at them. A reusable id from the shared library (`asset`) also works.
- `templates/` — on-brand graphics, drawn once and reused. The agent picks a
  name and fills the fields; it never rewrites the graphic.
  - cards: `stat-callout`, `key-point`, `text-box`, `quote-card`, `title-card`, `cta-card`
  - lists: `step-list`, `checklist`, `timeline`
  - prompts: `comment-prompt`, `link-prompt`, `callout`
  - buttons: `subscribe-button`, `follow-button`
  - diagrams: `flow`, `before-after`, `comparison`
  - people: `lower-third`
- `assets/sfx/` — short sounds. These ARE reusable. Drop `.wav` files there and
  run `npm --workspace @content-os/engine-production run catalog` once; the plan
  refers to them by cue name (`whoosh`, `click`, ...) or id.

### Voice (required)

The engine's messages to the human are plain and short. No technical words.
"Made it. Want to watch?" — not "composition assembled, beat map validated."
The rule lives in `config/style.json` under `voice`.

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

### Validation script

`scripts/gen-captions-manual.mjs` generates captions from a transcript with
hardcoded timing and emphasis. It validates word count and character count
per caption and prints warnings for any that exceed limits.

## Settings that drive behavior

`brand`, `pillars`, `pillar_details`, `target_audience`, `platforms`,
`hooks_preferred`, `content_weights`, `script_framework`, `idea_framework`.
Re-seed with `npm run seed` after editing `scripts/seed-*.mjs`.

## Commands

```
npm test                                  # 167 tests — must stay green
npm run seed                              # brand + script + idea frameworks
npm run clean -- data/vid1                # clean a recording (propose; --apply to cut)
npm --workspace @content-os/engine-production run catalog   # rebuild assets/catalog.json
node --disable-warning=ExperimentalWarning scripts/serve-script.mjs <id>   # render script
node --disable-warning=ExperimentalWarning scripts/reset-content.mjs       # purge placeholder content
node --disable-warning=ExperimentalWarning scripts/cleanup-db.mjs          # wipe all items/gates/history
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

## Out of scope for v1 (by design)

`content_links` (series/remix), calendar planning, analytics integration.
