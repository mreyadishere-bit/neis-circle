-- Super-admin privileges are separate from the existing profiles.role enum.
-- Only the original founder may promote/revoke. No client can write this table.
begin;
create table if not exists public.neis_super_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now()
);
revoke all on public.neis_super_admins from public,anon,authenticated;

create table if not exists public.neis_account_deletion_audit (
  id bigint generated always as identity primary key,
  actor_id uuid,
  target_id uuid not null,
  deleted_at timestamptz not null default now()
);
revoke all on public.neis_account_deletion_audit from public,anon,authenticated;

create or replace function public.neis_admin_is_owner()
returns boolean language sql stable security definer
set search_path=pg_catalog,public,auth as $$
select exists(
 select 1 from auth.users u join public.profiles p on p.id=u.id
 where u.id=auth.uid()
 and u.id='25b556a3-ec6f-49e7-ac6c-1b09720e3bfd'::uuid
 and lower(u.email)='mreyadishere@gmail.com'
 and u.deleted_at is null
 and p.role='admin' and coalesce(p.account_status,'active')='active'
);
$$;
create or replace function public.neis_admin_is_super()
returns boolean language sql stable security definer
set search_path=pg_catalog,public,auth as $$
select public.neis_admin_is_owner() or exists(
 select 1 from public.neis_super_admins s
 join auth.users u on u.id=s.user_id
 join public.profiles p on p.id=u.id
 where s.user_id=auth.uid() and u.deleted_at is null
 and p.role='admin' and coalesce(p.account_status,'active')='active'
);
$$;

create or replace function public.neis_admin_capabilities()
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,public,auth as $$
begin
 return jsonb_build_object('owner',public.neis_admin_is_owner(),
                          'super_admin',public.neis_admin_is_super());
end;$$;

create or replace function public.neis_admin_users(p_search text default '')
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,public,auth as $$
declare result jsonb;
begin
 if not public.neis_admin_is_super() then raise exception 'Not authorized' using errcode='42501'; end if;
 select coalesce(jsonb_agg(to_jsonb(t) order by t.full_name,t.user_id),'[]'::jsonb)
 into result from (
 select u.id user_id,coalesce(p.full_name,'') full_name,
   coalesce(p.username,'') username,p.role,
   (u.id='25b556a3-ec6f-49e7-ac6c-1b09720e3bfd'::uuid) is_owner,
   exists(select 1 from public.neis_super_admins s where s.user_id=u.id) is_super
 from auth.users u join public.profiles p on p.id=u.id
 where u.deleted_at is null and (
  btrim(coalesce(p_search,''))='' or
  p.full_name ilike '%'||left(btrim(p_search),80)||'%' or
  p.username ilike '%'||left(btrim(p_search),80)||'%')
 order by p.full_name,u.id limit 80
 ) t;
 return result;
end;$$;

create or replace function public.neis_admin_set_super(
 p_user_id uuid,p_enabled boolean
) returns boolean language plpgsql volatile security definer
set search_path=pg_catalog,public,auth as $$
begin
 if not public.neis_admin_is_owner() then
  raise exception 'Only main admin may grant super admin' using errcode='42501';
 end if;
 if p_user_id is null or p_enabled is null or
    p_user_id='25b556a3-ec6f-49e7-ac6c-1b09720e3bfd'::uuid then
  raise exception 'Protected or invalid account' using errcode='42501';
 end if;
 if not exists(select 1 from auth.users u join public.profiles p on p.id=u.id
  where u.id=p_user_id and u.deleted_at is null
    and coalesce(p.account_status,'active')='active') then
  raise exception 'Active account not found' using errcode='P0002';
 end if;
 if p_enabled then
  update public.profiles set role='admin' where id=p_user_id;
  insert into public.neis_super_admins(user_id,granted_by)
  values(p_user_id,auth.uid()) on conflict(user_id) do nothing;
 else
  delete from public.neis_super_admins where user_id=p_user_id;
 end if;
 return true;
end;$$;

create or replace function public.neis_admin_set_regular_admin(
 p_user_id uuid,p_make_admin boolean
) returns boolean language plpgsql volatile security definer
set search_path=pg_catalog,public,auth as $
begin
 if not public.neis_admin_is_super() then
  raise exception 'Super admin required' using errcode='42501';
 end if;
 if p_user_id is null or p_make_admin is null or
    p_user_id='25b556a3-ec6f-49e7-ac6c-1b09720e3bfd'::uuid or
    p_user_id=auth.uid() or
    exists(select 1 from public.neis_super_admins where user_id=p_user_id)
 then raise exception 'Protected account' using errcode='42501'; end if;
 if not exists(select 1 from auth.users u join public.profiles p on p.id=u.id
  where u.id=p_user_id and u.deleted_at is null) then
  raise exception 'Account not found' using errcode='P0002'; end if;
 if p_make_admin then
  update public.profiles set role='admin' where id=p_user_id;
 else
  update public.profiles set role='student' where id=p_user_id;
 end if;
 return true;
end;$;

create or replace function public.neis_admin_delete_account(
 p_user_id uuid,p_confirmation text
) returns boolean language plpgsql volatile security definer
set search_path=pg_catalog,public,auth as $$
declare actor uuid:=auth.uid();
begin
 if not public.neis_admin_is_super() then
  raise exception 'Only super admins may delete accounts' using errcode='42501';
 end if;
 if p_user_id is null or p_user_id=actor or
    p_user_id='25b556a3-ec6f-49e7-ac6c-1b09720e3bfd'::uuid then
  raise exception 'Protected account' using errcode='42501';
 end if;
 if p_confirmation is distinct from 'DELETE '||p_user_id::text then
  raise exception 'Exact deletion confirmation required' using errcode='22023';
 end if;
 perform 1 from auth.users where id=p_user_id and deleted_at is null for update;
 if not found then raise exception 'Account not found' using errcode='P0002'; end if;
 -- A constrained FK will fail and roll back; never silently leave a half-deleted user.
 delete from auth.users where id=p_user_id;
 if not found then raise exception 'Account deletion failed' using errcode='P0002'; end if;
 insert into public.neis_account_deletion_audit(actor_id,target_id)
 values(actor,p_user_id);
 return true;
end;$$;

revoke all on function public.neis_admin_is_owner() from public,anon;
revoke all on function public.neis_admin_is_super() from public,anon;
revoke all on function public.neis_admin_capabilities() from public,anon;
revoke all on function public.neis_admin_users(text) from public,anon;
revoke all on function public.neis_admin_set_super(uuid,boolean) from public,anon;
revoke all on function public.neis_admin_delete_account(uuid,text) from public,anon;
revoke all on function public.neis_admin_set_regular_admin(uuid,boolean) from public,anon;
grant execute on function public.neis_admin_is_owner() to authenticated;
grant execute on function public.neis_admin_is_super() to authenticated;
grant execute on function public.neis_admin_capabilities() to authenticated;
grant execute on function public.neis_admin_users(text) to authenticated;
grant execute on function public.neis_admin_set_super(uuid,boolean) to authenticated;
grant execute on function public.neis_admin_delete_account(uuid,text) to authenticated;
grant execute on function public.neis_admin_set_regular_admin(uuid,boolean) to authenticated;
commit;
notify pgrst,'reload schema';
