# Diagram layouts

A snapshot segment can carry a named diagram instead of a concept recipe:

```json
{ "id": "d3", "kind": "snapshot", "start": 12.4, "end": 27.8,
  "diagram": { "name": "flow", "spec": { "title": "How it runs", "steps": ["Capture", "Classify", "Act"], "active": 2 } } }
```

- **58 layouts**, one authoring layer. Every layout compiles to the same scene-graph the snapshot recipes render, so stills, footage derivation, slots, cues and motion work unchanged.
- **Both orientations** from one spec (9:16 and 16:9); slot ids are identical.
- **Beats.** Every slot must be introduced by a beat. Leave `beats` empty and the engine synthesises them from the narration in build order; explicit beats always win.
- **Brand.** Layouts read `config/style.json` through `src/diagrams/theme.mjs`. No colour, font, radius or backdrop is defined here.
- **Catalog.** `npm run gallery` writes `data/gallery/index.html` with every layout, portrait and landscape, using neutral placeholder copy.

The `fields` column is the spec the agent writes. The `slots` column is an example from the catalog sample; `engine.menu().plan.diagrams` is the live source of truth.

## Process & logic

| Layout | Fields | Slots (example) | What it draws |
|---|---|---|---|
| `flow` | `title` `steps` `active` | title, node-0, link-0, node-1, link-1, node-2, link-2, node-3 | Steps joined by arrows, revealed in order with one step highlighted |
| `pipeline` | `title` `steps` `progress` | title, node-0, link-0, rail-0, node-1, link-1, rail-1, node-2, rail-2 | Stages progressing start to finish, with a progress rail |
| `cycle` | `title` `steps` `active` `center` | title, center, node-0, link-0, node-1, link-1, node-2, link-2, node-3, link-3 | A repeating process arranged on a circle with curved arrows |
| `swimlane` | `title` `lanes` `steps` | title, lane-0, lane-1, step-0, step-1, step-2, step-3 | Steps placed in the lane that owns them |
| `sequence` | `title` `actors` `messages` | title, actor-0, actor-1, actor-2, msg-0, msg-1, msg-2, msg-3 | Actors as columns, messages as time-ordered arrows |
| `state-machine` | `title` `states` `transitions` | title, state-draft, state-review, state-live, trans-0, trans-1, trans-2 | States and the transitions between them |
| `fork-join` | `title` `start` `branches` `join` | title, node-start, branch-0, branch-1, branch-2, node-join, link-in-0, link-out-0, link-in-1, link-out-1, link-in-2, link-out-2 | A flow that forks into parallel branches and joins again |
| `approval-chain` | `title` `stages` | title, stage-0, stage-1, stage-2 | Stages in a chain, each with an owner and a status |
| `decision` | `title` `question` `yes` `no` `yesLabel` `noLabel` | title, question, branch-yes, branch-no | A decision with a Yes and a No branch leading to outcomes |

## Structure & systems

| Layout | Fields | Slots (example) | What it draws |
|---|---|---|---|
| `architecture` | `title` `nodes` `links` | title, node-app, node-api, node-db, node-queue, link-0, link-1, link-2 | System components and their connections, with labelled links |
| `hierarchy` | `title` `root` `levels` | title, node-root, node-0-0, edge-0-0, node-0-1, edge-0-1, node-1-0, edge-1-0, node-1-1, edge-1-1, node-1-2, edge-1-2 | A parent/child tree across levels, joined by elbow connectors |
| `relationship` | `title` `hub` `nodes` `links` | title, hub, node-0, node-1, node-2, link-0, link-1, link-2 | Entities that interact, arranged around a hub with labelled links |
| `layers` | `title` `layers` | title, layer-0, layer-1, layer-2 | Layers stacked top to bottom, each a band of one system tier |
| `erd` | `title` `entities` `relations` | title, entity-0, entity-1, rel-0 | Entities with fields, joined by cardinality relationships |
| `data-flow` | `title` `sources` `process` `stores` `sinks` | title, source-0, process, store-0, sink-0 | Where data comes from, what processes it and where it lands |
| `deployment` | `title` `zones` `links` | title, zone-0, item-0-0, zone-1, item-1-0, item-1-1, zone-2, item-2-0, item-2-1, link-0, link-1, link-2 | Zones and the services deployed inside them |
| `mind-map` | `title` `center` `branches` | title, center, branch-0, leaf-0-0, leaf-0-1, branch-1, leaf-1-0, branch-2, leaf-2-0, leaf-2-1 | A central idea with branches and their leaves |
| `venn` | `title` `sets` `intersections` | title, circle-0, label-0, circle-1, label-1, circle-2, label-2 | Two or three overlapping sets, with the overlap named |
| `pyramid` | `title` `levels` | title, level-0, level-1, level-2 | Levels stacked widest at the base |
| `matrix` | `title` `x` `y` `quadrants` | title, quadrant-0, quadrant-1, quadrant-2, quadrant-3 | A two-by-two matrix with items in each quadrant |
| `quadrant` | `title` `x` `y` `points` `quadrants` | title, point-0, point-1, point-2, point-3 | Points positioned across four labelled quadrants |
| `treemap` | `title` `items` | title, tile-0, tile-1, tile-2, tile-3, tile-4 | Rectangles sized by value |

## Time & planning

| Layout | Fields | Slots (example) | What it draws |
|---|---|---|---|
| `timeline` | `title` `events` `active` | title, marker-0, label-0, marker-1, label-1, marker-2, label-2 | Events placed along a time axis with dated markers |
| `funnel` | `title` `stages` | title, stage-0, stage-1, stage-2 | Stages that narrow like a funnel, with the count at each stage |
| `gantt` | `title` `tasks` | title, row-0, row-1, row-2, row-3 | Tasks as bars on a shared time axis |
| `calendar` | `title` `month` `events` | title, event-0, event-1, event-2, event-3 | A month grid with events on their days |
| `milestones` | `title` `milestones` `active` | title, marker-0, label-0, marker-1, label-1, marker-2, label-2 | Milestones along a time axis, each with a date and status |
| `before-after` | `title` `before` `after` | title, panel-before, arrow, panel-after | A transformation: a before state and an after state, joined by an arrow |
| `journey-map` | `title` `stages` `rows` | title, stage-0, stage-1, stage-2, stage-3, cell-0-0, cell-0-1, cell-0-2, cell-0-3, cell-1-0, cell-1-1, cell-1-2, cell-1-3, cell-2-0, cell-2-1, cell-2-2, cell-2-3 | Stages across, experience rows down |
| `flywheel` | `title` `steps` `center` `active` | title, center, node-0, link-0, node-1, link-1, node-2, link-2, node-3, link-3 | A self-reinforcing loop with a named centre |

## Quantitative & charts

| Layout | Fields | Slots (example) | What it draws |
|---|---|---|---|
| `table` | `title` `columns` `rows` `header` `zebra` `highlightRow` | title, row-0, row-1, row-2, row-3 | A ruled table with a header row: rates, ledgers, data |
| `line-chart` | `title` `x` `series` `valueLabels` | title, series-0, series-1 | A trend over categories, one line per series |
| `area-chart` | `title` `x` `series` `valueLabels` | title, series-0 | A trend over categories, filled to the baseline |
| `scatter` | `title` `x` `y` `points` | title, point-0, point-1, point-2, point-3, point-4 | Points positioned on two axes, one label each |
| `pie` | `title` `slices` `donut` `center` | title, slice-0, slice-1, slice-2, slice-3 | A whole split into slices, with a legend |
| `stacked-bars` | `title` `categories` `series` | title, bar-0-0, bar-0-1, bar-0-2, bar-1-0, bar-1-1, bar-1-2, bar-2-0, bar-2-1, bar-2-2, bar-3-0, bar-3-1, bar-3-2 | Categories split into stacked series, one bar per category |
| `waterfall` | `title` `items` | title, bar-0, bar-1, bar-2, bar-3, bar-4 | A running total built from additions and subtractions |
| `sankey` | `title` `nodes` `links` | title, node-a, node-b, node-c, node-d, flow-0, flow-1, flow-2, flow-3 | Flows between nodes, band width carrying the value |
| `heatmap` | `title` `rows` `cols` `values` | title, cell-0-0, cell-0-1, cell-0-2, cell-0-3, cell-1-0, cell-1-1, cell-1-2, cell-1-3, cell-2-0, cell-2-1, cell-2-2, cell-2-3 | A matrix of values, intensity carrying the number |
| `gauge` | `title` `value` `min` `max` `unit` | title, arc-fill, needle, value | A single value against its range, on an arc |
| `ranking` | `title` `items` | title, row-0, row-1, row-2, row-3 | Ordered rows with a rank, a label and a proportional bar |
| `bullet` | `title` `items` | title, bar-0, target-0, bar-1, target-1, bar-2, target-2 | A value bar against a target on a shared scale |

## Comparison & narrative

| Layout | Fields | Slots (example) | What it draws |
|---|---|---|---|
| `comparison` | `title` `columns` `highlight` | title, col-0, col-1, col-2 | Two or three alternatives compared as panels, one highlighted |
| `pros-cons` | `title` `pros` `cons` | title, row-p-0, row-p-1, row-p-2, row-c-0, row-c-1, row-c-2 | Advantages and drawbacks side by side |
| `old-vs-new` | `title` `old` `new` | title, panel-before, arrow, panel-after | The old way against the new way, joined by a transformation arrow |
| `iceberg` | `title` `above` `below` | title, item-above-0, item-below-0, item-below-1, item-below-2 | What shows above the waterline, and what sits below it |
| `spectrum` | `title` `low` `high` `markers` | title, marker-0, marker-1, marker-2 | A scale with low and high ends and markers along it |
| `balance` | `title` `left` `right` `verdict` | title, beam, pan-left, pan-right, verdict | Two sides weighed against each other, with a verdict |
| `bullseye` | `title` `rings` | title, ring-0, ring-1, ring-2 | Concentric rings, with a label on each |

## Interface & proof

| Layout | Fields | Slots (example) | What it draws |
|---|---|---|---|
| `annotated-screenshot` | `title` `image` `callouts` | title, img, callout-0, callout-1, callout-2 | A real screenshot with labelled callouts |
| `wireframe` | `title` `device` `blocks` | title, block-0, block-1, block-2, block-3 | A browser or phone frame containing layout blocks |
| `code` | `title` `language` `lines` `diff` | title, code | A short code block, optionally as a diff |
| `terminal` | `title` `lines` | title, terminal | A terminal window with command output |
| `chat` | `title` `messages` | title, msg-0, msg-1, msg-2 | A short chat or comment thread, one message at a time |
| `post` | `title` `platform` `author` `handle` `text` `metrics` | title, post | A social post card with author, text and metrics |
| `map` | `title` `image` `markers` | title, marker-0, marker-1, marker-2 | A basemap with markers placed by longitude and latitude |
| `lower-third` | `name` `role` | name, role | A lower-third name and role plate |
| `icon-grid` | `title` `items` | title, item-0, item-1, item-2, item-3, item-4, item-5 | A grid of icons with a label under each |

## Adding a layout

1. Create `src/diagrams/layouts/<family>/<name>.mjs` exporting `{name, description, frame, fields, minDurationFor, validate, slots, build}`.
2. `build(spec, frame, primitives)` returns `{nodes, build}`; mark non-narrative chrome `slot: false` and order every revealable slot in `build`.
3. Register it in `src/diagrams/registry.mjs` and add a neutral sample to `tools/diagram-samples.mjs`.
4. `npm test` compiles every registered layout in both orientations and checks slots, nodes and build order agree.
