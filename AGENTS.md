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
scripts → **ready to shoot**. Filming/editing/publishing live downstream.

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

Captions sit at `top: 72%` of the frame (bottom 28%). Visual content must
stay in the top 65%. See the `visual-layer` skill for the full composition
doctrine.

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
npm test                                  # 55 tests — must stay green
npm run seed                              # brand + script + idea frameworks
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

## Out of scope for v1 (by design)

`content_links` (series/remix), calendar planning, analytics integration.
