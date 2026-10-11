-- OVH-only, read-only account management RPCs.
-- Only primary owner can view auth identity details. Never expose password hashes or tokens.
begin;

create or replace function public.main_admin_auth_overview()
returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, public, auth
as $fn$
declare stats jsonb;
begin
  if auth.uid() is null or not exists (
    select 1 from auth.users owner
    join public.profiles profile on profile.id=owner.id
    where owner.id=auth.uid()
      and owner.id='25b556a3-ec6f-49e7-ac6c-1b09720e3bfd'::uuid
      and lower(owner.email)='mreyadishere@gmail.com'
      and profile.role='admin'
      and coalesce(profile.account_status,'active')='active'
  ) then raise exception 'Not authorized' using errcode='42501'; end if;
  select jsonb_build_object(
    'total',count(*),
    'confirmed',count(*) filter (where u.email_confirmed_at is not null or u.confirmed_at is not null),
    'pending',count(*) filter (where u.email_confirmed_at is null and u.confirmed_at is null),
    'blocked',count(*) filter (where u.banned_until>now() or coalesce(p.account_status,'active')<>'active'),
    'signed_in_30d',count(*) filter (where u.last_sign_in_at>=now()-interval '30 days'),
    'new_7d',count(*) filter (where u.created_at>=now()-interval '7 days'),
    'profiles',count(p.id),
    'onboarded',count(*) filter (where p.onboarding_complete=true),
    'google',count(*) filter (where exists (select 1 from auth.identities i where i.user_id=u.id and i.provider='google'))
  ) into stats from auth.users u
    left join public.profiles p on p.id=u.id
    where u.deleted_at is null;
  return stats;
end;$fn$;

create or replace function public.main_admin_auth_users(
  p_search text default '',
  p_filter text default 'all',
  p_sort text default 'newest',
  p_limit integer default 20,
  p_offset integer default 0
)
returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, public, auth
as $fn$
declare
  search_text text := left(btrim(coalesce(p_search,'')),100);
  filter_text text := lower(coalesce(p_filter,'all'));
  sort_text text := lower(coalesce(p_sort,'newest'));
  safe_limit integer := least(50,greatest(1,coalesce(p_limit,20)));
  safe_offset integer := least(100000,greatest(0,coalesce(p_offset,0)));
  matched_total bigint;
  rows jsonb;
begin
  if auth.uid() is null or not exists (
    select 1 from auth.users owner
    join public.profiles profile on profile.id=owner.id
    where owner.id=auth.uid()
      and owner.id='25b556a3-ec6f-49e7-ac6c-1b09720e3bfd'::uuid
      and lower(owner.email)='mreyadishere@gmail.com'
      and profile.role='admin'
      and coalesce(profile.account_status,'active')='active'
  ) then raise exception 'Not authorized' using errcode='42501'; end if;

  if filter_text not in ('all','confirmed','pending','blocked','admins','no_profile','signed_in_30d')
    or sort_text not in ('newest','oldest','recent_login') then
    raise exception 'Unsupported filter or sort' using errcode='22023';
  end if;

  with matches as (
    select u.id from auth.users u
    left join public.profiles p on p.id=u.id
    where u.deleted_at is null
      and (search_text='' or u.email ilike '%'||search_text||'%' or
           p.full_name ilike '%'||search_text||'%' or
           p.username ilike '%'||search_text||'%' or
           u.id::text=search_text)
      and (
        filter_text='all'
        or (filter_text='confirmed' and (u.email_confirmed_at is not null or u.confirmed_at is not null))
        or (filter_text='pending' and u.email_confirmed_at is null and u.confirmed_at is null)
        or (filter_text='blocked' and (u.banned_until>now() or coalesce(p.account_status,'active')<>'active'))
        or (filter_text='admins' and p.role='admin')
        or (filter_text='no_profile' and p.id is null)
        or (filter_text='signed_in_30d' and u.last_sign_in_at>=now()-interval '30 days')
      )
  )
  select count(*) into matched_total from matches;

  select coalesce(jsonb_agg(to_jsonb(q) order by q.row_number),'[]'::jsonb) into rows
  from (
    select
      row_number() over (
        order by
          case when sort_text='oldest' then u.created_at end asc nulls last,
          case when sort_text='recent_login' then u.last_sign_in_at end desc nulls last,
          case when sort_text='newest' then u.created_at end desc nulls last,
          u.id desc) as row_number,
      u.id as user_id, u.email, u.created_at, u.last_sign_in_at,
      (u.email_confirmed_at is not null or u.confirmed_at is not null) as confirmed,
      (u.banned_until>now()) as banned,
      p.full_name,p.username,p.grade,p.branch,p.campus,
      p.role,p.account_status,p.onboarding_complete,
      (p.id is not null) as has_profile,
      exists(select 1 from auth.identities i where i.user_id=u.id and i.provider='google') as google_provider
    from auth.users u
    left join public.profiles p on p.id=u.id
    where u.deleted_at is null
      and (search_text='' or u.email ilike '%'||search_text||'%' or
           p.full_name ilike '%'||search_text||'%' or
           p.username ilike '%'||search_text||'%' or
           u.id::text=search_text)
      and (
        filter_text='all'
        or (filter_text='confirmed' and (u.email_confirmed_at is not null or u.confirmed_at is not null))
        or (filter_text='pending' and u.email_confirmed_at is null and u.confirmed_at is null)
        or (filter_text='blocked' and (u.banned_until>now() or coalesce(p.account_status,'active')<>'active'))
        or (filter_text='admins' and p.role='admin')
        or (filter_text='no_profile' and p.id is null)
        or (filter_text='signed_in_30d' and u.last_sign_in_at>=now()-interval '30 days')
      )
    order by
      case when sort_text='oldest' then u.created_at end asc nulls last,
      case when sort_text='recent_login' then u.last_sign_in_at end desc nulls last,
      case when sort_text='newest' then u.created_at end desc nulls last,
      u.id desc
    limit safe_limit offset safe_offset
  ) q;

  return jsonb_build_object('total',matched_total,'users',
    (select coalesce(jsonb_agg(q- 'row_number' order by (q->>'row_number')::bigint),'[]'::jsonb)
     from jsonb_array_elements(rows) q),
    'limit',safe_limit,'offset',safe_offset);
end;$fn$;

create or replace function public.main_admin_auth_user_detail(p_user_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, public, auth
as $fn$
declare result jsonb;
begin
  if auth.uid() is null or not exists (
    select 1 from auth.users owner
    join public.profiles profile on profile.id=owner.id
    where owner.id=auth.uid()
      and owner.id='25b556a3-ec6f-49e7-ac6c-1b09720e3bfd'::uuid
      and lower(owner.email)='mreyadishere@gmail.com'
      and profile.role='admin'
      and coalesce(profile.account_status,'active')='active'
  ) then raise exception 'Not authorized' using errcode='42501'; end if;

  select jsonb_build_object(
    'user_id',u.id,'email',u.email,'created_at',u.created_at,
    'last_sign_in_at',u.last_sign_in_at,'confirmed_at',coalesce(u.email_confirmed_at,u.confirmed_at),
    'banned_until',u.banned_until,'is_anonymous',u.is_anonymous,
    'providers',(select coalesce(jsonb_agg(distinct i.provider),'[]'::jsonb)
                 from auth.identities i where i.user_id=u.id),
    'profile',case when p.id is null then null else jsonb_build_object(
      'full_name',p.full_name,'username',p.username,'grade',p.grade,'branch',p.branch,
      'campus',p.campus,'graduation_year',p.graduation_year,'role',p.role,
      'account_status',p.account_status,'onboarding_complete',p.onboarding_complete,
      'verified',p.verified,'bio',p.bio,'interests',p.interests,'skills',p.skills,
      'created_at',p.created_at,'updated_at',p.updated_at
    ) end,
    'posts_count',(select count(*) from public.posts x where x.author_id=u.id)
  ) into result
  from auth.users u
  left join public.profiles p on p.id=u.id
  where u.id=p_user_id and u.deleted_at is null;
  return result;
end;$fn$;

revoke all on function public.main_admin_auth_overview() from public, anon;
revoke all on function public.main_admin_auth_users(text,text,text,integer,integer) from public, anon;
revoke all on function public.main_admin_auth_user_detail(uuid) from public, anon;
grant execute on function public.main_admin_auth_overview() to authenticated;
grant execute on function public.main_admin_auth_users(text,text,text,integer,integer) to authenticated;
grant execute on function public.main_admin_auth_user_detail(uuid) to authenticated;
commit;