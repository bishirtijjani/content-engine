# content-os — Architecture

> The creator's view of this system lives in [WORKFLOW.md](WORKFLOW.md). This
> document is the software view: the data model, the state machine, the gates,
> and the engine contracts. Both documents describe the same system.

**Mission:** *We only manually shoot the footage. Everything else happens automatically.*

**Operating model:** batch production. 20 approved scripts → 1 recording
session → recordings → content items → platform assets → posts → metrics →
insights → playbook rules → next week's ideas.

## 1. The system

Five engines, one Content Database (the central nervous system), four human
gates, one closed loop.

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

- **Content Engine** — "What should we create?" Discover → Evaluate → Plan → Research → Script. Output: **READY TO SHOOT**
- **Production Engine** — "How do we turn the recording into finished content?" Clean the raw recording → attach footage → agent **segment plan** (`Video → Segments → Beats`: footage + snapshots) → derive beats + validate + render the plan → human approval → render → mix sound → human review. Output: **FINISHED ASSETS**. The master's orientation follows the footage (portrait footage → portrait master; a plan may override with `output.orientation`). One locked style file (`config/style.json`); the agent writes the segment plan; the engine derives the word-timed footage and refuses to build without an approved plan. The **cleaner** (`npm run clean`) runs first: it syncs the separate high-quality audio to the camera's own scratch audio (sample-accurate, drift-corrected), measures silence from the audio, and proposes pauses/fillers/repeated takes for approval before cutting — it never modifies its inputs and never writes to the database. Doctrine: everything on screen earns its place and must be narration-supported; snapshots sit on the burnt orange canvas and never enter the caption band.
- **Distribution Engine** — "Where, when and how?" Adapt → Schedule → Publish → Cross-post. Output: **PUBLISHED POSTS**
- **Engagement Engine** — "What happens after people interact?" Monitor → Classify → Reply / Escalate / Save idea. Output: **RESOLVED ENGAGEMENT + LEADS + IDEAS**
- **Analytics** — "What actually happened?" Collect → Analyze → Insights → Playbook rules. Output: **KNOWLEDGE** fed back into Content

## 2. The data model

### 2.1 Entities and cardinality

```
recording_sessions 1───N recordings 1───N content_item_recordings N───1 content_items
       │                                                              │
       │                                                              │
       └──────────────────────────────────────────────────────────────┘
                                 (content_items.session_id)

content_items 1───N assets 1───N posts
      │  │
      │  └──N content_links N── other content_items (follow_up, reuse_research, ...)
      │
      └──N engagement_items (the comment/DM that spawned the item)
      │
      └──N insights (evidence from this item) ──1──N playbook_rules

calendar_entries ── references content_items / posts / sessions (nullable FKs)
```

### 2.2 Cardinality answers

| Question | Answer | Mechanism |
|---|---|---|
| Can one recording produce multiple content_items? | **Yes** | `content_item_recordings` join (role: primary / b_roll / supplementary) |
| Can one content_item use multiple recordings? | **Yes** | same join table, multiple rows per item |
| Can one content_item produce multiple assets? | **Yes** | `assets.content_item_id` (one asset per platform cut) |
| Can one asset be used by multiple posts? | **Yes** | `posts.asset_id` (e.g., same cut on TikTok + Reels) |
| Can one content_item have multiple posts? | **Yes** | `posts.content_item_id` (one per platform) |
| Can one engagement item generate multiple content ideas? | **Yes** | primary via `engagement_items.content_item_id`; additional via `content_links` (inspired_by) |
| Can one insight produce multiple playbook rules? | **Yes** | `playbook_rules.insight_id` (one insight → rules per platform/format) |

### 2.3 Tables

| Table | Role |
|---|---|
| `content_items` | one row per piece of content — the state machine record |
| `content_item_history` | immutable audit trail of every transition (incl. skips) |
| `recording_sessions` | the shoot event (batch unit for production) |
| `recordings` | raw footage files inside a session |
| `content_item_recordings` | which recordings feed which items (role) |
| `content_links` | typed relationships between items (follow_up, reuse_research, reuse_asset, series_part, remix, split_from, inspired_by) |
| `assets` | finished cuts (one per platform per item) |
| `posts` | distribution records (one per platform publication) |
| `calendar_entries` | the planning layer: shoot sessions, publish slots, review slots |
| `engagement_items` | comments, DMs, mentions (linked to the item they spawned) |
| `conversations` | mini-CRM for leads |
| `metrics` | analytics per post per collection time |
| `insights` | findings with evidence count + validation status |
| `playbook_rules` | accepted, actionable knowledge the Content Engine queries |
| `gates` | the human decision records |
| `engine_logs` | execution trail for every engine run |
| `settings` | brand / authority / cadence profile |

## 3. The state machine

### 3.1 Normal transitions

```
idea → evaluated
evaluated → planned            [GATE: idea_approval]
planned → researched
researched → scripted
scripted → ready_to_shoot      [GATE: script_review]
ready_to_shoot → shot          (human shoots)
shot → editing
editing → scheduled            [GATE: asset_review]
scheduled → published
published → measured
measured → archived
```

### 3.2 Fast-track (compressing thinking stages, never production stages)

Breaking news, urgent topics: an item may jump forward across content stages
(idea → scripted, idea → ready_to_shoot, etc.). Rules:

- **Targets are content stages only** — `evaluated, planned, researched,
  scripted, ready_to_shoot`. You cannot fast-track past shooting or editing;
  a video that wasn't shot cannot be published.
- **Mandatory reason** — every fast-track requires a reason; it is recorded.
- **Gates are never bypassed** — every gated edge on the crossed path must
  have an approved gate. Fast-tracking idea → ready_to_shoot requires both
  `idea_approval` and `script_review` to be approved. Fast-track compresses
  *work*, never *validation*.
- **Skipped states are recorded** — the audit trail shows one row:
  `idea → ready_to_shoot (fast-track, skipped: evaluated, planned, researched,
  scripted, reason: breaking news)`.

### 3.3 Revision loops

- `script_review` rejected → item stays `scripted`; script edited; review requested again
- `asset_review` rejected → item stays `editing`; re-edit; review requested again

### 3.4 Failure and retry

- `failed` is reachable from `shot`, `editing`, `scheduled`, `published`
  (render crash, publish error, API failure)
- Retry: `failed →` any earlier state; the reason is recorded

### 3.5 The four human gates

| Gate | Transition | Question it answers |
|---|---|---|
| `idea_approval` | evaluated → planned | "I'll spend my face-time on this" |
| `script_review` | scripted → ready_to_shoot | "This script is worth recording" |
| `asset_review` | editing → scheduled | "The finished video is good enough to ship" |
| `escalation` | engagement (money/reputation) | "A human must handle this" |

Engines request gates; humans decide; the state machine refuses to move past
an unapproved gate.

## 4. Table ownership

| Table | Writes | Reads | Human edits? | Source of truth |
|---|---|---|---|---|
| `content_items` | Content Engine | all engines | yes | the item record |
| `content_item_history` | state machine only | Analytics | no | immutable audit log |
| `recording_sessions` | agent/Production | Production, Distribution, Content | yes | the session record |
| `recordings` | Production | Production, Content | yes | the recording record |
| `content_item_recordings` | Production | Production, Content | yes | the join record |
| `content_links` | Content Engine | Content, Analytics | yes | the link record |
| `assets` | Production | Distribution, Analytics | yes | the asset record |
| `posts` | Distribution | Engagement, Analytics, Distribution | yes | the post record |
| `calendar_entries` | Distribution, Content | Distribution, Content, Production | yes | the calendar record |
| `engagement_items` | Engagement | Engagement, Content, Analytics | yes | the engagement record |
| `conversations` | Engagement | Engagement | yes | the conversation record |
| `metrics` | Analytics | Analytics | yes | the metric snapshot |
| `insights` | Analytics | Content, Analytics | yes | the insight record |
| `playbook_rules` | Analytics (promote), human (accept/retire) | Content Engine (query) | yes | the rule record |
| `gates` | engines (request), humans (decide) | state machine | yes (decide) | the gate record |
| `engine_logs` | engines | humans (debug) | no | append-only log |
| `settings` | agent, humans | all engines | yes | the settings record |

## 5. The batch-production model

The session is the batch unit for production; the item is the unit for content
decisions; the asset is the unit for platform output; the post is the unit for
distribution. Four levels, each with its own lifecycle.

```
20 items in ready_to_shoot (scripts approved)
  → session create (1 row) + session add-item (20 rows: items.session_id)
  → shoot day → recording add (N rows: recordings + content_item_recordings)
  → session upload → Production Engine processes the SESSION as a batch
  → per item: assets (platform cuts) → asset_review gate → scheduled
  → per item: posts (one per platform) → published
```

## 6. The analytics → playbook loop

```
metrics (per post)
  → analysis (correlate against hook_style, pillar, format, length, cta, platform, time)
  → insight (proposed, with evidence_count)
  → human validation (accept / reject)
  → playbook_rule (accepted insight, with applicability: platform, pillar, format)
  → Content Engine queries rules when evaluating/planning:
      "for topic X on platform Y, which hooks/pillars/lengths have positive evidence?"
  → rules retired when contradicted by newer evidence
```

## 7. Engine contracts

Each engine declares `OWNED_STATES` and `ACTIONS`. Automation replaces the
stubs one action at a time. The Content Engine stages have formal I/O:

| Stage | Input | Output | Transition |
|---|---|---|---|
| Discover | agent brainstorm (fresh each cycle), audience comments, trend research | candidate ideas (source, source_url) via `addIdeas()` / `discover()` | → `idea` |
| Evaluate | candidate ideas + playbook rules | scored ideas (0–100 + reason) | → `evaluated` + request idea gate |
| Plan | approved ideas | content strategy (pillar, format, angle, audience, hook, CTA, length, series) | → `planned` |
| Research | content strategy | agent-written research brief (facts, sources, claims); engine finalizes | → `researched` |
| Script | research brief | agent-written shooting script (hook, points, CTA, shot instructions); engine finalizes | → `scripted` + request script gate |
| Ready | approved script | shoot-ready item | → `ready_to_shoot` |

> **Content contract:** the engine never writes content. `research()` and
> `script()` only finalize agent-written content — they move items forward and
> request gates. The agent (the brain) writes `research_notes`, `script`, and
> `shot_instructions` directly; items without them are skipped and logged. No
> placeholders ever enter the database.

## 8. Repository layout

```
content-os/
├── package.json                  workspace root (scripts: test)
├── docs/
│   ├── WORKFLOW.md               the creator's week (this system, human view)
│   └── FOUNDATION.md             the foundation report
├── data/                         the shared content.db (generated)
└── packages/
    ├── core/                     THE CONTRACT — schema, state machine, gates, db layer
    ├── engine-content/           discover → evaluate → plan → research → script
    ├── engine-production/        clean → footage → segment plan → approve → render → mix → review (implemented)
    ├── engine-distribution/      adapt → schedule → publish → cross-post
    ├── engine-engagement/        monitor → classify → reply → escalate → save ideas
    └── engine-analytics/         collect → analyze → insights → playbook rules
```

## 9. Build order

1. **Foundation + batch model** (done) — schema v3, state machine with
   fast-track, session/recording/calendar/playbook tables, Content Engine, tests
2. **Analytics** — metrics collection + insight generation + playbook promotion
3. **Distribution** — YouTube/LinkedIn official APIs; TikTok/Instagram restricted
4. **Content** — idea discovery + LLM planning/scripting (queries the playbook)
5. **Cleaning** (done) — sync the separate audio to the camera (sample-accurate
   + drift), measure silence from the audio, propose pauses/fillers/retakes, cut
   after approval. `npm run clean`; never modifies its inputs
6. **Production** (done) — attach footage, agent segment plan (`Video → Segments
   → Beats`) with derive + validate + approval, render, sfx mix, review, an
   orientation-aware master (source-driven, overridable)
7. **Engagement** — classification + auto-reply + escalation

## 10. Extraction path

Any engine can be split into its own repo/service — it only talks to the DB.
The schema is the only contract that must stay in sync.