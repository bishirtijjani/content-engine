-- Indexes for the hot paths (state queries, platform queues, gate lookups).
-- Applied AFTER migrations (see db.js initDb): v1 -> v2 adds columns such as
-- content_items.session_id, so indexes referencing them must not run before
-- the migration has added those columns to existing databases.
CREATE INDEX IF NOT EXISTS idx_content_status       ON content_items(status);
CREATE INDEX IF NOT EXISTS idx_content_series       ON content_items(series);
CREATE INDEX IF NOT EXISTS idx_content_session      ON content_items(session_id);
CREATE INDEX IF NOT EXISTS idx_history_item         ON content_item_history(content_item_id);
CREATE INDEX IF NOT EXISTS idx_recordings_session   ON recordings(session_id);
CREATE INDEX IF NOT EXISTS idx_cir_item             ON content_item_recordings(content_item_id);
CREATE INDEX IF NOT EXISTS idx_cir_recording        ON content_item_recordings(recording_id);
CREATE INDEX IF NOT EXISTS idx_links_item           ON content_links(content_item_id);
CREATE INDEX IF NOT EXISTS idx_assets_item          ON assets(content_item_id);
CREATE INDEX IF NOT EXISTS idx_posts_item           ON posts(content_item_id);
CREATE INDEX IF NOT EXISTS idx_posts_platform_status ON posts(platform, status);
-- One post per item per platform per account. This is what makes adapt
-- idempotent at the database level, including two accounts on one platform.
CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_item_platform_account
  ON posts(content_item_id, platform, account);
CREATE INDEX IF NOT EXISTS idx_engagement_status    ON engagement_items(status);
CREATE INDEX IF NOT EXISTS idx_engagement_conv      ON engagement_items(conversation_id);
CREATE INDEX IF NOT EXISTS idx_metrics_post         ON metrics(post_id);
CREATE INDEX IF NOT EXISTS idx_insights_status      ON insights(status);
CREATE INDEX IF NOT EXISTS idx_playbook_status      ON playbook_rules(status);
CREATE INDEX IF NOT EXISTS idx_calendar_date        ON calendar_entries(date);
CREATE INDEX IF NOT EXISTS idx_gates_status         ON gates(status);
CREATE INDEX IF NOT EXISTS idx_gates_target         ON gates(target_type, target_id, status);