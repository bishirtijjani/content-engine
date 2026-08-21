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
| **Production** | "How do we turn footage into finished content?" | Session → Recordings → Edit → Captions → Platform assets | Finished cuts per platform |
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
| **Evaluate** | Candidate ideas + playbook rules | Scores each idea on 7 weighted dimensions | Scored items in `evaluated` + idea gate requested |
| **Plan** | Approved ideas + playbook rules | Fills content strategy fields (pillar, format, hook, CTA, length) | Items in `planned` |
| **Research** | Content strategy | Agent writes a research brief with facts, sources, claims; engine finalizes | Items in `researched` |
| **Script** | Research brief + hook style | Agent writes the finished shooting script (hook, points, CTA, shot instructions); engine finalizes + requests script gate | Items in `scripted` + script gate requested |

> **Content contract:** the engine never writes content. `research()` and `script()` only *finalize* agent-written content — they move items forward and request gates. The agent (the brain) writes `research_notes`, `script`, and `shot_instructions` directly. Items without agent-written content are skipped and logged. No placeholders ever enter the database.

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
  "UPDATE content_items SET research_notes = 'Facts: ... Sources: ...' WHERE id = 1"
).run();
engine.research();  // finalizes: planned -> researched

db.prepare(
  "UPDATE content_items SET script = 'Hook: ...\\n\\nPoint 1: ...\\nCTA: ...', " +
  "shot_instructions = 'talking head + screen share' WHERE id = 1"
).run();
engine.script();    // finalizes: researched -> scripted + requests script gate

// Render the agent-written script in the browser
const item = db.prepare("SELECT * FROM content_items WHERE id = 1").get();
const md = generateMarkdown(item.script, item);
await serveScript(md, item.id, db);
```

### Individual actions

```js
engine.discover();                                    // pull new ideas from sources
engine.evaluate();                                    // score all idea items
engine.plan();                                        // fill plan fields for approved items
engine.research();                                    // generate research briefs
engine.script();                                      // generate shooting scripts
engine.run({ action: 'evaluate', targetId: 3 });      // score a specific item
engine.run({ dryRun: true });                         // preview without changes
```

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
npm test                 # run all tests (41 passing)
```

### Seed your brand

```bash
node scripts/seed-brand.mjs    # seeds the Bishir/Codeket brand profile (no ideas — those are generated fresh each cycle)
```

### Run the pipeline

```bash
node demo.mjs              # runs the full Content Engine pipeline, renders a script in the browser
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
│   ├── smoke-pipeline.mjs        end-to-end smoke test
│   ├── reset-content.mjs         purge placeholder content, reset items to agent-ready state
│   └── serve-script.mjs          render an item's script in the browser (node scripts/serve-script.mjs <id>)
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
    │   ├── src/index.js          discover, evaluate, plan, research, script
    │   └── test/
    │       ├── content.test.js   23 engine tests
    │       └── lifecycle.test.js 5 lifecycle + render tests
    ├── engine-production/        skeleton — session → recordings → finished assets
    ├── engine-distribution/      skeleton — adapt → schedule → publish → cross-post
    ├── engine-engagement/        skeleton — monitor → classify → reply → escalate
    └── engine-analytics/         skeleton — collect → analyze → insights → playbook
```

---

## Testing

```bash
npm test                 # 41 tests across core + engine-content + lifecycle
```

| Package | Tests | What they cover |
|---|---|---|
| `@content-os/core` | 12 | Transitions, gates, lifecycle, retry, fast-track |
| `@content-os/engine-content` | 24 | Discover, evaluate, plan, research/script finalization, pipeline, playbook, idempotency |
| Lifecycle | 5 | Full lifecycle with all 3 gates, batch production, fast-track, illegal jumps, Markdown rendering |

---

## Brand: Bishir / Codeket

The system is seeded with a real brand profile:

- **Who:** Bishir, founder of Codeket — full-stack engineer who builds production systems
- **Positioning:** "Custom software and AI that actually works"
- **5 pillars:** workflow-automation, custom-software, ai-implementation, customer-acquisition, business-operations
- **5 platforms:** TikTok (5x/week), YouTube (2x/week), Instagram (3x/week), LinkedIn (3x/week), X (daily)
- **Ideas:** generated fresh by the agent each cycle — never a static bank
- **Hook styles:** problem_statement, contrarian, question, stat, story

---

## What's built vs. what's stubbed

| Engine | Status | Actions implemented |
|---|---|---|
| Content | **Fully implemented** | discover, evaluate (7-dim scoring), plan (playbook rules), research (finalizes agent notes), script (finalizes agent scripts) |
| Production | Stubbed | Contract defined — session → recordings → assets |
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

- **Foundation:** complete — schema v2, enforced state machine, human gates, batch production model
- **Content Engine:** fully implemented — fresh idea generation each cycle, pipeline runs end-to-end
- **Content contract:** the engine never writes content — the agent generates ideas and writes research notes and scripts; the engine finalizes and requests gates
- **Tests:** 41/41 passing
- **Other engines:** stubbed with clear contracts, ready to build

See [architecture.md](architecture.md) for the recommended build order.
