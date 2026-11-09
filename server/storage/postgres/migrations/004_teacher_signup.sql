-- Explicit operator migration. Existing teacher/auth IDs and hashes are unchanged.
-- Reject a legacy case/space collision instead of silently merging accounts.
CREATE UNIQUE INDEX teachers_normalized_email ON duaxe.teachers(lower(btrim(email)));
CREATE TABLE duaxe.teacher_profiles(
 teacher_id uuid PRIMARY KEY REFERENCES duaxe.teachers(id) ON DELETE CASCADE,
 full_name text NOT NULL CHECK(char_length(full_name) BETWEEN 2 AND 100),
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE duaxe.teacher_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE duaxe.teacher_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY backend ON duaxe.teacher_profiles TO duaxe_runtime USING(true) WITH CHECK(true);
GRANT SELECT,INSERT ON duaxe.teacher_profiles TO duaxe_runtime;
GRANT INSERT ON duaxe.teacher_auth_links TO duaxe_runtime;
REVOKE ALL ON duaxe.teacher_profiles FROM PUBLIC;
-- No browser/Data API policy. Backend derives all ownership from verified Auth UUID.
