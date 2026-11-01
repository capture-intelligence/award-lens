-- Pipelines + Pursuits: the per-user BD capture board. A pipeline is a named
-- board; a pursuit is a card on it, optionally linked to an entity (award,
-- opportunity, awardee…) and moving across capture stages. Additive — new
-- tables only; user_id references app_user. Every query is scoped by user_id.
CREATE TABLE IF NOT EXISTS pipeline (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pipeline_user ON pipeline(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS pursuit (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  pipeline_id TEXT NOT NULL,
  entity_type TEXT,
  entity_id   TEXT,
  title       TEXT NOT NULL,
  stage       TEXT NOT NULL DEFAULT 'identified',
  notes       TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pursuit_pipeline ON pursuit(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_pursuit_user ON pursuit(user_id);
