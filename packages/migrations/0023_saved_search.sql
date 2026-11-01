-- Saved searches: per-user named filter sets for the list views (a core BD
-- workflow feature). Additive — new table only; user_id references app_user.
-- query_json holds the serialized filter/query state the list page applies.
CREATE TABLE IF NOT EXISTS saved_search (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  name        TEXT NOT NULL,
  entity      TEXT NOT NULL,
  query_json  TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_saved_search_user ON saved_search(user_id, created_at DESC);
