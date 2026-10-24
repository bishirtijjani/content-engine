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
| **Production** | "How do we turn footage into finished content?" | Attach footage → Agent segment plan → Approve → Render → Mix sound → Review | Finished cuts (portrait or landscape, following the footage) |
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

## Data layout

Everything generated lives under `data/` (gitignored). One folder per item, and
`packages/core/src/paths.js` is the only code that decides where things go —
no engine, tool, or script hand-builds a path into `data/`.

```
data/
├── content.db                         the database
├── inbox/                             raw footage nobody has attached yet (list_footage scans it)
├── item-<id>/                         one folder per content_items.id — everything that item owns
│   ├── source.mp4                     the recording (process_footage adopts it — ONE copy on disk)
│   ├── source.transcript.json         its transcript, always a sibling of the video it describes
│   ├── script.txt                     spoken lines for recording (content engine ready())
│   ├── script.json                    mirror of content_items.script (the DB is the source of truth)
│   ├── <name>.cleaned.mp4, .review.json, .cuts.json, …   cleaner outputs
│   └── production/                    the production engine's work
│       ├── snapshots.plan.json        the agent's segment plan (video.item stamped in)
│       ├── index.html                 the built composition
│       ├── plan/                      stills, html, beats.md, snapshots.json, contact sheet
│       └── source.mp4                 hardlink of the a-roll — not a second copy
├── renders/                           finished videos ONLY + detached logs _job.out / .err / .pid
└── tmp/                               scratch: HyperFrames work dirs, test output
```

Three rules:

1. **A file that belongs to an item → `data/item-<id>/`. A finished video →
   `data/renders/`. Neither → `data/tmp/` or delete it.** Nothing else sits
   directly under `data/`.
2. **The item's id decides the folder**, never a plan's free-text `video.id`.
   `save_snapshot_plan` stamps `video.item`; `tools/plan-snapshots.mjs` and
   `tools/render-snapshots.mjs` resolve against it, fail loudly when they
   cannot, and refuse to write outside `data/`. (The old
   `data/compositions/${video.id ?? 'video'}` fallback is what scattered
   `data/compositions/{video,sg-smoke,agent-loop,item-fin,item2-sgtest}`.)
3. **One transcript per recording** — `<video>.transcript.json` next to that
   video. No second copy inside the composition folder.

Items still in the old tree (`data/compositions/item-<id>`, `data/vid1-test`)
resolve through the same legacy-aware resolver, so an item under human review
never has to move mid-flight. Move one when you are ready:

```bash
node scripts/migrate-data.mjs --item 1 --dry-run   # print the plan, change nothing
node scripts/migrate-data.mjs --item 1             # migrate (idempotent — rerunning is a no-op)
node scripts/migrate-data.mjs --verify             # every DB pointer that no longer exists
```

---

## The Cleaning step (implemented)

Before production, one raw recording becomes one clean video. Put one video and the separate audio recording in `data/item-<id>/`; the cleaner syncs them (sample-accurate, drift-corrected) and cuts the pauses and wrong takes.

```bash
npm run clean -- data/item-1            # propose: print the cut list, cut nothing
npm run clean -- data/item-1 --apply    # cut, after the human approves
```

- It adds no captions and no overlays — it only syncs and cuts. Production does the rest.
- **Repeated takes** keep the last try and remove the first try plus everything said up to it; self-talk ("start again", "I'm supposed to", counting "three two one") goes on its own. No script is needed, so improvised lines are kept.
- **Tags** — a watermark a service baked in (Auphonic's free "free audio post production by auphonic.com") is removed at the very start or end.
- **Pauses come from measured audio silence, never from transcript gaps**, so a word the speech model missed can never be cut.
- **It never writes to its inputs** — the video and the audio are read-only, and it refuses any output equal to an input.
- Always show the cut list and get the human's yes before `--apply`.
- Thresholds live in `config/style.json` under `clean`. Steps are cached next to the video; only the cut re-encodes.
- Output: `data/<folder>/<name>.cleaned.mp4` + `<name>.cleaned.transcript.json` — the folder's basename is the name, so an item writes `data/item-1/item-1.cleaned.mp4`. The transcript is reused by `edit()` for captions.

---

## The Production Engine (implemented)

The Production Engine answers "How do we turn a recording into a finished video?" It is the single home for production. The model is **Video → Segments → Beats**.

```js
import { connect } from '@content-os/core';
import { ProductionEngine } from '@content-os/engine-production';
const engine = new ProductionEngine(connect());

engine.listFootage();                            // video files waiting in data/
engine.processFootage({ targetId, filePath });   // attach the cleaned file -> shot
engine.saveSnapshotPlan({ targetId, plan });     // store the agent's segment plan
await engine.planSnapshots({ targetId });        // derive beats, validate, render the plan, stop for approval
engine.approveSnapshotPlan({ targetId });        // the human approves (in chat)
engine.preview({ targetId });                    // fast low-res render while iterating
engine.edit({ targetId });                       // build + render the final -> editing
engine.requestReview({ targetId });              // asset_review gate
engine.schedule({ targetId });                   // after approval -> scheduled
```

- The engine never writes content. The agent writes a **segment plan** (`Video → Segments → Beats`): an ordered list of segments — **FOOTAGE** (the face), **SNAPSHOT** (one completed b-roll composition each), and **CLIP** (a real screen recording or footage insert, played full-frame and muted). The engine derives the word-timed footage, validates the plan, renders one still per snapshot plus a contact sheet, and **stops for the human**. On approval it builds one composition, renders it, and lays sound under the voice.
- **The plan is mandatory and gated.** No video is built without an approved plan: `preview` and `edit` refuse until `snapshot_plan_review` is approved.
- **Doctrine:** everything on screen must earn its place — on-screen content is narration-supported only (no data the speaker never says). It all sits on the burnt orange canvas; visuals never enter the caption band.
- `config/style.json` is the ONE style file — colors, fonts, captions, cards, the motion vocabulary, the footage/snapshot timing thresholds, grade.
- The backdrop is a designed file, `backdrop/brand.svg` (a grid with depth), and the base layer of every snapshot.

### The plan contract

A video is authored as **segments**. A **snapshot** is ONE completed composition (a recipe: `title-steps`, `equation`, `keypoint`, `worksheet`, `decision`, `bars`, `quote`, `cta`); its **beats** progressively build it, each revealing a named **slot** on the exact narration word. A **footage** segment is the face — you do not place it by hand; the engine derives it. A **clip** segment is a real video file (screen recording or b-roll), played full-frame, 1x and muted under the narration.

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
      ] },
    { "id": "c1", "kind": "clip", "src": "data/item-4/screen/screenrec1.mp4",
      "start": 47.7, "end": 55.2, "sourceIn": 0,
      "why": "show the real personalization screen while the steps are named" }
  ] }
```

**Footage is derived word-accurately.** A snapshot is on screen only while its content builds and shows (its first body element → its last content word); every remaining stretch — a lead-in, a gap between snapshots, the hook, the tail — becomes footage, snapped to the narration words. A gap shorter than `footage.minGapSeconds` (3s) is not worth a cut: the previous scene holds across it (seamless b-roll). A snapshot on screen shorter than `footage.minSnapshotSeconds` (2s) is held longer, so a b-roll never flashes. The emitted plan lists every footage segment with the narration that plays over it.

**A clip is real video, never a still.** It plays its `src` full-frame, 1x and muted, for its exact `start`–`end` window while the narration keeps running. `sourceIn`/`sourceOut` select a region of the file; the on-screen length must equal the source length. Clips are never stretched or merged across a gap — the gaps around them become footage.

`validateSnapshotPlan()` refuses anything off-model: an unknown concept, an empty composition, a beat with no `spoken`, a slot that no beat introduces, a target that is not a slot of the concept, a beat past its segment window, a narration beat not covered by any segment, a clip with no `src`/`why` or a clip whose on-screen length does not match its source, and — given the words — a slot cued on a phrase **not spoken inside its own beat**. The engine also refuses a clip whose file is missing or not a video, or whose source window runs past the end of the file. Nothing renders if the plan fails.

### Beats and cues

A beat names an `action.op` (`introduce`, `reveal`, `move`, `resize`, `restyle`, `retext`, `replace`, `highlight`, `hold`) and the slot(s) it acts on. A reveal lands on the exact narration word: a figure is cued automatically on the number it shows; otherwise set `action.cue` to the word/phrase the slot should appear on — a string, or a `{slot: phrase}` map. A cue must be spoken **inside that beat**, so nothing appears on unrelated narration. Numbers shown as figures count up to their exact stated value.

### Menu

```js
engine.menu({ targetId });   // brand doctrine, the segment model, concepts + slots, actions, transitions, the cue rule, the icon vocabulary
```

Icons come from **Tabler** (MIT) — geometry is inlined at build time into `src/diagrams/icons.generated.mjs` (`npm --workspace @content-os/engine-production run icons`), read at runtime with no dependency.

### Plan tools

```bash
node tools/plan-snapshots.mjs  data/item-1/production/snapshots.plan.json   # derive beats, validate, render stills + contact sheet
node tools/render-snapshots.mjs data/item-1/production/snapshots.plan.json [--final]
```

Both resolve the target item from `plan.video.item` (or `--item <n>`, or an
`item-<n>` / `vid<n>` shape inside `video.id` / `video.planDir`), verify it
exists, and write only inside `data/`. Stills and the contact sheet go to
`data/item-<id>/production/plan/`; rendered videos go to `data/renders/` like
every other render. A plan with a free-text id and no `video.item` fails with an
actionable error instead of minting a new folder.

---

## Diagram layouts (implemented)

A snapshot segment can carry a **named diagram** instead of a concept recipe:

```json
{
  "id": "d3", "kind": "snapshot", "start": 12.4, "end": 27.8,
  "diagram": {
    "name": "flow",
    "spec": { "title": "How the automation runs", "steps": ["Capture", "Classify", "Act"], "active": 2 }
  }
}
```

`name` is one of **58 native layouts** across six families — process, structure, time, charts, narrative and interface. `engine.menu().plan.diagrams` lists every layout with its fields; [docs/DIAGRAMS.md](docs/DIAGRAMS.md) is the full reference.

A diagram is an **authoring layer, not a second renderer**: it compiles to the same scene-graph the snapshot recipes use, so stills, footage derivation, slots, cues and motion work unchanged. Layouts assign stable slot ids (`node-0`, `link-0`, `bar-1`, `cell-0-1`, …); every layout renders in both 9:16 and 16:9 from the same spec. If a diagram segment has no beats, the engine synthesises them from the narration in build order — explicit beats always win.

```bash
npm run gallery     # data/gallery/index.html — every layout, portrait + landscape, neutral copy
```

The catalog uses placeholder content only. Layouts read `config/style.json` through `diagrams/theme.mjs`; no brand colour, font, radius or backdrop is defined or overridden there.

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
npm run clean -- data/item-1            # propose: print the cut list, cut nothing
npm run clean -- data/item-1 --apply    # cut, after the human approves
```

### Distribution worker

```bash
node --disable-warning=ExperimentalWarning scripts/distribution-worker.mjs --schedule --publish --cleanup --json
```

The systemd timer runs this every 5 minutes. Setup, account configuration,
recovery, and the TikTok/Instagram audit requirements are in
[docs/DISTRIBUTION.md](docs/DISTRIBUTION.md).

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
├── data/                         generated content — content.db, inbox/, item-<id>/, renders/, tmp/ (never committed; see "Data layout")
├── scripts/
│   ├── seed-brand.mjs            seed brand settings (ideas are generated fresh by the agent)
│   ├── seed-script-framework.mjs seed the script-writing guide (settings.script_framework)
│   ├── seed-idea-framework.mjs   seed the idea-generation guide (settings.idea_framework)
│   ├── smoke-pipeline.mjs        end-to-end smoke test
│   ├── migrate-data.mjs          fold an item's files into data/item-<id>/ (--item <id>, --dry-run, --all, --verify)
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
    │   │   ├── paths.js          THE data layout: item dirs, adoption, legacy resolution, write guards
    │   │   └── engines/base.js   BaseEngine: logging + queue survey
    │   └── test/                 state.test.js (12), paths.test.js (9)
    ├── engine-content/           Content Engine (fully implemented)
    │   ├── src/index.js          addIdeas, discover, evaluate, plan, research, script, ready, resubmit
    │   └── test/
    │       ├── content.test.js   38 engine tests
    │       └── lifecycle.test.js 5 lifecycle + render tests
    ├── engine-production/        implemented — clean → footage → segment plan → approve → render → mix → review
    │   ├── config/style.json     THE locked style (colors, fonts, captions, cards, motion, footage thresholds, grade, clean, voice)
    │   ├── src/                  index.js (engine), menu.mjs, mix.mjs, build-captions.mjs, script-captions.mjs, beats.mjs, style.mjs
    │   ├── src/composition/      the engine: snapshot-spec, snapshot (recipes), motion, sync, footage (derivation), timeline, snapshot-plan, snapshot-render, scene-graph
    │   ├── src/diagrams/         58 native layouts (theme, frame, primitives, compile, registry, layouts/*, charts, code tokenizer)
    │   ├── src/diagrams/icons*   the Tabler icon registry (geometry inlined at build time)
    │   ├── tools/clean/          the cleaner CLI (clean.mjs + align.py/place.py/silence.py, lib/cut.mjs, lib/guard.mjs)
    │   ├── tools/                plan-snapshots.mjs, render-snapshots.mjs, build-icons.mjs, diagram-gallery.mjs, lib/item-dir.mjs (item target resolution)
    │   ├── assets/sfx/           reusable sounds
    │   └── backdrop/brand.svg    the designed base layer (grid with depth)
    ├── engine-distribution/      implemented — adapt → schedule → publish (Instagram + TikTok), nginx media, worker
    ├── engine-engagement/        skeleton — monitor → classify → reply → escalate
    └── engine-analytics/         skeleton — collect → analyze → insights → playbook
```

---

## Testing

```bash
npm test                 # 373 tests across core + engines + lifecycle
```

| Package | Tests | What they cover |
|---|---|---|
| `@content-os/core` | 21 | Transitions, gates, lifecycle, retry, fast-track, the data layout contract (`paths.js`: one folder per item, adoption/hardlinking, legacy resolution, write guards, renderer scratch pruning) |
| `@content-os/engine-content` | 39 | Fresh ideas, scoring persistence, plan defaults, research/script validation, ready/resubmit, pipeline, playbook, idempotency |
| `@content-os/engine-production` | 174 | Cleaning (cut list, input guard), footage attach + adoption, the segment plan (spec gates, footage derivation, cue resolution, timeline/motion), snapshot recipes + render, all 58 diagram layouts (compile, slots/build agreement, validation, auto-beats, new scene-graph primitives), plan-target resolution (`tools/lib/item-dir.mjs`), icons, sfx mix, captions, the full save→plan→approve→build flow, review/resubmit/schedule |
| `@content-os/engine-distribution` | 123 | Copy validation, account eligibility, scheduling/calendar, idempotency, atomic publish leases, Instagram Graph flow and ambiguity-safe recovery, TikTok Direct Post, nginx media, credentials, dry-run immutability, worker lock and partial failures |
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
| Production | **Implemented** | process_footage, list_footage, menu, save_snapshot_plan, plan_snapshots (derive + validate + render the plan), approve_snapshot_plan, preview, edit (plan-gated build + render + sfx mix), request_review, resubmit, schedule |
| Distribution | **Implemented** | adapt (validated platform copy), schedule (timezone, cadence, calendar), publish (Instagram Reels, TikTok Direct Post), restart-safe state, nginx media host, systemd worker |
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

- **Foundation:** complete — schema v6, enforced state machine, human gates, batch production model
- **Content Engine:** production-ready — fresh ideas each cycle, scoring persisted, structural validation on research/scripts, full state coverage (idea → ready_to_shoot) including the revision loop
- **Cleaning:** implemented — syncs the separate audio to the video (sample-accurate, drift-corrected), measures silence from the audio, and proposes pauses/fillers/repeated takes for approval before cutting; never modifies its inputs
- **Production Engine:** implemented — footage → agent segment plan → derive + validate + approve → render → sfx mix → review → schedule; the master's orientation follows the footage; one locked style file, the `Video → Segments → Beats` model (word-timed footage derivation, snapshot recipes, cue-on-word reveals)
- **Content contract:** the engine never writes content — the agent generates ideas, writes research notes and scripts, and writes the production plan; the engine finalizes and requests gates
- **Agent ergonomics:** `AGENTS.md` operating manual + `.opencode/skills/script-writing`, `.opencode/skills/clean-recording`, and `.opencode/skills/distribution` encode the full loop for any agent tool
- **Diagrams:** implemented — 58 native layouts (12 resurrected + 46 new across process, structure, time, charts, narrative and interface); compiled to the scene-graph so slots, cues, motion and both orientations work unchanged; `npm run gallery` renders the catalog
- **Tests:** 373 tests — 372 pass, 1 skipped (production render test needs Chrome + ffprobe)
- **Other engines:** Engagement and Analytics remain stubbed with clear contracts.

See [architecture.md](architecture.md) for the recommended build order.
