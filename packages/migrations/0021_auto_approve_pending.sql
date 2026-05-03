-- Auto-approve all currently-pending users.
--
-- Product policy change: sign-in alone is enough to be a 'user'; admin
-- approval is no longer a gate. New sign-ins land as 'user' (see
-- workers/api/src/auth/routes.ts). This migration pulls any users
-- already sitting in the pending queue forward to the same state so
-- they're unblocked on next refresh.
--
-- Audit rows are written *before* the role flip so from_role still
-- reads 'pending'. Rejected users are intentionally left untouched —
-- that decision was explicit and should persist.

INSERT INTO app_user_audit (user_id, actor_id, action, from_role, to_role, notes, created_at)
SELECT user_id, NULL, 'approved', 'pending', 'user',
       'bulk auto-approval — pending gate retired',
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM   app_user
WHERE  role = 'pending';

UPDATE app_user
SET    role        = 'user',
       approved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
       updated_at  = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE  role = 'pending';
