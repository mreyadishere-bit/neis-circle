-- Community Builder badge after 2 successful referrals
-- + primary-admin control for homepage admin-post email notifications.
-- Applied to production as 20260928090943 referral_badge_admin_post_email_toggle.

create table if not exists public.profile_badges (
  user_id uuid not null references public.profiles(id) on delete cascade,
  badge_key text not null,
  awarded_at timestamptz not null default now(),
  primary key (user_id,badge_key),
  constraint profile_badges_known_key check (badge_key in ('community_builder'))
);

alter table public.profile_badges enable row level security;

drop policy if exists "authenticated read profile badges" on public.profile_badges;
create policy "authenticated read profile badges"
on public.profile_badges
for select
to authenticated
using (true);

revoke all on public.profile_badges from anon, authenticated;
grant select on public.profile_badges to authenticated;

create or replace function private.award_community_builder_badge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (
    select count(*)
    from public.referrals r
    where r.referrer_id = new.referrer_id
  ) >= 2 then
    insert into public.profile_badges(user_id,badge_key,awarded_at)
    values (new.referrer_id,'community_builder',now())
    on conflict (user_id,badge_key) do nothing;
  end if;
  return new;
end;
$$;

revoke execute on function private.award_community_builder_badge() from public, anon, authenticated;

drop trigger if exists award_community_builder_badge_trigger on public.referrals;
create trigger award_community_builder_badge_trigger
after insert on public.referrals
for each row execute function private.award_community_builder_badge();

insert into public.profile_badges(user_id,badge_key,awarded_at)
select r.referrer_id,'community_builder',min(r.created_at)
from public.referrals r
group by r.referrer_id
having count(*) >= 2
on conflict (user_id,badge_key) do nothing;

create or replace function private.referral_summary_impl()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  code text;
  invite_count bigint := 0;
  candidate text;
begin
  if me is null then raise exception 'authentication_required'; end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = me and p.account_status = 'active'
  ) then
    raise exception 'account_not_allowed';
  end if;

  select r.referral_code into code
  from public.user_referral_codes r
  where r.user_id = me;

  if code is null then
    loop
      candidate := 'nc-' || lower(substr(encode(extensions.gen_random_bytes(8), 'hex'), 1, 10));
      begin
        insert into public.user_referral_codes(user_id, referral_code)
        values (me, candidate)
        returning referral_code into code;
        exit;
      exception when unique_violation then
        if exists(select 1 from public.user_referral_codes r where r.user_id = me) then
          select r.referral_code into code
          from public.user_referral_codes r
          where r.user_id = me;
          exit;
        end if;
      end;
    end loop;
  end if;

  select count(*) into invite_count
  from public.referrals r
  where r.referrer_id = me;

  return jsonb_build_object(
    'referral_code', code,
    'successful_invites', invite_count,
    'community_builder', invite_count >= 2
  );
end;
$$;

insert into public.system_settings(setting_key,enabled,updated_at,updated_by)
values ('admin_post_emails_enabled',true,now(),null)
on conflict (setting_key) do nothing;

create or replace function private.get_admin_post_email_setting_impl()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (
    select 1
    from auth.users u
    join public.profiles p on p.id=u.id
    where u.id=auth.uid()
      and lower(coalesce(u.email,''))='mreyadishere@gmail.com'
      and p.role='admin'
      and coalesce(p.account_status,'active')='active'
  ) then
    raise exception 'not_authorized';
  end if;

  return coalesce(
    (select enabled from public.system_settings where setting_key='admin_post_emails_enabled'),
    true
  );
end;
$$;

create or replace function private.set_admin_post_email_setting_impl(desired_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (
    select 1
    from auth.users u
    join public.profiles p on p.id=u.id
    where u.id=auth.uid()
      and lower(coalesce(u.email,''))='mreyadishere@gmail.com'
      and p.role='admin'
      and coalesce(p.account_status,'active')='active'
  ) then
    raise exception 'not_authorized';
  end if;

  insert into public.system_settings(setting_key,enabled,updated_at,updated_by)
  values ('admin_post_emails_enabled',coalesce(desired_enabled,false),now(),auth.uid())
  on conflict (setting_key) do update
  set enabled=excluded.enabled,
      updated_at=now(),
      updated_by=auth.uid();

  return coalesce(desired_enabled,false);
end;
$$;

revoke execute on function private.get_admin_post_email_setting_impl() from public, anon;
revoke execute on function private.set_admin_post_email_setting_impl(boolean) from public, anon;
grant execute on function private.get_admin_post_email_setting_impl() to authenticated;
grant execute on function private.set_admin_post_email_setting_impl(boolean) to authenticated;

create or replace function public.get_admin_post_email_setting()
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select private.get_admin_post_email_setting_impl();
$$;

create or replace function public.set_admin_post_email_setting(desired_enabled boolean)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select private.set_admin_post_email_setting_impl(desired_enabled);
$$;

revoke execute on function public.get_admin_post_email_setting() from public, anon;
revoke execute on function public.set_admin_post_email_setting(boolean) from public, anon;
grant execute on function public.get_admin_post_email_setting() to authenticated;
grant execute on function public.set_admin_post_email_setting(boolean) to authenticated;

create or replace function public.enqueue_admin_post_email()
returns trigger
language plpgsql
security definer
set search_path to 'public','auth'
as $function$
begin
  if coalesce(
    (select enabled from public.system_settings where setting_key='admin_post_emails_enabled'),
    true
  ) is not true then
    return new;
  end if;

  if new.circle_id is not null then return new; end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = new.author_id
      and p.role = 'admin'
      and coalesce(p.account_status,'active') = 'active'
  ) then
    return new;
  end if;

  insert into public.email_notification_outbox(
    user_id,event_key,event_type,subject,preview,action_path
  )
  select
    u.id,
    'admin-post:' || new.id::text || ':' || u.id::text,
    'admin_post',
    coalesce(nullif(new.title,''),'New post from NEIS Circle') || ' · منشور جديد',
    left(coalesce(nullif(new.body,''),'A new post is available on NEIS Circle.'),240),
    '/#/post/' || new.id::text
  from auth.users u
  join public.profiles p on p.id = u.id
  where u.id <> new.author_id
    and coalesce(p.account_status,'active') = 'active'
    and u.email is not null
    and u.email_confirmed_at is not null
  on conflict (event_key) do nothing;

  return new;
end;
$function$;

revoke execute on function public.enqueue_admin_post_email() from public, anon, authenticated;
