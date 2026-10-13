-- NEIS Circle / OVH: restore secure user-owned community-media access.
-- The 2026-10-13 OVH read-only audit confirmed storage.objects RLS enabled,
-- authenticated role has INSERT/SELECT/DELETE grants, but zero policies.
-- Existing media paths are {auth.user.id}/{folder}/{file}; public downloads
-- continue through the public bucket, without adding anonymous listing access.
-- Changes to auth, existing objects, size limits and bucket visibility: NONE.
BEGIN;
SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '25s';

DO $guard$
DECLARE n_policies integer;
BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='storage' AND c.relname='objects' AND c.relrowsecurity
 ) THEN
   RAISE EXCEPTION 'Storage RLS not enabled; refusing unsafe change';
 END IF;
 SELECT count(*) INTO n_policies FROM pg_policies
   WHERE schemaname='storage' AND tablename='objects';
 IF n_policies<>0 THEN
   RAISE EXCEPTION 'Storage policies changed; review before applying';
 END IF;
 IF NOT EXISTS (
   SELECT 1 FROM storage.buckets WHERE id='community-media'
     AND public=true AND file_size_limit=8388608
     AND (allowed_mime_types IS NULL OR 'image/webp'=ANY(allowed_mime_types))
 ) THEN
   RAISE EXCEPTION 'Expected community-media bucket settings changed';
 END IF;
 IF NOT (has_schema_privilege('authenticated','storage','USAGE')
   AND has_table_privilege('authenticated','storage.objects','INSERT')
   AND has_table_privilege('authenticated','storage.objects','SELECT')
   AND has_table_privilege('authenticated','storage.objects','DELETE')) THEN
   RAISE EXCEPTION 'Authenticated role grants differ';
 END IF;
END $guard$;

-- Insert only under the JWT user's own first-level UUID folder.
CREATE POLICY neis_community_media_insert_own_v1
  ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id='community-media'
    AND split_part(name,'/',1) = (select auth.uid()::text)
  );

-- SELECT is limited to own metadata (needed by Storage API operations).
-- The bucket's existing public GET URL functionality is not changed.
CREATE POLICY neis_community_media_select_own_v1
  ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    bucket_id='community-media'
    AND split_part(name,'/',1) = (select auth.uid()::text)
  );

-- Allow users to undo failed uploads within their own folder, never others'.
CREATE POLICY neis_community_media_delete_own_v1
  ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated
  USING (
    bucket_id='community-media'
    AND split_part(name,'/',1) = (select auth.uid()::text)
  );

-- Transaction-local RLS integration test. This temporary metadata row is
-- always rolled back, even if the policy is committed successfully.
SAVEPOINT neis_probe;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',
    '00000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);

DO $validate$
BEGIN
 IF auth.uid() IS DISTINCT FROM '00000000-0000-4000-8000-000000000001'::uuid THEN
   RAISE EXCEPTION 'JWT identity policy probe failed';
 END IF;
END $validate$;

INSERT INTO storage.objects (bucket_id,name)
 VALUES ('community-media',
   '00000000-0000-4000-8000-000000000001/posts/.neis-rls-rollback-probe-20261013.webp');

DO $test$
DECLARE blocked boolean := false;
BEGIN
  -- Different user folder MUST be denied by RLS. This must raise 42501.
  BEGIN
    INSERT INTO storage.objects (bucket_id,name)
      VALUES ('community-media',
       '00000000-0000-4000-8000-000000000002/posts/.neis-rls-foreign-probe-20261013.webp');
  EXCEPTION WHEN insufficient_privilege THEN
    blocked := true;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'SECURITY FAILURE: cross-user upload was not rejected';
  END IF;
END $test$;

ROLLBACK TO SAVEPOINT neis_probe;

DO $postcheck$
BEGIN
 IF (SELECT count(*) FROM pg_policies
      WHERE schemaname='storage' AND tablename='objects'
        AND policyname IN (
          'neis_community_media_insert_own_v1',
          'neis_community_media_select_own_v1',
          'neis_community_media_delete_own_v1'))<>3 THEN
   RAISE EXCEPTION 'Policy verification did not find 3 expected policies';
 END IF;
END $postcheck$;
COMMIT;
