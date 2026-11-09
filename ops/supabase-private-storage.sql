BEGIN;
-- REVIEW/EXPLICIT APPROVAL REQUIRED. Run only on the selected Supabase project.
-- Default bucket name; if configured differently, review BOTH literals first.
-- Bucket creation is an operator action; backend refuses a public bucket.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('student-avatars','student-avatars',false,2097152,ARRAY['image/webp'])
ON CONFLICT(id) DO NOTHING;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM storage.buckets WHERE id='student-avatars' AND public=false) THEN
  RAISE EXCEPTION 'Existing bucket must be private; do not silently change it';
 END IF;
END $$;
-- Restrictive policies override unrelated permissive policies for this bucket.
-- Other buckets retain their existing policies. Server service-role bypasses RLS;
-- therefore owner/room authorization MUST remain in the Node backend.
DROP POLICY IF EXISTS duaxe_avatar_browser_deny ON storage.objects;
CREATE POLICY duaxe_avatar_browser_deny ON storage.objects AS RESTRICTIVE FOR ALL
TO anon,authenticated USING(bucket_id<>'student-avatars') WITH CHECK(bucket_id<>'student-avatars');

COMMIT;
