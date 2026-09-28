-- Mobile push foundation for the NEIS Circle Android app.
-- Applied to production as 20260928153524 mobile_push_foundation.

create table public.push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  token text not null unique,
  platform text not null check (platform in ('android','ios')),
  app_version text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index push_devices_user_enabled_idx on public.push_devices(user_id,enabled);
alter table public.push_devices enable row level security;
create policy "users read own push devices" on public.push_devices
for select to authenticated using ((select auth.uid())=user_id);
revoke all on public.push_devices from anon,authenticated;
grant select on public.push_devices to authenticated;

create table public.push_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  messages boolean not null default true,
  replies boolean not null default true,
  circles boolean not null default true,
  social boolean not null default true,
  announcements boolean not null default true,
  reactions boolean not null default false,
  sound boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.push_preferences enable row level security;
create policy "users read own push preferences" on public.push_preferences
for select to authenticated using ((select auth.uid())=user_id);
create policy "users insert own push preferences" on public.push_preferences
for insert to authenticated with check ((select auth.uid())=user_id);
create policy "users update own push preferences" on public.push_preferences
for update to authenticated
using ((select auth.uid())=user_id)
with check ((select auth.uid())=user_id);
revoke all on public.push_preferences from anon,authenticated;
grant select,insert,update on public.push_preferences to authenticated;

create table public.push_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  dispatch_token uuid not null default gen_random_uuid(),
  notification_id bigint not null unique references public.notifications(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  category text not null check (category in ('messages','replies','circles','social','announcements','reactions')),
  title text not null,
  body text not null,
  route text,
  notification_type text not null,
  status text not null default 'pending' check (status in ('pending','sending','sent','failed')),
  attempts integer not null default 0 check (attempts>=0),
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index push_outbox_pending_idx
on public.push_notification_outbox(status,next_attempt_at,created_at)
where status in ('pending','failed');

alter table public.push_notification_outbox enable row level security;
revoke all on public.push_notification_outbox from anon,authenticated;

create or replace function private.register_push_device_impl(
  token_input text, platform_input text, app_version_input text default null
) returns uuid
language plpgsql security definer set search_path=''
as $$
declare
  me uuid:=auth.uid();
  device_id uuid;
  clean_token text:=trim(coalesce(token_input,''));
  clean_platform text:=lower(trim(coalesce(platform_input,'')));
begin
  if me is null then raise exception 'authentication_required'; end if;
  if clean_platform not in ('android','ios') then raise exception 'invalid_platform'; end if;
  if length(clean_token)<20 or length(clean_token)>4096 then raise exception 'invalid_push_token'; end if;
  if not exists(
    select 1 from public.profiles p
    where p.id=me and coalesce(p.account_status,'active')='active'
  ) then raise exception 'account_not_allowed'; end if;

  insert into public.push_devices(user_id,token,platform,app_version,enabled,last_seen_at,updated_at)
  values(me,clean_token,clean_platform,nullif(trim(coalesce(app_version_input,'')),''),true,now(),now())
  on conflict(token) do update set
    user_id=excluded.user_id,
    platform=excluded.platform,
    app_version=excluded.app_version,
    enabled=true,
    last_seen_at=now(),
    updated_at=now()
  returning id into device_id;

  insert into public.push_preferences(user_id) values(me)
  on conflict(user_id) do nothing;

  return device_id;
end $$;

revoke execute on function private.register_push_device_impl(text,text,text) from public,anon;
grant execute on function private.register_push_device_impl(text,text,text) to authenticated;

create or replace function public.register_push_device(
  token_input text, platform_input text, app_version_input text default null
) returns uuid language sql security invoker set search_path=''
as $$ select private.register_push_device_impl(token_input,platform_input,app_version_input); $$;

revoke execute on function public.register_push_device(text,text,text) from public,anon;
grant execute on function public.register_push_device(text,text,text) to authenticated;

create or replace function private.disable_push_device_impl(token_input text)
returns boolean language plpgsql security definer set search_path=''
as $$
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  update public.push_devices set enabled=false,updated_at=now()
  where user_id=auth.uid() and token=trim(coalesce(token_input,''));
  return found;
end $$;

revoke execute on function private.disable_push_device_impl(text) from public,anon;
grant execute on function private.disable_push_device_impl(text) to authenticated;

create or replace function public.disable_push_device(token_input text)
returns boolean language sql security invoker set search_path=''
as $$ select private.disable_push_device_impl(token_input); $$;

revoke execute on function public.disable_push_device(text) from public,anon;
grant execute on function public.disable_push_device(text) to authenticated;

create or replace function private.enqueue_mobile_push_from_notification()
returns trigger language plpgsql security definer set search_path=''
as $$
declare
  category_value text;
  allowed boolean:=false;
  prefs public.push_preferences%rowtype;
begin
  category_value:=case
    when new.type='message' then 'messages'
    when new.type in ('reply','comment_reply') then 'replies'
    when new.type in ('circle_message','circle_meeting','membership_accepted','membership_request') then 'circles'
    when new.type='follow' then 'social'
    when new.type in ('admin_post','new_article') then 'announcements'
    when new.type in ('reaction','comment_like','article_comment_like','comment_heart','article_comment_heart') then 'reactions'
    else null end;
  if category_value is null then return new; end if;

  select * into prefs from public.push_preferences where user_id=new.user_id;
  if found then
    allowed:=case category_value
      when 'messages' then prefs.messages
      when 'replies' then prefs.replies
      when 'circles' then prefs.circles
      when 'social' then prefs.social
      when 'announcements' then prefs.announcements
      when 'reactions' then prefs.reactions
      else false end;
  else
    allowed:=category_value<>'reactions';
  end if;

  if not allowed then return new; end if;
  if not exists(select 1 from public.push_devices d where d.user_id=new.user_id and d.enabled=true)
    then return new; end if;

  insert into public.push_notification_outbox(
    notification_id,user_id,category,title,body,route,notification_type
  ) values(new.id,new.user_id,category_value,new.title,new.body,new.route,new.type)
  on conflict(notification_id) do nothing;
  return new;
end $$;

revoke execute on function private.enqueue_mobile_push_from_notification() from public,anon,authenticated;

create trigger notifications_enqueue_mobile_push
after insert on public.notifications
for each row execute function private.enqueue_mobile_push_from_notification();

create or replace function private.dispatch_mobile_push_job()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  perform net.http_post(
    url:='https://ydieijgynqlckaczalju.supabase.co/functions/v1/send-mobile-push',
    body:=jsonb_build_object('job_id',new.id,'dispatch_token',new.dispatch_token),
    params:='{}'::jsonb,
    headers:=jsonb_build_object('Content-Type','application/json'),
    timeout_milliseconds:=4000
  );
  return new;
exception when others then
  return new;
end $$;

revoke execute on function private.dispatch_mobile_push_job() from public,anon,authenticated;

create trigger push_outbox_dispatch
after insert on public.push_notification_outbox
for each row execute function private.dispatch_mobile_push_job();

select cron.schedule(
  'neis-mobile-push-retry','* * * * *',
  $cron$
    select net.http_post(
      url:='https://ydieijgynqlckaczalju.supabase.co/functions/v1/send-mobile-push',
      body:=jsonb_build_object('job_id',o.id,'dispatch_token',o.dispatch_token),
      params:='{}'::jsonb,
      headers:=jsonb_build_object('Content-Type','application/json'),
      timeout_milliseconds:=4000
    )
    from public.push_notification_outbox o
    where o.status in ('pending','failed')
      and o.next_attempt_at<=now()
      and o.attempts<5
    order by o.created_at
    limit 20;
  $cron$
);
