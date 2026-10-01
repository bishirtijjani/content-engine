# content-os

**Full content automation engine.** You only manually shoot the footage — everything else happens automatically.

Five independent engines (content, production, distribution, engagement, analytics) working on one shared Content Database — the central nervous system — with four human decision gates and a closed analytics-to-creation feedback loop. The AI agent is the orchestrator: it reads the DB, makes decisions, and calls the engine as a library.

See [architecture.md](architecture.md) for the full software design and [docs/FOUNDATION.md](docs/FOUNDATION.md) for the foundation report.

---

## How it works

```
                    CONTENT DATABASE
                           ↕
      ┌────────────────────┼────────────────────┐
      ↓                    ↓                    ↓
CONTENT ENGINE      PRODUCTION ENGINE    DISTRIBUTION ENGINE
      ↑                                         ↓
      │                                  ENGAGEMENT ENGINE
      │                                         ↓
      └────────────── ANALYTICS ←───────────────┘
```

| Engine | Question | Pipeline | Output |
|---|---|---|---|
| **Content** | "What should we create?" | Discover → Evaluate → Plan → Research → Script | Ready-to-shoot scripts (agent-written) |
| **Production** | "How do we turn footage into finished content?" | Attach footage → Agent plan → Assemble → Render → Mix sound → Review | Finished cuts (long + vertical shorts) |
| **Distribution** | "Where, when, and how?" | Adapt → Schedule → Publish → Cross-post | Published posts |
| **Engagement** | "What happens after people interact?" | Monitor → Classify → Reply / Escalate / Save idea | Resolved engagement + leads + new ideas |
| **Analytics** | "What actually happened?" | Collect → Analyze → Insights → Playbook rules | Knowledge fed back into Content |

The loop closes: analytics produces playbook rules that the Content Engine queries when scoring and planning future content. What worked gets doubled down on. What didn't gets avoided.

---

## The state machine

Every piece of content is one record in `content_items` that moves through 13 states. The engines are workers that pick up items in the states they own and move them forward. The state machine is enforced in code — illegal jumps are rejected.

```
idea → evaluated → planned → researched → scripted → ready_to_shoot
     → shot → editing → scheduled → published → measured → archived

failed is a side state (render crash, publish error); retry back into the pipeline.
```

### Human gates

Automation stops at four non-negotiable checkpoints. Engines request gates; humans decide; the state machine refuses to move past an unapproved gate.

| Gate | Transition | Question it answers |
|---|---|---|
| `idea_approval` | evaluated → planned | "I'll spend my face-time on this" |
| `script_review` | scripted → ready_to_shoot | "This script is worth recording" |
| `asset_review` | editing → scheduled | "The finished video is good enough to ship" |
| `escalation` | engagement (money/reputation) | "A human must handle this" |

### Fast-track

Breaking news or urgent topics: an item may jump forward across content stages (e.g. idea → scripted). Rules:

- **Content stages only** — you cannot fast-track past shooting or editing
- **Mandatory reason** — recorded in the audit trail
- **Gates are never bypassed** — every gated edge on the crossed path must have an approved gate
- **Skipped states are recorded** — the audit trail stays complete

---

## The batch production model

The session is the batch unit for production; the item is the unit for content decisions; the asset is the unit for platform output; the post is the unit for distribution.

```
20 items in ready_to_shoot (scripts approved)
  → session create (1 row) + session add-item (20 rows)
  → shoot day → recording add (N rows: recordings + content_item_recordings)
  → session upload → Production Engine processes the SESSION as a batch
  → per item: assets (platform cuts) → asset_review gate → scheduled
  → per item: posts (one per platform) → published
```

---

## The Content Engine (fully implemented)

The Content Engine answers "What should we create?" — the first and most critical question.

### Pipeline

| Stage | Input | What it does | Output |
|---|---|---|---|
| **Discover** | Agent brainstorm + audience comments | The agent generates **fresh ideas each cycle** from brand knowledge, trends, and gaps; `addIdeas()` registers them; `discover()` picks up audience ideas | New items in `idea` status |
| **Evaluate** | Candidate ideas + settings + playbook rules | Scores each idea on 7 weighted dimensions, persists score + reason | Scored items in `evaluated` + idea gate requested |
| **Plan** | Approved ideas + playbook rules | Fills content strategy fields (pillar, format, hook, CTA, length) | Items in `planned` |
| **Research** | Content strategy | Agent writes a research brief with facts, sources, claims; engine validates substance and finalizes | Items in `researched` |
| **Script** | Research brief + hook style | Agent writes the finished shooting script as structured JSON; engine validates structure + length and finalizes | Items in `scripted` + script gate requested |
| **Ready** | Approved scripts | Moves gate-approved scripts into the shoot-ready queue | Items in `ready_to_shoot` |

> **Content contract:** the engine never writes content. `research()` and `script()` only *finalize* agent-written content — they move items forward and request gates. The agent (the brain) writes `research_notes`, `script`, and `shot_instructions` directly. Items without agent-written content — or with structurally invalid content (placeholders, wrong narration length, plain-text scripts) — are skipped and logged.
>
> **Writing guides:** agents read `settings.script_framework` before writing scripts (hook rules per style, structure beats, length math, platform fit, 10-point checklist) and `settings.idea_framework` before generating ideas (face-time bar, duplicate checks, cycle procedure). Seed/update with `npm run seed`.

### Scoring dimensions (0–100)

Each idea is scored on 7 weighted dimensions. Weights are configurable via `settings.content_weights`.

| Dimension | Default weight | What it measures |
|---|---|---|
| Pillar relevance | 25 | Does this match a content pillar? |
| Audience interest | 20 | Will the target audience care? |
| Trend potential | 15 | Is this trending or timely? |
| Authority fit | 15 | Does this establish authority? |
| Engagement potential | 10 | Will people comment/share? |
| Business value | 10 | Does this drive business outcomes? |
| Novelty | 5 | Is this fresh or overdone? |

Source scores also influence evaluation: questions from the audience (90) score highest, followed by past successes (85), trends (80), comments (70), and so on.

### Playbook rules

Analytics insights that have been accepted become playbook rules. The Content Engine queries these when scoring and planning:

- "Use question hooks for pricing topics on TikTok short-form" → boosts score for matching ideas
- "Problem-statement hooks have 2.3x retention" → influences hook_style selection in planning
- Rules are retired when contradicted by newer evidence

---

## The data model (17 tables)

```
recording_sessions 1───N recordings 1───N content_item_recordings N───1 content_items
       │                                                              │
       └──────────────────────────────────────────────────────────────┘

content_items 1───N assets 1───N posts
      │  │
      │  └──N content_links N── other content_items
      │
      └──N engagement_items
      │
      └──N insights ──1──N playbook_rules

calendar_entries ── references content_items / posts / sessions
```

| Table | Role |
|---|---|
| `content_items` | One row per piece of content — the state machine record |
| `content_item_history` | Immutable audit trail of every transition (including fast-track skips) |
| `recording_sessions` | The shoot event — batch unit for production |
| `recordings` | Raw footage files inside a session |
| `content_item_recordings` | Which recordings feed which items (many-to-many with role) |
| `content_links` | Typed relationships between items (follow_up, reuse_research, reuse_asset, series_part, remix, split_from, inspired_by) |
| `assets` | Finished cuts — one row per platform per item |
| `posts` | Distribution records — one per platform publication |
| `calendar_entries` | Planning layer: shoot sessions, publish slots, review slots |
| `engagement_items` | Comments, DMs, mentions (linked to the content item they spawned) |
| `conversations` | Mini-CRM for leads |
| `metrics` | Analytics per post per collection time |
| `insights` | Findings with evidence count + validation status |
| `playbook_rules` | Accepted, actionable knowledge the Content Engine queries |
| `gates` | Human decision records |
| `engine_logs` | Execution trail for every engine run |
| `settings` | Brand / authority / cadence profile |

---

## The agent interface

No CLI. No API server. The agent (OpenWork, Claude Code, etc.) IS the orchestrator. The engine is the muscle; the agent is the brain; the script renderer is the output.

```js
import { connect, decideGate, listGates } from '@content-os/core';
import { ContentEngine } from '@content-os/engine-content';
import { generateMarkdown, serveScript } from './src/render-script.js';

const db = connect();
const engine = new ContentEngine(db);

// THE AGENT IS THE BRAIN — it generates fresh ideas each cycle
engine.addIdeas([
  { title: 'Why your CRM is a spreadsheet with extra steps', source: 'experience', pillar: 'customer-acquisition' },
  // ... more fresh ideas from brand knowledge, trends, audience gaps
]);

// Run the deterministic stages (discover → evaluate → plan)
const result = engine.pipeline();
console.log(result);

// Check what needs a human decision
const pending = listGates(db, 'pending');
console.log('Pending gates:', pending);

// Approve an idea gate
decideGate(db, 1, 'approved', { decidedBy: 'bishir' });
engine.plan();

// THE AGENT IS THE BRAIN — it writes the content, the engine finalizes it
db.prepare(
  "UPDATE content_items SET research_notes = 'Facts: ... Sources: ... Claims to verify: ...' WHERE id = 1"
).run();
engine.research();  // finalizes: planned -> researched

const script = JSON.stringify({
  hook: 'My client was spending 8 hours a week on invoices.',
  script: '...spoken words only, 120-180 for a 60s item...',
  points: [{ title: 'The problem', detail: '...' }],
  cta: 'Follow for the full build.',
  shot_notes: 'Screen recording of the automation running.',
});
db.prepare(
  "UPDATE content_items SET script = ?, shot_instructions = 'talking head + screen share' WHERE id = 1"
).run(script);
engine.script();    // validates structure + length, finalizes + requests script gate

// Render the agent-written script in the browser
const item = db.prepare("SELECT * FROM content_items WHERE id = 1").get();
const md = generateMarkdown(item.script, item);
await serveScript(md, item.id, db);
```

### Individual actions

```js
engine.addIdeas([...]);                               // register fresh agent-generated ideas (dedupes by title)
engine.discover();                                    // pull audience ideas from engagement items
engine.evaluate();                                    // score all idea items (persists score + reason)
engine.plan();                                        // fill plan fields for approved items
engine.research();                                    // finalize agent-written research notes
engine.script();                                      // finalize agent-written scripts (validated)
engine.ready();                                       // move gate-approved scripts to ready_to_shoot
engine.resubmit({ targetId: 3 });                     // re-request review after a rejected script
engine.run({ action: 'evaluate', targetId: 3 });      // run one action on a specific item
engine.run({ dryRun: true });                         // preview without changes
```

---

## The Cleaning step (implemented)

Before production, one raw recording becomes one clean video. Put one video and the separate audio recording in `data/<name>/`; the cleaner syncs them (sample-accurate, drift-corrected) and cuts the pauses and wrong takes.

```bash
npm run clean -- data/vid1            # propose: print the cut list, cut nothing
npm run clean -- data/vid1 --apply    # cut, after the human approves
```

- It adds no captions and no overlays — it only syncs and cuts. Production does the rest.
- **Repeated takes** keep the last try and remove the first try plus everything said up to it; self-talk ("start again", "I'm supposed to", counting "three two one") goes on its own. No script is needed, so improvised lines are kept.
- **Tags** — a watermark a service baked in (Auphonic's free "free audio post production by auphonic.com") is removed at the very start or end.
- **Pauses come from measured audio silence, never from transcript gaps**, so a word the speech model missed can never be cut.
- **It never writes to its inputs** — the video and the audio are read-only, and it refuses any output equal to an input.
- Always show the cut list and get the human's yes before `--apply`.
- Thresholds live in `config/style.json` under `clean`. Steps are cached next to the video; only the cut re-encodes.
- Output: `data/<name>/<name>.cleaned.mp4` (+ `cleaned.transcript.json`, reused by `edit()` for captions).

---

## The Production Engine (implemented)

The Production Engine answers "How do we turn a recording into a finished video?" It is the single home for production.

```js
import { connect } from '@content-os/core';
import { ProductionEngine } from '@content-os/engine-production';
const engine = new ProductionEngine(connect());

engine.listFootage();                          // video files waiting in data/
engine.processFootage({ targetId, filePath }); // attach the cleaned file -> shot
engine.edit({ targetId });                     // build + render the agent's plan -> editing
engine.makeShort({ targetId, start, end });    // package a range as a 9:16 short
engine.requestReview({ targetId });            // asset_review gate
engine.schedule({ targetId });                 // after approval -> scheduled
```

- The engine never writes content. The agent writes a **plan** (`content_items.video_plan`); the engine checks it against the locked style, builds one composition (untouched footage + captions + overlays + zooms), renders it, and lays sound effects under the voice.
- The engine never cuts footage. It only adds layers on top.
- **Doctrine:** everything on screen must earn its place — every overlay carries a one-line `why`. On-screen content is only screenshots, screen recordings, your own video, graphics, and diagrams. No stock footage. All of it sits on the burnt orange canvas; visuals never enter the caption band.
- `config/style.json` is the ONE style file. Per-video choices live in the plan.
- The backdrop is a designed file, `backdrop/brand.svg` (a grid with depth), and the base layer of every composition. The talking head is full-screen and covers it; the backdrop shows during take-over (video hidden) and split (video inset). Edit the one SVG to change the look.
- **Visuals are per video.** They are not stockpiled. When footage is attached, the engine makes a `<video>.visuals/` folder next to it; drop that video's screenshots, screen recordings, and clips there and point the plan's `file` at them. `templates/` holds the drawn graphics; `assets/sfx/` holds reusable sounds (rebuild with `npm --workspace @content-os/engine-production run catalog`).

### Plan contract

`content_items.video_plan` is structured JSON (all fields optional — an empty plan is a plain captioned video). Three overlay kinds: `visual` (a file for that video), `graphic` (a drawn template), and `diagram` (a composed SVG layout); each carries a `why`.

```json
{ "captions": { "emphasis": ["automated", "30 seconds"] },
  "overlays": [
    { "start": 12, "end": 18, "kind": "graphic", "name": "stat-callout",
      "why": "show the hours saved",
      "fields": { "value": "8 hrs", "label": "saved per week" } },
    { "start": 30, "end": 36, "kind": "visual", "file": "data/myvideo.visuals/dashboard.png",
      "why": "show the real dashboard" } ],
  "zooms": [ { "at": 12, "scale": 1.15 } ],
  "sfx":   [ { "at": 12, "sound": "whoosh" } ] }
```

A **video** `visual` may select a region of its source with `sourceIn`/`sourceOut` (seconds into the clip), independent of where the overlay lands in the video (`start`/`end`). At 1x playback the source length must equal the on-screen length; omitted, it plays from source 0 for the display duration. Images take no source fields.

`validatePlan()` refuses anything off-style (wrong length, overlapping overlays, unknown graphic, unknown field, unknown frame, missing or filler purpose, too many zooms, bad scale, a source length that does not match the on-screen length). The engine also refuses a visual whose file is not on disk, source fields on an image, or a source range past the end of the clip. Nothing renders if the plan fails.

### Frames and modes

Every overlay snaps into one of four frames; the model never sets a size or position. A graphic gets its frame from the template, a visual picks one.

| Frame | Mode | What goes there |
|---|---|---|
| `full` | take over | screenshots, screen recordings, diagrams, charts |
| `center` | take over | big stat, quote, CTA, title, prompt |
| `left` | split | a supporting visual or note; face on the right |
| `right` | split | a supporting visual or button; face on the left |

Take over hides the video and fills the frame on the orange; split insets the video to the far side.

### Menu and builder

```js
engine.menu({ targetId });   // frames, templates (name/fields/frame), this video's visuals, sound cues

const plan = engine.newPlan()
  .caption({ emphasis: ['automated'] })
  .graphic({ at: [12, 18], name: 'stat-callout', fields: { value: '8 hrs', label: 'saved' }, why: 'show the hours saved' })
  .visual({ at: [30, 36], frame: 'full', file: 'data/myvideo.visuals/dashboard.png', why: 'show the real dashboard' })
  .zoom({ at: 12, scale: 1.15 })
  .sfx({ at: 12, sound: 'whoosh' });
engine.savePlan({ targetId, plan });   // validates against the menu, then stores
```

14 templates ship: cards (`stat-callout`, `key-point`, `text-box`, `quote-card`, `title-card`, `cta-card`), lists (`step-list`, `checklist`), prompts (`comment-prompt`, `link-prompt`, `callout`), buttons (`subscribe-button`, `follow-button`), people (`lower-third`). Diagrams are a separate, composed SVG system (`src/diagrams/`) with 12 layouts (`flow`, `pipeline`, `cycle`, `timeline`, `before-after`, `comparison`, `decision`, `hierarchy`, `architecture`, `relationship`, `layers`, `funnel`); the builder is `.diagram({ at, name, spec, why })`. Diagram icons come from **Tabler** (MIT) — geometry is inlined at build time into `src/diagrams/icons.generated.mjs` (`npm --workspace @content-os/engine-production run icons`), read at runtime with no dependency.

---

## Script renderer

The script renderer takes a shooting script and produces a presentable Markdown document, served in a local browser with a live editor.

```js
import { generateMarkdown, serveScript } from './src/render-script.js';

const item = db.prepare("SELECT * FROM content_items WHERE id = 1").get();
const md = generateMarkdown(item.script, item);
await serveScript(md, item.id, db);  // opens http://127.0.0.1:<port>
```

Features:
- Dark theme, responsive layout
- `marked.js` for Markdown rendering
- Live editor (toggle with Ctrl+E)
- Save back to DB (Ctrl+S or click Save)
- Auto-generates title page from item metadata

---

## Quickstart

### Requirements

- Node.js >= 22.5 (uses built-in `node:sqlite` — **zero npm dependencies**)

### Setup

```bash
npm install              # links workspace packages (no external deps)
npm test                 # run all tests (167 passing)
```

### Seed your brand

```bash
npm run seed             # brand profile + script framework + idea framework (no ideas — those are generated fresh each cycle)
```

### Run the pipeline

```bash
node demo.mjs              # runs the full Content Engine pipeline, renders a script in the browser
```

### Clean a recording

```bash
npm run clean -- data/vid1            # propose: print the cut list, cut nothing
npm run clean -- data/vid1 --apply    # cut, after the human approves
```

### Smoke test

```bash
node scripts/smoke-pipeline.mjs    # end-to-end pipeline test on the real DB
```

---

## Project layout

```
content-os/
├── package.json                  workspace root (scripts: test)
├── architecture.md               full system design
├── README.md                     this file
├── demo.mjs                      live demo (agent calls engine, renders script)
├── src/
│   ├── render-script.js          script renderer (Markdown + browser viewer)
│   └── template.html             HTML template for live script editing
├── data/                         the shared content.db (generated, never committed)
├── scripts/
│   ├── seed-brand.mjs            seed brand settings (ideas are generated fresh by the agent)
│   ├── seed-script-framework.mjs seed the script-writing guide (settings.script_framework)
│   ├── seed-idea-framework.mjs   seed the idea-generation guide (settings.idea_framework)
│   ├── smoke-pipeline.mjs        end-to-end smoke test
│   ├── reset-content.mjs         purge placeholder content, reset items to agent-ready state
│   └── serve-script.mjs          render an item's script in the browser (node scripts/serve-script.mjs <id> [--port 3848])
└── packages/
    ├── core/                     THE CONTRACT — schema, state machine, gates, db layer
    │   ├── src/
    │   │   ├── schema.sql        17 tables, foreign keys
    │   │   ├── indexes.sql       performance indexes
    │   │   ├── db.js             connection, schema init, JSON helpers
    │   │   ├── state.js          enforced state machine (transitions, fast-track)
    │   │   ├── gates.js          human gates (request/decide/list)
    │   │   ├── models.js         row mappers (JSON columns decoded)
    │   │   └── engines/base.js   BaseEngine: logging + queue survey
    │   └── test/state.test.js    12 tests
    ├── engine-content/           Content Engine (fully implemented)
    │   ├── src/index.js          addIdeas, discover, evaluate, plan, research, script, ready, resubmit
    │   └── test/
    │       ├── content.test.js   38 engine tests
    │       └── lifecycle.test.js 5 lifecycle + render tests
    ├── engine-production/        implemented — clean → footage → plan → assemble → render → mix → review
    │   ├── config/style.json     THE locked style (colors, fonts, captions, cards, motion, sfx, grade, clean, voice)
    │   ├── src/                  index.js (engine), plan.mjs, plan-builder.mjs, menu.mjs, assemble.mjs, mix.mjs, build-captions.mjs, templates.mjs, library.mjs, style.mjs
    │   ├── tools/clean/          the cleaner CLI (clean.mjs + align.py/place.py/silence.py, lib/cut.mjs, lib/guard.mjs)
    │   ├── assets/sfx/           reusable sounds (+ catalog.json)
    │   ├── backdrop/brand.svg    the designed base layer (grid with depth)
    │   ├── src/diagrams/         composed SVG diagrams (12 layouts: flow, pipeline, cycle, timeline, before-after, comparison, decision, hierarchy, architecture, relationship, layers, funnel)
    │   └── templates/            14 on-brand graphics (cards, lists, prompts, buttons, people)
    ├── engine-distribution/      skeleton — adapt → schedule → publish → cross-post
    ├── engine-engagement/        skeleton — monitor → classify → reply → escalate
    └── engine-analytics/         skeleton — collect → analyze → insights → playbook
```

---

## Testing

```bash
npm test                 # 167 tests across core + engine-content + engine-production + lifecycle
```

| Package | Tests | What they cover |
|---|---|---|
| `@content-os/core` | 12 | Transitions, gates, lifecycle, retry, fast-track |
| `@content-os/engine-content` | 38 | Fresh ideas, scoring persistence, plan defaults, research/script validation, ready/resubmit, pipeline, playbook, idempotency |
| `@content-os/engine-production` | 112 | Cleaning (cut list, input guard), footage attach, plan validation, assembler, templates, sfx mix, library, captions, review/resubmit/schedule, make_short |
| Lifecycle | 5 | Full lifecycle with all 3 gates, batch production, fast-track, illegal jumps, Markdown rendering |

The cleaning steps also have Python self-tests (not run by `npm test`): `python packages/engine-production/tools/clean/test_align.py` and `test_place.py`.

---

## Brand: Bishir Tijjani

The system is seeded with a real brand profile:

- **Who:** Bishir Tijjani — full-stack engineer who builds production systems
- **Positioning:** "Custom software and AI that actually works"
- **5 pillars:** workflow-automation, custom-software, ai-implementation, customer-acquisition, business-operations
- **5 platforms:** TikTok (5x/week), YouTube (2x/week), Instagram (3x/week), LinkedIn (3x/week), X (daily)
- **Ideas:** generated fresh by the agent each cycle — never a static bank
- **Hook styles:** problem_statement, contrarian, question, stat, story

---

## What's built vs. what's stubbed

| Engine | Status | Actions implemented |
|---|---|---|
| Content | **Fully implemented** | addIdeas, discover, evaluate (7-dim scoring, persisted), plan (playbook + settings fallbacks), research/script (finalize + structural validation), ready, resubmit |
| Cleaning | **Implemented** | align (sample-accurate + drift), place, silence (from audio), transcribe, cut list (pauses/fillers/retakes) — `npm run clean` |
| Production | **Implemented** | process_footage, list_footage, menu, save_plan, edit (plan-validated assemble + render + sfx mix), make_short, request_review, resubmit, schedule |
| Distribution | Stubbed | Contract defined — adapt → schedule → publish → cross-post |
| Engagement | Stubbed | Contract defined — monitor → classify → reply → escalate |
| Analytics | Stubbed | Contract defined — collect → analyze → insights → playbook |

---

## Architecture principles

1. **The DB is the contract.** Engines never import each other — only `@content-os/core`. They communicate exclusively through the database.
2. **The agent is the orchestrator.** No CLI, no API server, no separate LLM module. The AI assistant driving the workflow IS the brain.
3. **The state machine is enforced.** Illegal transitions are rejected. Gates are non-negotiable.
4. **Fast-track compresses work, never validation.** Breaking news can skip stages but cannot bypass gates.
5. **Zero dependencies.** Built on Node.js 22's built-in `node:sqlite`. No npm packages at runtime.
6. **The loop closes.** Analytics produces playbook rules that inform future content. What works gets doubled down on.

---

## Status

- **Foundation:** complete — schema v3, enforced state machine, human gates, batch production model
- **Content Engine:** production-ready — fresh ideas each cycle, scoring persisted, structural validation on research/scripts, full state coverage (idea → ready_to_shoot) including the revision loop
- **Cleaning:** implemented — syncs the separate audio to the video (sample-accurate, drift-corrected), measures silence from the audio, and proposes pauses/fillers/repeated takes for approval before cutting; never modifies its inputs
- **Production Engine:** implemented — footage → agent plan → plan-validated assemble → render → sfx mix → review → schedule, plus vertical shorts; one locked style file, an asset library, and a template book
- **Content contract:** the engine never writes content — the agent generates ideas, writes research notes and scripts, and writes the production plan; the engine finalizes and requests gates
- **Agent ergonomics:** `AGENTS.md` operating manual + `.opencode/skills/script-writing` and `.opencode/skills/clean-recording` skills encode the full loop for any agent tool
- **Tests:** 167/167 passing
- **Other engines:** stubbed with clear contracts, ready to build

See [architecture.md](architecture.md) for the recommended build order.
