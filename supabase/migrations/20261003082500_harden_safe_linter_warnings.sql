-- Safe security-linter hardening that does not change application authorization.
alter function public.try_uuid(text) set search_path = public, pg_temp;
alter function public.try_bigint(text) set search_path = public, pg_temp;
alter function public.neis_poll_is_closed(public.circle_polls) set search_path = public, pg_temp;

-- community-media is a public bucket, so public object URLs do not require a
-- broad SELECT policy that also permits listing every object in the bucket.
drop policy if exists "public reads community media" on storage.objects;
