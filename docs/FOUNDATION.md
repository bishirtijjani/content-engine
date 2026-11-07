# content-os — Foundation Report

**Date:** 2026-08-19 (updated 2026-08-20)
**Status:** Foundation complete — Content Engine fully implemented, 40 tests passing
**Stack:** Node.js >= 22.5, built-in SQLite (`node:sqlite`), zero external dependencies

---

## 1. Mission

> **We only manually shoot the footage. Everything else happens automatically.**

The system is a full content automation engine: five engines (Content, Production,
Distribution, Engagement, Analytics) working on one shared Content Database — the
"central nervous system" — with three human decision gates. The loop closes:
analytics produces insights that inform future content.

## 2. Decisions made, and why

### 2.1 The Content Database is the core, built first
Every engine reads and writes the same database. Without it, engines are blind:
they can't know whether a topic was covered, whether a hook style worked, or
whether a commenter is already a lead. The DB is what makes the feedback loop
physically possible. **Decision: build the schema and state machine before any
engine logic.**

### 2.2 One state machine, five workers
Every piece of content is one record that moves through 13 states. The engines
are workers that pick up records in the states they own and move them forward.
They never call each other — they communicate exclusively through the DB.
**Decision: the state machine is enforced in code; illegal jumps are rejected.**

### 2.3 Three non-negotiable human gates
- `idea_approval` — "I'll spend my face-time on this" (evaluated → planned)
- `asset_review` — "the finished video is good enough to ship" (editing → scheduled)
- `escalation` — money, reputation, angry customers (engagement)

Engines request gates; humans decide; the state machine refuses to move past an
unapproved gate. **Decision: automation stops at these three points, by design.**

### 2.4 JavaScript, monorepo with independent packages
The user is a JS developer — everything they touch is JavaScript. Each engine
will have its own tools, stack, and rules, so each is an independent npm
workspace package with its own `package.json`, dependencies, tests, and entry
point. The only shared dependency is `@content-os/core` (schema, state machine,
gates, db layer). **Decision: npm workspaces — independence without the
solo-creator overhead of five separate repos.** If an engine ever outgrows the
repo, it can be extracted cleanly because it only talks to the DB.

### 2.5 Zero dependencies for the foundation
Node 22's built-in `node:sqlite` provides a full SQLite engine with no install.
The foundation is pure logic and data — no AI models, no APIs, no workflow
tools — exactly as scoped. **Decision: prove the architecture before wiring
automation.**

### 2.6 The agent IS the orchestrator
Instead of a CLI middleman, the agent (OpenWork/Claude Code/etc.) reads the DB,
makes decisions, and calls the engine as a library. This is the HyperFrames
pattern: the engine is the muscle, the agent is the brain, the script renderer
is the output. No API keys to manage — the AI assistant driving the workflow
IS the orchestrator. **Decision: no CLI, no separate LLM module.**

## 3. What exists — file inventory

```
content-os/
├── package.json                  workspace root (scripts: test)
├── architecture.md               the full system design
├── README.md                     quickstart + lifecycle walkthrough
├── .gitignore                    excludes data/*.db, node_modules
├── demo.mjs                      live demo script (agent calls engine directly)
├── src/
│   ├── render-script.js          script renderer (Markdown + browser viewer)
│   └── template.html             HTML template for live script editing
├── data/                         the shared content.db (generated, never committed)
├── scripts/
│   ├── seed-brand.mjs            seed brand settings and idea bank
│   └── smoke-pipeline.mjs        smoke test (engine-driven, no CLI)
└── packages/
    ├── core/                     THE CONTRACT — everything engines share
    │   ├── package.json          @content-os/core
    │   ├── src/
    │   │   ├── index.js          public API
    │   │   ├── schema.sql        17 tables, indexes, foreign keys
    │   │   ├── indexes.sql       performance indexes
    │   │   ├── db.js             connection, schema init, JSON helpers
    │   │   ├── state.js          the state machine (enforced transitions)
    │   │   ├── gates.js          the 3 human gates (request/decide/list)
    │   │   ├── models.js         row mappers (JSON columns decoded)
    │   │   └── engines/base.js   BaseEngine: logging + queue survey
    │   └── test/state.test.js    12 tests: transitions, gates, lifecycle, retry, fast-track
    ├── engine-content/           discover → evaluate → plan → research → script
    │   ├── src/index.js          Content Engine (fully implemented)
    │   └── test/
    │       ├── content.test.js   23 engine tests
    │       └── lifecycle.test.js 5 lifecycle + render tests
    ├── engine-production/        session → recordings → finished platform assets (skeleton)
    ├── engine-distribution/      adapt → schedule → publish → cross-post (skeleton)
    ├── engine-engagement/        monitor → classify → reply → escalate → save ideas (skeleton)
    └── engine-analytics/         collect → analyze → insights → playbook rules (skeleton)
```

## 4. How the system works

### 4.1 The state machine (`packages/core/src/state.js`)

```
idea -> evaluated -> planned -> researched -> scripted -> ready_to_shoot
     -> shot -> editing -> scheduled -> published -> measured -> archived

failed is a side state (render crash, publish error); retry back into the pipeline.
```

- `TRANSITIONS` — the allowed-move table. Anything not listed is illegal.
- `GATE_REQUIREMENTS` — three transitions require an approved gate:
  `evaluated→planned` (idea_approval), `scripted→ready_to_shoot` (script_review),
  and `editing→scheduled` (asset_review).
- `transition()` — validates, checks the gate, updates the item, appends to
  `content_item_history` (actor, reason, timestamp). Throws `StateError` on
  illegal moves.
- `fastTrack()` — skip states with mandatory reason and gate enforcement.

### 4.2 The data model (`packages/core/src/schema.sql`)

17 tables. Key ones:

| Table | Role |
|---|---|
| `content_items` | one row per piece of content — the state machine record |
| `content_item_history` | audit trail of every transition |
| `recording_sessions` | the shoot event — batch unit for production |
| `recordings` | individual recording takes |
| `assets` | finished files, one row per platform cut |
| `posts` | distribution records, one row per platform publication |
| `engagement_items` | comments, DMs, mentions |
| `conversations` | mini-CRM for leads |
| `metrics` | analytics per post per collection time |
| `insights` | what analytics learned, fed back into Content |
| `gates` | the human decision records |
| `engine_logs` | execution trail for every engine run |
| `settings` | brand / authority / cadence profile |
| `playbook_rules` | learned rules from analytics |

### 4.3 The engines

Each engine declares `OWNED_STATES` (which content statuses it picks up) and
`ACTIONS` (its capability contract). The Content Engine is fully implemented:
discover, evaluate (7-dimension scoring), plan (playbook rules), research, script
(template generation by hook style). Other engines are stubbed with clear
contracts.

### 4.4 The agent interface

No CLI. The agent calls the engine as a library:

```js
import { ContentEngine } from '@content-os/engine-content';
import { connect, decideGate } from '@content-os/core';

const db = connect();
const engine = new ContentEngine(db);
engine.pipeline();  // discover → evaluate → plan → research → script
decideGate(db, 1, 'approved', { decidedBy: 'agent' });
```

## 5. Verification

### 5.1 Automated tests — 40/40 passing (`npm test`)

Core (12): legal/illegal transitions, gate requirements, gate blocking,
rejected-gate behavior, full lifecycle with all gates + audit history,
failed-state retry, fast-track.

Engine Content (23): discover, evaluate, plan, research, script, pipeline,
playbook rules, idempotency, error handling.

Lifecycle (5): full lifecycle with all three gates, batch production,
fast-track, illegal jumps, Markdown rendering.

### 5.2 Content Engine — end-to-end

22 content ideas seeded for Example Brand. Pipeline runs:
discover → evaluate → plan → research → script. All fields populated
automatically. Scripts rendered in browser with live editor.

## 6. Current limitations

- Production, Distribution, Engagement, Analytics engines are stubs.
- Script template is basic (hook + 3 points + CTA).
- No platform integrations, no scheduling daemon.
- `failed` state exists but no retry/alert automation around it.
- Single-user; no permissions or multi-owner workflows.

## 7. Roadmap (recommended order)

1. **Analytics** — cheapest; closes the loop first (metrics collection + insight generation)
2. **Distribution** — YouTube/LinkedIn have clean official APIs; TikTok/Instagram restricted
3. **Content enhancements** — LLM-powered scripting, richer templates
4. **Production** — captions/transcription first, then editing
5. **Engagement** — classification + auto-reply + escalation
