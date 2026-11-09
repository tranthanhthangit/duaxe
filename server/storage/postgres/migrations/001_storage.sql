-- PostgreSQL 15+. Applied explicitly by an operator, never by the web process.
CREATE SCHEMA IF NOT EXISTS duaxe;
REVOKE ALL ON SCHEMA duaxe FROM PUBLIC;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='duaxe_runtime') THEN
  CREATE ROLE duaxe_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='duaxe_runtime' AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'Runtime role must not bypass RLS'; END IF;
END $$;
CREATE TABLE duaxe.teachers(id uuid PRIMARY KEY,email text NOT NULL UNIQUE,password text NOT NULL,created_at timestamptz NOT NULL);
CREATE TABLE duaxe.sessions(token_hash text PRIMARY KEY CHECK(token_hash ~ '^[a-f0-9]{64}$'),teacher_id uuid NOT NULL REFERENCES duaxe.teachers ON DELETE CASCADE,expires_at bigint NOT NULL);
CREATE TABLE duaxe.classes(id uuid PRIMARY KEY,owner_id uuid NOT NULL REFERENCES duaxe.teachers,name text NOT NULL,school_year text NOT NULL DEFAULT '',created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL,UNIQUE(id,owner_id));
CREATE INDEX classes_owner ON duaxe.classes(owner_id);
CREATE TABLE duaxe.avatars(id uuid PRIMARY KEY,owner_id uuid NOT NULL REFERENCES duaxe.teachers,storage_key text NOT NULL UNIQUE CHECK(storage_key ~ '^[a-f0-9-]+\.webp$'),mime_type text NOT NULL CHECK(mime_type='image/webp'),file_size integer NOT NULL CHECK(file_size>0),created_at timestamptz NOT NULL,local_owned boolean NOT NULL DEFAULT false,UNIQUE(id,owner_id));
CREATE TABLE duaxe.students(id uuid PRIMARY KEY,owner_id uuid NOT NULL,class_id uuid NOT NULL,full_name text NOT NULL,display_name text NOT NULL,avatar_id uuid,status text NOT NULL CHECK(status IN ('active','inactive')),created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL,
 FOREIGN KEY(class_id,owner_id) REFERENCES duaxe.classes(id,owner_id) ON DELETE CASCADE,
 FOREIGN KEY(avatar_id,owner_id) REFERENCES duaxe.avatars(id,owner_id) ON DELETE SET NULL (avatar_id));
CREATE INDEX students_class ON duaxe.students(class_id);
-- Historical class/student IDs deliberately remain snapshots, not live foreign keys.
CREATE TABLE duaxe.race_sessions(code text PRIMARY KEY CHECK(code ~ '^[A-HJ-NP-Z2-9]{6}$'),owner_id uuid REFERENCES duaxe.teachers,class_id uuid,status text NOT NULL CHECK(status IN ('ready','running','paused','finished','expired','corrupt')),created_at bigint NOT NULL,started_at bigint,finished_at bigint,updated_at bigint NOT NULL,checkpoint_version integer NOT NULL CHECK(checkpoint_version=1),sequence bigint NOT NULL CHECK(sequence>=0),checkpoint jsonb NOT NULL,report jsonb NOT NULL,error text);
CREATE INDEX race_sessions_owner_date ON duaxe.race_sessions(owner_id,created_at DESC);
CREATE TABLE duaxe.room_questions(room_code text NOT NULL REFERENCES duaxe.race_sessions ON DELETE CASCADE,question_id text NOT NULL,position integer NOT NULL CHECK(position>=0),question jsonb NOT NULL,PRIMARY KEY(room_code,question_id),UNIQUE(room_code,position));
CREATE TABLE duaxe.race_players(room_code text NOT NULL REFERENCES duaxe.race_sessions ON DELETE CASCADE,player_id uuid NOT NULL,student_id uuid,digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),state jsonb NOT NULL,PRIMARY KEY(room_code,player_id),UNIQUE(room_code,student_id));
CREATE TABLE duaxe.race_answers(room_code text NOT NULL,player_id uuid NOT NULL,question_id text NOT NULL,result jsonb NOT NULL,PRIMARY KEY(room_code,player_id,question_id),FOREIGN KEY(room_code,player_id) REFERENCES duaxe.race_players ON DELETE CASCADE,FOREIGN KEY(room_code,question_id) REFERENCES duaxe.room_questions ON DELETE CASCADE);
CREATE TABLE duaxe.command_receipts(room_code text NOT NULL REFERENCES duaxe.race_sessions ON DELETE CASCADE,role text NOT NULL CHECK(role IN ('teacher','student')),actor_id text NOT NULL,command_id text NOT NULL,signature text NOT NULL,data jsonb NOT NULL,PRIMARY KEY(room_code,role,actor_id,command_id));
CREATE TABLE duaxe.runtime_owner(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),owner_id uuid,epoch bigint NOT NULL DEFAULT 0);
INSERT INTO duaxe.runtime_owner(singleton) VALUES(true);
CREATE TABLE duaxe.migration_batches(id uuid PRIMARY KEY,source_checksum text NOT NULL,manifest jsonb NOT NULL,status text NOT NULL CHECK(status IN ('applied','rolled_back')),created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE duaxe.migration_items(batch_id uuid NOT NULL REFERENCES duaxe.migration_batches,table_name text NOT NULL,row_key text NOT NULL,row_checksum text NOT NULL,PRIMARY KEY(batch_id,table_name,row_key));
-- Private schema + default-deny browser roles. Runtime role intentionally spans tenants:
-- every backend method MUST still check ownership. Auth/RLS mapping for students is 9B.2.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['teachers','sessions','classes','avatars','students','race_sessions','room_questions','race_players','race_answers','command_receipts','runtime_owner','migration_batches','migration_items'] LOOP
  EXECUTE format('ALTER TABLE duaxe.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE duaxe.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY backend ON duaxe.%I TO duaxe_runtime USING (true) WITH CHECK (true)',t);
 END LOOP;
END $$;
GRANT USAGE ON SCHEMA duaxe TO duaxe_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA duaxe TO duaxe_runtime;
REVOKE ALL ON ALL TABLES IN SCHEMA duaxe FROM PUBLIC;
