-- =================================================================
-- Authentication & access control (Google + Microsoft OAuth)
-- Approval workflow: 'pending' → 'user' | 'admin' | 'rejected'
-- =================================================================

CREATE TABLE app_user (
    user_id        TEXT PRIMARY KEY,                -- random UUID
    email          TEXT NOT NULL,                   -- lowercase
    display_name   TEXT,
    avatar_url     TEXT,
    provider       TEXT NOT NULL,                   -- 'google' | 'microsoft'
    provider_sub   TEXT NOT NULL,                   -- subject id from OIDC token
    role           TEXT NOT NULL DEFAULT 'pending'
        CHECK (role IN ('pending','user','admin','rejected')),
    approved_by    TEXT REFERENCES app_user(user_id),
    approved_at    TEXT,
    rejected_at    TEXT,
    last_login_at  TEXT,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL,
    UNIQUE (provider, provider_sub),
    UNIQUE (email)
);

CREATE INDEX idx_user_role  ON app_user(role);
CREATE INDEX idx_user_email ON app_user(email);

CREATE TABLE app_session (
    session_id   TEXT PRIMARY KEY,                  -- 32 random bytes hex
    user_id      TEXT NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
    expires_at   TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    user_agent   TEXT,
    ip           TEXT,
    last_seen_at TEXT
);

CREATE INDEX idx_session_user ON app_session(user_id);
CREATE INDEX idx_session_exp  ON app_session(expires_at);

-- Audit trail of approval / role changes
CREATE TABLE app_user_audit (
    audit_id     INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      TEXT NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
    actor_id     TEXT REFERENCES app_user(user_id),
    action       TEXT NOT NULL,                     -- 'created','approved','rejected','role_changed','reset'
    from_role    TEXT,
    to_role      TEXT,
    notes        TEXT,
    created_at   TEXT NOT NULL
);

CREATE INDEX idx_audit_user ON app_user_audit(user_id, created_at DESC);
