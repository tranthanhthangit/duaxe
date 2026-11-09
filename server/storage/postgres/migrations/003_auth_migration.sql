-- Additive session cutoff + operator journal. No passwords, JWT or reset links.
CREATE TABLE duaxe.teacher_auth_cutoffs(
 auth_user_id uuid PRIMARY KEY REFERENCES duaxe.teacher_auth_links(auth_user_id),
 valid_after bigint NOT NULL CHECK(valid_after>=0)
);
ALTER TABLE duaxe.teacher_auth_cutoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE duaxe.teacher_auth_cutoffs FORCE ROW LEVEL SECURITY;
CREATE POLICY backend ON duaxe.teacher_auth_cutoffs TO duaxe_runtime USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE ON duaxe.teacher_auth_cutoffs TO duaxe_runtime;
REVOKE ALL ON duaxe.teacher_auth_cutoffs FROM PUBLIC;
CREATE TABLE duaxe.auth_migration_batches(
 id uuid PRIMARY KEY,manifest_checksum text NOT NULL CHECK(manifest_checksum ~ '^[a-f0-9]{64}$'),
 status text NOT NULL CHECK(status IN ('prepared','rolled_back')),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE duaxe.auth_migration_items(
 batch_id uuid NOT NULL REFERENCES duaxe.auth_migration_batches,
 teacher_id uuid NOT NULL REFERENCES duaxe.teachers,
 email_digest text NOT NULL CHECK(email_digest ~ '^[a-f0-9]{64}$'),auth_user_id uuid,
 owned boolean NOT NULL DEFAULT false,mapping_created boolean NOT NULL DEFAULT false,
 invite_requested_at timestamptz,
 state text NOT NULL CHECK(state IN ('planned','created','linked','rolled_back')),
 updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(batch_id,teacher_id),
 UNIQUE(batch_id,auth_user_id)
);
ALTER TABLE duaxe.auth_migration_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE duaxe.auth_migration_batches FORCE ROW LEVEL SECURITY;
ALTER TABLE duaxe.auth_migration_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE duaxe.auth_migration_items FORCE ROW LEVEL SECURITY;
REVOKE ALL ON duaxe.auth_migration_batches,duaxe.auth_migration_items FROM PUBLIC,duaxe_runtime;
-- No policies/grants for runtime or Data API roles. Explicit operator only.
