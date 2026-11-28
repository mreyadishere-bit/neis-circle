-- Primary-admin-only live total for physical Gallery uploads in self-hosted Supabase Storage.
-- Photograph and Art are measured together from actual Storage object metadata.
begin;
create or replace function public.main_admin_gallery_storage()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $function$
declare
  total_bytes bigint := 0;
  object_count bigint := 0;
  measured_count bigint := 0;
  unmeasured_count bigint := 0;
begin
  if auth.uid() is null
     or auth.role() <> 'authenticated'
     or not exists (
       select 1
       from auth.users u
       join public.profiles p on p.id = u.id
       where u.id = auth.uid()
         and u.id = '25b556a3-ec6f-49e7-ac6c-1b09720e3bfd'::uuid
         and lower(coalesce(u.email, '')) = 'mreyadishere@gmail.com'
         and p.role = 'admin'
         and coalesce(p.account_status, 'active') = 'active'
         and u.deleted_at is null
     ) then
    raise exception 'Main admin only' using errcode = '42501';
  end if;

  -- Existing uploader path: <user-id>/gallery/<file-name>.
  -- Count real Storage objects, not gallery_items rows or PostgreSQL table sizes.
  select
    count(*),
    coalesce(sum(
      case
        when coalesce(o.metadata->>'size', '') ~ '^[0-9]{1,18}$'
          then (o.metadata->>'size')::bigint
        else 0
      end
    ), 0)::bigint,
    count(*) filter (
      where coalesce(o.metadata->>'size', '') ~ '^[0-9]{1,18}$'
    ),
    count(*) filter (
      where not (coalesce(o.metadata->>'size', '') ~ '^[0-9]{1,18}$')
    )
  into object_count, total_bytes, measured_count, unmeasured_count
  from storage.objects o
  where o.bucket_id = 'community-media'
    and o.name like '%/gallery/%';

  return jsonb_build_object(
    'total_bytes', total_bytes,
    'object_count', object_count,
    'measured_object_count', measured_count,
    'unmeasured_object_count', unmeasured_count,
    'checked_at', now()
  );
end;
$function$;

revoke all on function public.main_admin_gallery_storage()
  from PUBLIC, anon, authenticated;
grant execute on function public.main_admin_gallery_storage()
  to authenticated;
commit;
notify pgrst, 'reload schema';
