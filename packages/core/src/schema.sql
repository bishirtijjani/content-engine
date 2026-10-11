-- ============================================================================
-- content-os — the Content Database (central nervous system)
-- ----------------------------------------------------------------------------
-- Every engine reads and writes these tables. The state machine in state.js
-- defines which statuses a content item may move through; this schema is the
-- system of record underneath it.
--
-- Statuses: idea -> evaluated -> planned -> researched -> scripted
--           -> ready_to_shoot -> shot -> editing -> scheduled
--           -> published -> measured -> archived  (failed is a side state)
--
-- Schema version 2: added recording_sessions, recordings,
-- content_item_recordings, content_links, playbook_rules, calendar_entries;
-- content_items.session_id/recording_id, engagement_items.content_item_id,
-- insights.evidence_count/last_confirmed_at, history.skipped_states.
-- ============================================================================

PRAGMA foreign_keys = ON;

-- Schema metadata (schema_version, etc.)
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- 1. CONTENT ITEMS — one row per piece of content, from first idea to archive
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS content_items (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  status                TEXT NOT NULL DEFAULT 'idea',
  title                 TEXT NOT NULL,
  source                TEXT,              -- trend | question | comment | forum | competitor | product | experience | past_success | other
  source_url            TEXT,
  pillar                TEXT,              -- content pillar this belongs to
  format                TEXT,              -- talking_head | screen_recording | hybrid | other
  angle                 TEXT,
  target_audience       TEXT,
  hook_style            TEXT,              -- problem_statement | question | stat | story | contrarian | other
  cta                   TEXT,
  desired_length_seconds INTEGER,
  series                TEXT,              -- series name if part of one
  evaluation_score      INTEGER,           -- 0..100, from the Content Engine
  evaluation_reason     TEXT,
  research_notes        TEXT,
  script                TEXT,
  video_plan            TEXT,              -- agent-written production plan (JSON): overlays, zooms, sfx
  shot_instructions     TEXT,              -- b-roll, screen-record, camera notes
  priority              TEXT NOT NULL DEFAULT 'medium',  -- low | medium | high
  tags                  TEXT,              -- JSON array
  related_item_id       INTEGER REFERENCES content_items(id),  -- primary parent (legacy; use content_links)
  session_id            INTEGER REFERENCES recording_sessions(id),  -- the shoot event (batch unit)
  recording_id          INTEGER REFERENCES recordings(id),          -- primary raw footage (see content_item_recordings for more)
  notes                 TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Audit trail of every state transition (who, what, when, why).
-- skipped_states records fast-tracked states (JSON array) — the item never
-- actually entered them; the trail stays complete.
CREATE TABLE IF NOT EXISTS content_item_history (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  content_item_id INTEGER NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  from_status     TEXT,
  to_status       TEXT NOT NULL,
  actor           TEXT NOT NULL DEFAULT 'system',  -- human | engine:<name>
  reason          TEXT,
  skipped_states  TEXT,                   -- JSON array of states skipped by fast-track
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- 2. RECORDING SESSIONS — the shoot event. The batch unit for production.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recording_sessions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT NOT NULL,
  scheduled_at  TEXT,                      -- ISO 8601 (UTC)
  location      TEXT,
  status        TEXT NOT NULL DEFAULT 'planned',
                -- planned | recorded | uploaded | processing | done | cancelled
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Raw footage files inside a session.
CREATE TABLE IF NOT EXISTS recordings (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id       INTEGER NOT NULL REFERENCES recording_sessions(id) ON DELETE CASCADE,
  file_path        TEXT,
  duration_seconds REAL,
  camera           TEXT,
  status           TEXT NOT NULL DEFAULT 'raw',  -- raw | uploaded | processed
  notes            TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Which recordings feed which content items (many-to-many with a role).
-- One recording can split into many items (interview -> clips);
-- one item can use many recordings (primary + b-roll + retakes).
CREATE TABLE IF NOT EXISTS content_item_recordings (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  content_item_id INTEGER NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  recording_id    INTEGER NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  role            TEXT NOT NULL DEFAULT 'primary',  -- primary | b_roll | supplementary
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (content_item_id, recording_id)
);

-- ---------------------------------------------------------------------------
-- 3. ASSETS — finished files produced from a shoot (one row per platform cut)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assets (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  content_item_id INTEGER NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  platform        TEXT NOT NULL DEFAULT 'original',  -- original | tiktok | instagram | youtube | linkedin | other
  file_path       TEXT,
  status          TEXT NOT NULL DEFAULT 'raw',       -- raw | processing | edited | review | approved | rejected
  duration_seconds REAL,
  width           INTEGER,                           -- rendered canvas width in pixels
  height          INTEGER,                           -- rendered canvas height in pixels
  orientation     TEXT,                              -- portrait | landscape
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- 4. POSTS — distribution records: one row per platform publication
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS posts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  content_item_id INTEGER NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  asset_id        INTEGER REFERENCES assets(id) ON DELETE SET NULL,
  platform        TEXT NOT NULL,          -- tiktok | instagram | youtube | linkedin | other
  status          TEXT NOT NULL DEFAULT 'scheduled',  -- scheduled | published | failed | skipped
  title           TEXT,
  caption         TEXT,
  description     TEXT,
  hashtags        TEXT,                   -- JSON array
  thumbnail_path  TEXT,
  scheduled_at    TEXT,                   -- ISO 8601 (UTC)
  published_at    TEXT,
  external_id     TEXT,                   -- platform post id after publishing
  url             TEXT,
  publish_error   TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- 5. ENGAGEMENT — comments, DMs, mentions (plus mini-CRM conversations)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversations (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  platform          TEXT NOT NULL,
  external_thread_id TEXT,
  lead_name         TEXT,
  lead_status       TEXT NOT NULL DEFAULT 'new',  -- new | engaged | qualified | closed | dead
  notes             TEXT,
  last_message_at   TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS engagement_items (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id                INTEGER REFERENCES posts(id) ON DELETE SET NULL,
  content_item_id        INTEGER REFERENCES content_items(id) ON DELETE SET NULL,  -- the item this spawned
  platform               TEXT NOT NULL,
  kind                   TEXT NOT NULL DEFAULT 'comment',  -- comment | dm | mention | reply
  author                 TEXT NOT NULL,
  text                   TEXT NOT NULL,
  classification         TEXT,              -- lead | idea | technical | simple | negative | spam
  classification_confidence REAL,
  status                 TEXT NOT NULL DEFAULT 'new',
                         -- new | auto_replied | awaiting_human | resolved | escalated | saved_as_idea
  reply_text             TEXT,
  replied_at             TEXT,
  conversation_id        INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
  external_id            TEXT,
  created_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- 6. ANALYTICS — one row per post per collection time
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS metrics (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id            INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  collected_at       TEXT NOT NULL DEFAULT (datetime('now')),
  views              INTEGER,
  reach              INTEGER,
  watch_time_seconds REAL,
  avg_watch_percent  REAL,
  completion_rate    REAL,
  likes              INTEGER,
  comments           INTEGER,
  shares             INTEGER,
  saves              INTEGER,
  followers_gained   INTEGER,
  profile_visits     INTEGER,
  link_clicks        INTEGER,
  leads              INTEGER,
  revenue            REAL
);

-- Insights: findings from analytics, fed back into the Content Engine.
-- dimension = hook_style | format | length | pillar | cta | posting_time | platform | topic
CREATE TABLE IF NOT EXISTS insights (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  content_item_id  INTEGER REFERENCES content_items(id) ON DELETE SET NULL,
  claim            TEXT NOT NULL,          -- e.g. "problem-statement hooks have 2.3x retention"
  dimension        TEXT,
  dimension_value  TEXT,
  metric           TEXT,                   -- retention | completion | engagement | follows | clicks | leads | revenue
  effect           TEXT,                   -- up | down | flat
  magnitude        REAL,
  confidence       REAL,
  status           TEXT NOT NULL DEFAULT 'proposed',  -- proposed | accepted | rejected
  evidence_count   INTEGER NOT NULL DEFAULT 0,        -- how many posts support this
  last_confirmed_at TEXT,                  -- when it was last validated
  source           TEXT,                   -- analysis id / engine run / manual
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Playbook rules: accepted, actionable knowledge the Content Engine queries.
-- One insight can produce multiple rules (per platform/format/pillar).
CREATE TABLE IF NOT EXISTS playbook_rules (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  insight_id       INTEGER REFERENCES insights(id) ON DELETE SET NULL,
  rule             TEXT NOT NULL,          -- actionable statement, e.g. "use question hooks for pricing topics on TikTok short-form"
  dimension        TEXT,                   -- hook_style | format | length | pillar | cta | posting_time | platform | topic
  dimension_value  TEXT,
  metric           TEXT,                   -- retention | completion | engagement | follows | clicks | leads | revenue
  effect           TEXT,                   -- up | down | flat
  magnitude        REAL,
  confidence       REAL,
  applicability    TEXT,                   -- JSON: { platforms: [], pillars: [], formats: [] }
  status           TEXT NOT NULL DEFAULT 'active',  -- active | retired
  evidence_count   INTEGER NOT NULL DEFAULT 0,
  last_confirmed_at TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- 7. CONTENT LINKS — typed relationships between content items
--    follow_up | reuse_research | reuse_asset | series_part | remix | split_from | inspired_by
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS content_links (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  content_item_id INTEGER NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  linked_item_id  INTEGER NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  link_type       TEXT NOT NULL DEFAULT 'follow_up',
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (content_item_id, linked_item_id, link_type)
);

-- ---------------------------------------------------------------------------
-- 8. CALENDAR — the planning layer: shoot sessions, publish slots, review slots
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS calendar_entries (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  date            TEXT NOT NULL,           -- ISO 8601 date (UTC)
  kind            TEXT NOT NULL,           -- shoot_session | publish | review
  platform        TEXT,                    -- for publish entries
  content_item_id INTEGER REFERENCES content_items(id) ON DELETE SET NULL,
  post_id         INTEGER REFERENCES posts(id) ON DELETE SET NULL,
  session_id      INTEGER REFERENCES recording_sessions(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'planned',  -- planned | filled | published | missed | done
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- 9. HUMAN GATES — the four non-negotiable decision points
--    idea_approval | script_review | asset_review | escalation
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gates (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  gate_type      TEXT NOT NULL,            -- idea_approval | script_review | plan_review | asset_review | escalation
  target_type    TEXT NOT NULL,            -- content_item | asset | engagement_item
  target_id      INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  requested_by   TEXT DEFAULT 'engine',
  requested_note TEXT,
  decided_by     TEXT,
  decision_notes TEXT,
  decided_at     TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- 10. ENGINE LOGS — execution trail for every engine run
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS engine_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  engine      TEXT NOT NULL,               -- content | production | distribution | engagement | analytics
  action      TEXT NOT NULL,
  target_type TEXT,
  target_id   INTEGER,
  status      TEXT NOT NULL,               -- success | error | skipped
  message     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- 11. SETTINGS — brand / authority / cadence profile (the "who we are" store)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,                -- JSON
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- NOTE: indexes live in indexes.sql and are applied AFTER migrations,
-- because v1 -> v2 adds columns (e.g. content_items.session_id) that
-- existing databases do not have yet when schema.sql runs.