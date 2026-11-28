-- Allow the verified main administrator to delete Gallery objects only.
-- Existing own-folder storage permissions and all non-Gallery media remain unchanged.
set local lock_timeout = '8s';
set local statement_timeout = '25s';

do $guard$
begin
  if not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='storage' and c.relname='objects' and c.relrowsecurity
  ) then
    raise exception 'Storage RLS is not enabled; refusing Gallery admin delete policy';
  end if;

  if not exists (
    select 1 from storage.buckets
    where id='community-media' and public=true and file_size_limit=8388608
  ) then
    raise exception 'Expected community-media bucket settings changed';
  end if;

  if not (
    has_table_privilege('authenticated','storage.objects','SELECT')
    and has_table_privilege('authenticated','storage.objects','DELETE')
  ) then
    raise exception 'Authenticated Storage grants differ from expected';
  end if;

  if to_regprocedure('public.admin_delete_moderation_content(text,text)') is null then
    raise exception 'Protected Gallery moderation delete RPC is missing';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects'
      and policyname='neis_community_media_select_own_v1'
  ) or not exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects'
      and policyname='neis_community_media_delete_own_v1'
  ) then
    raise exception 'Existing own-folder Storage policies changed; review required';
  end if;
end
$guard$;

create or replace function public.neis_main_admin_gallery_delete_allowed()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $function$
  select auth.uid() is not null
    and auth.role() = 'authenticated'
    and exists (
      select 1
      from auth.users u
      join public.profiles p on p.id=u.id
      where u.id=auth.uid()
        and u.id='25b556a3-ec6f-49e7-ac6c-1b09720e3bfd'::uuid
        and lower(coalesce(u.email,''))='mreyadishere@gmail.com'
        and p.role='admin'
        and coalesce(p.account_status,'active')='active'
        and u.deleted_at is null
    );
$function$;

revoke all on function public.neis_main_admin_gallery_delete_allowed()
  from public, anon;
grant execute on function public.neis_main_admin_gallery_delete_allowed()
  to authenticated;

do $policies$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects'
      and policyname='neis_community_media_select_main_admin_gallery_v1'
  ) then
    create policy neis_community_media_select_main_admin_gallery_v1
      on storage.objects as permissive for select to authenticated
      using (
        bucket_id='community-media'
        and name like '%/gallery/%'
        and public.neis_main_admin_gallery_delete_allowed()
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects'
      and policyname='neis_community_media_delete_main_admin_gallery_v1'
  ) then
    create policy neis_community_media_delete_main_admin_gallery_v1
      on storage.objects as permissive for delete to authenticated
      using (
        bucket_id='community-media'
        and name like '%/gallery/%'
        and public.neis_main_admin_gallery_delete_allowed()
      );
  end if;
end
$policies$;

do $verify$
declare
  policies_found integer;
begin
  select count(*) into policies_found
  from pg_policies
  where schemaname='storage' and tablename='objects'
    and policyname in (
      'neis_community_media_select_main_admin_gallery_v1',
      'neis_community_media_delete_main_admin_gallery_v1'
    )
    and coalesce(qual,'') like '%community-media%'
    and coalesce(qual,'') like '%/gallery/%'
    and coalesce(qual,'') like '%neis_main_admin_gallery_delete_allowed%';

  if policies_found<>2 then
    raise exception 'Main admin Gallery Storage policies failed verification';
  end if;
end
$verify$;
