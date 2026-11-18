-- NEIS Circle activity: minimal, self-only, throttled, owner-viewable.
-- No IP addresses, user agents, movement details, or activity logs are collected.
begin;
create table if not exists public.neis_user_activity (
 user_id uuid primary key references auth.users(id) on delete cascade,
 last_active_at timestamptz not null default now()
);
alter table public.neis_user_activity enable row level security;
revoke all on public.neis_user_activity from public, anon, authenticated;
-- This function can only stamp the authenticated caller's own account.
create or replace function public.neis_mark_active()
returns timestamptz language plpgsql volatile security definer
set search_path=pg_catalog,public,auth
as $activity$
declare previous timestamptz;
begin
 if auth.role()<>'authenticated' or auth.uid() is null then
   raise exception 'Sign in required' using errcode='42501';
 end if;
 insert into public.neis_user_activity(user_id,last_active_at)
 values(auth.uid(),now())
 on conflict(user_id) do update set last_active_at=excluded.last_active_at
 where public.neis_user_activity.last_active_at <= now()-interval '5 minutes';
 select last_active_at into previous from public.neis_user_activity where user_id=auth.uid();
 return previous;
end;$activity$;
revoke all on function public.neis_mark_active() from public,anon;
grant execute on function public.neis_mark_active() to authenticated;
-- Preserve existing super-admin-only auth directory semantics and all filters.
create or replace function public.main_admin_auth_users(
  p_search text,
  p_filter text,
  p_sort text,
  p_limit integer,
  p_offset integer,
  p_search_field text,
  p_provider text
) returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, public, auth
as $fn$
declare
  q text := left(btrim(coalesce(p_search,'')),100);
  f text := lower(coalesce(p_filter,'all'));
  ordering text := lower(coalesce(p_sort,'created_desc'));
  field text := lower(coalesce(p_search_field,'all'));
  provider_filter text := lower(coalesce(p_provider,'all'));
  page_size integer := least(50,greatest(1,coalesce(p_limit,20)));
  page_start integer := least(100000,greatest(0,coalesce(p_offset,0)));
  total_count bigint;
  records jsonb;
begin
  if not public.neis_admin_is_super() then
    raise exception 'Access denied to authentication console' using errcode='42501';
  end if;
  if f not in ('all','confirmed','pending','blocked','admins','no_profile','signed_in_30d')
    or field not in ('all','id','email','phone','name')
    or provider_filter not in ('all','google','other')
    or ordering not in (
      'created_desc','created_asc','last_sign_in_desc','last_sign_in_asc','last_active_desc','last_active_asc',
      'email_asc','email_desc','name_asc'
    )
  then raise exception 'Invalid search/filter/sort option' using errcode='22023'; end if;

  with filtered as (
    select
      u.id as user_id,
      u.email,u.phone,
      coalesce(nullif(p.full_name,''),nullif(u.raw_user_meta_data->>'full_name',''),
        nullif(u.raw_user_meta_data->>'name',''),'—') as display_name,
      p.username,p.grade,p.branch,p.campus,p.role,p.account_status,
      (p.id is not null) as has_profile,
      (u.email_confirmed_at is not null or u.confirmed_at is not null) as confirmed,
      (u.banned_until > now()) as banned,
      (u.is_anonymous is true) as is_anonymous,
      u.created_at,u.last_sign_in_at,act.last_active_at,
      exists(select 1 from auth.identities i where i.user_id=u.id and i.provider='google') as google_provider,
      (select coalesce(array_agg(distinct i.provider order by i.provider),array[]::text[])
        from auth.identities i where i.user_id=u.id) as providers
    from auth.users u
      left join public.profiles p on p.id=u.id
      left join public.neis_user_activity act on act.user_id=u.id
    where u.deleted_at is null
      and (
        q='' or
        (field in ('all','id') and u.id::text ilike '%'||q||'%') or
        (field in ('all','email') and u.email ilike '%'||q||'%') or
        (field in ('all','phone') and u.phone ilike '%'||q||'%') or
        (field in ('all','name') and (
           coalesce(p.full_name,'') ilike '%'||q||'%' or
           coalesce(p.username,'') ilike '%'||q||'%' or
           coalesce(u.raw_user_meta_data->>'full_name','') ilike '%'||q||'%' or
           coalesce(u.raw_user_meta_data->>'name','') ilike '%'||q||'%'
        ))
      )
      and (
        f='all'
        or (f='confirmed' and (u.email_confirmed_at is not null or u.confirmed_at is not null))
        or (f='pending' and u.email_confirmed_at is null and u.confirmed_at is null)
        or (f='blocked' and (u.banned_until>now() or coalesce(p.account_status,'active')<>'active'))
        or (f='admins' and p.role='admin')
        or (f='no_profile' and p.id is null)
        or (f='signed_in_30d' and u.last_sign_in_at>=now()-interval '30 days')
      )
      and (
        provider_filter='all'
        or (provider_filter='google' and exists(
             select 1 from auth.identities i where i.user_id=u.id and i.provider='google'))
        or (provider_filter='other' and not exists(
             select 1 from auth.identities i where i.user_id=u.id and i.provider='google'))
      )
  ),
  numbered as (
    select *, row_number() over (
      order by
        case when ordering='created_asc' then created_at end asc nulls last,
        case when ordering='created_desc' then created_at end desc nulls last,
        case when ordering='last_sign_in_desc' then last_sign_in_at end desc nulls last,
        case when ordering='last_sign_in_asc' then last_sign_in_at end asc nulls last,
        case when ordering='last_active_desc' then last_active_at end desc nulls last,
        case when ordering='last_active_asc' then last_active_at end asc nulls last,
        case when ordering='email_asc' then email end asc nulls last,
        case when ordering='email_desc' then email end desc nulls last,
        case when ordering='name_asc' then display_name end asc nulls last,
        user_id desc
    ) as row_no
    from filtered
  )
  select count(*) into total_count from numbered;

  with filtered as (
    select
      u.id as user_id,u.email,u.phone,
      coalesce(nullif(p.full_name,''),nullif(u.raw_user_meta_data->>'full_name',''),
        nullif(u.raw_user_meta_data->>'name',''),'—') as display_name,
      p.username,p.grade,p.branch,p.campus,p.role,p.account_status,
      (p.id is not null) as has_profile,
      (u.email_confirmed_at is not null or u.confirmed_at is not null) as confirmed,
      (u.banned_until > now()) as banned,
      (u.is_anonymous is true) as is_anonymous,
      u.created_at,u.last_sign_in_at,act.last_active_at,
      exists(select 1 from auth.identities i where i.user_id=u.id and i.provider='google') as google_provider,
      (select coalesce(array_agg(distinct i.provider order by i.provider),array[]::text[])
        from auth.identities i where i.user_id=u.id) as providers
    from auth.users u
      left join public.profiles p on p.id=u.id
      left join public.neis_user_activity act on act.user_id=u.id
    where u.deleted_at is null
      and (
        q='' or
        (field in ('all','id') and u.id::text ilike '%'||q||'%') or
        (field in ('all','email') and u.email ilike '%'||q||'%') or
        (field in ('all','phone') and u.phone ilike '%'||q||'%') or
        (field in ('all','name') and (
           coalesce(p.full_name,'') ilike '%'||q||'%' or
           coalesce(p.username,'') ilike '%'||q||'%' or
           coalesce(u.raw_user_meta_data->>'full_name','') ilike '%'||q||'%' or
           coalesce(u.raw_user_meta_data->>'name','') ilike '%'||q||'%'
        ))
      )
      and (
        f='all'
        or (f='confirmed' and (u.email_confirmed_at is not null or u.confirmed_at is not null))
        or (f='pending' and u.email_confirmed_at is null and u.confirmed_at is null)
        or (f='blocked' and (u.banned_until>now() or coalesce(p.account_status,'active')<>'active'))
        or (f='admins' and p.role='admin')
        or (f='no_profile' and p.id is null)
        or (f='signed_in_30d' and u.last_sign_in_at>=now()-interval '30 days')
      )
      and (
        provider_filter='all'
        or (provider_filter='google' and exists(
             select 1 from auth.identities i where i.user_id=u.id and i.provider='google'))
        or (provider_filter='other' and not exists(
             select 1 from auth.identities i where i.user_id=u.id and i.provider='google'))
      )
  ),
  numbered as (
    select *,row_number() over (
      order by
        case when ordering='created_asc' then created_at end asc nulls last,
        case when ordering='created_desc' then created_at end desc nulls last,
        case when ordering='last_sign_in_desc' then last_sign_in_at end desc nulls last,
        case when ordering='last_sign_in_asc' then last_sign_in_at end asc nulls last,
        case when ordering='last_active_desc' then last_active_at end desc nulls last,
        case when ordering='last_active_asc' then last_active_at end asc nulls last,
        case when ordering='email_asc' then email end asc nulls last,
        case when ordering='email_desc' then email end desc nulls last,
        case when ordering='name_asc' then display_name end asc nulls last,
        user_id desc
    ) as row_no
    from filtered
  ),
  page as (
    select * from numbered order by row_no limit page_size offset page_start
  )
  select coalesce(jsonb_agg(to_jsonb(page)-'row_no' order by row_no),'[]'::jsonb)
  into records from page;

  return jsonb_build_object('total',total_count,'users',records,
                            'limit',page_size,'offset',page_start);
end;$fn$;
revoke all on function public.main_admin_auth_users(text,text,text,integer,integer,text,text) from public,anon;
grant execute on function public.main_admin_auth_users(text,text,text,integer,integer,text,text) to authenticated;
commit;
