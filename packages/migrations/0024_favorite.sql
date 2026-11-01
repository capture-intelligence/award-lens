-- Favorites: per-user bookmarks of any entity (opportunity, award, awardee,
-- agency, document…). Additive — new table only; user_id references app_user.
-- The unique index makes "favorite" idempotent per (user, entity).
CREATE TABLE IF NOT EXISTS favorite (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_favorite_uniq ON favorite(user_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_favorite_user ON favorite(user_id, created_at DESC);
