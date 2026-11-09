-- Additive only: keep all existing teacher/class/student/player IDs and SQLite source.
CREATE TABLE duaxe.teacher_auth_links(
 auth_user_id uuid PRIMARY KEY,teacher_id uuid NOT NULL UNIQUE REFERENCES duaxe.teachers(id),
 enabled boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE duaxe.room_invites(
 room_code text PRIMARY KEY REFERENCES duaxe.race_sessions(code) ON DELETE CASCADE,
 token_hash text NOT NULL CHECK(token_hash ~ '^[a-f0-9]{64}$'),expires_at bigint NOT NULL
);
CREATE TABLE duaxe.teacher_auth_revocations(
 session_id uuid PRIMARY KEY,revoked_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE duaxe.teacher_auth_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE duaxe.teacher_auth_links FORCE ROW LEVEL SECURITY;
ALTER TABLE duaxe.room_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE duaxe.room_invites FORCE ROW LEVEL SECURITY;
ALTER TABLE duaxe.teacher_auth_revocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE duaxe.teacher_auth_revocations FORCE ROW LEVEL SECURITY;
CREATE POLICY backend ON duaxe.teacher_auth_links TO duaxe_runtime USING(true) WITH CHECK(true);
CREATE POLICY backend ON duaxe.room_invites TO duaxe_runtime USING(true) WITH CHECK(true);
CREATE POLICY backend ON duaxe.teacher_auth_revocations TO duaxe_runtime USING(true) WITH CHECK(true);
GRANT SELECT ON duaxe.teacher_auth_links TO duaxe_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON duaxe.room_invites TO duaxe_runtime;
GRANT SELECT,INSERT ON duaxe.teacher_auth_revocations TO duaxe_runtime;
REVOKE ALL ON duaxe.teacher_auth_links,duaxe.room_invites FROM PUBLIC;
REVOKE ALL ON duaxe.teacher_auth_revocations FROM PUBLIC;
-- No Data API/browser access. Auth mapping is an operator-only grant, not self signup.
-- No FK to auth.users: portable local PG tests; operator verifies user with Auth Admin API.
