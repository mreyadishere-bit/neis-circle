create table if not exists public.web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table public.web_push_subscriptions enable row level security;
drop policy if exists "users read own web push subscriptions" on public.web_push_subscriptions;
create policy "users read own web push subscriptions"
on public.web_push_subscriptions for select
using (auth.uid()=user_id);

create or replace function public.register_web_push_subscription(
  endpoint_input text,
  p256dh_input text,
  auth_input text,
  user_agent_input text default null
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare subscription_id uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if coalesce(length(endpoint_input),0)<20 or coalesce(length(p256dh_input),0)<20 or coalesce(length(auth_input),0)<8 then
    raise exception 'invalid_subscription';
  end if;

  insert into public.web_push_subscriptions(user_id,endpoint,p256dh,auth,user_agent,enabled,last_seen_at,updated_at)
  values(auth.uid(),endpoint_input,p256dh_input,auth_input,left(user_agent_input,500),true,now(),now())
  on conflict(endpoint) do update
  set user_id=excluded.user_id,
      p256dh=excluded.p256dh,
      auth=excluded.auth,
      user_agent=excluded.user_agent,
      enabled=true,
      last_seen_at=now(),
      updated_at=now()
  returning id into subscription_id;

  insert into public.push_preferences(user_id)
  values(auth.uid())
  on conflict(user_id) do nothing;

  return subscription_id;
end;
$$;

create or replace function public.disable_web_push_subscription(endpoint_input text)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
begin
  if auth.uid() is null then return false; end if;
  update public.web_push_subscriptions
  set enabled=false,updated_at=now()
  where endpoint=endpoint_input and user_id=auth.uid();
  return found;
end;
$$;

revoke all on function public.register_web_push_subscription(text,text,text,text) from public,anon;
revoke all on function public.disable_web_push_subscription(text) from public,anon;
grant execute on function public.register_web_push_subscription(text,text,text,text) to authenticated;
grant execute on function public.disable_web_push_subscription(text) to authenticated;

create table if not exists public.web_push_outbox (
  id uuid primary key default gen_random_uuid(),
  dispatch_token uuid not null default gen_random_uuid(),
  notification_id bigint not null unique references public.notifications(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  category text not null,
  title text not null,
  body text not null default '',
  route text,
  notification_type text,
  status text not null default 'pending' check(status in ('pending','sending','sent','failed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

alter table public.web_push_outbox enable row level security;
revoke all on public.web_push_outbox from anon,authenticated;
grant select,insert,update,delete on public.web_push_subscriptions to service_role;
grant select,insert,update,delete on public.web_push_outbox to service_role;

create or replace function private.enqueue_web_push_from_notification()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  category_value text;
  allowed boolean:=false;
  prefs public.push_preferences%rowtype;
  push_title text:=new.title;
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

  if new.type='message' and new.actor_id is not null then
    select coalesce(nullif(p.full_name,''),nullif(p.username,''),'New message')
    into push_title
    from public.profiles p where p.id=new.actor_id;
    push_title:=coalesce(push_title,'New message');
  end if;

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
    allowed:=true;
  end if;

  if not allowed then return new; end if;

  if not exists(
    select 1 from public.web_push_subscriptions s
    where s.user_id=new.user_id and s.enabled=true
  ) then return new; end if;

  insert into public.web_push_outbox(notification_id,user_id,category,title,body,route,notification_type)
  values(new.id,new.user_id,category_value,push_title,coalesce(new.body,''),new.route,new.type)
  on conflict(notification_id) do nothing;

  return new;
end;
$$;

revoke execute on function private.enqueue_web_push_from_notification()
from public,anon,authenticated;

drop trigger if exists notifications_enqueue_web_push on public.notifications;
create trigger notifications_enqueue_web_push
after insert on public.notifications
for each row execute function private.enqueue_web_push_from_notification();

create or replace function private.dispatch_web_push_job()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  perform net.http_post(
    url:='https://ydieijgynqlckaczalju.supabase.co/functions/v1/send-web-push',
    body:=jsonb_build_object('job_id',new.id,'dispatch_token',new.dispatch_token),
    params:='{}'::jsonb,
    headers:=jsonb_build_object('Content-Type','application/json'),
    timeout_milliseconds:=4000
  );
  return new;
end;
$$;

revoke execute on function private.dispatch_web_push_job()
from public,anon,authenticated;

drop trigger if exists web_push_outbox_dispatch on public.web_push_outbox;
create trigger web_push_outbox_dispatch
after insert on public.web_push_outbox
for each row execute function private.dispatch_web_push_job();

create or replace function public.get_web_push_vapid_keys()
returns table(public_key text,private_key text)
language sql
security definer
set search_path=public,vault
as $$
  select
    (select decrypted_secret from vault.decrypted_secrets where name='neis_web_push_vapid_public' limit 1),
    (select decrypted_secret from vault.decrypted_secrets where name='neis_web_push_vapid_private' limit 1);
$$;

revoke all on function public.get_web_push_vapid_keys() from public,anon,authenticated;
grant execute on function public.get_web_push_vapid_keys() to service_role;

do $$
begin
  if not exists(select 1 from cron.job where jobname='neis-web-push-retry') then
    perform cron.schedule(
      'neis-web-push-retry','* * * * *',
      $cron$
        select net.http_post(
          url:='https://ydieijgynqlckaczalju.supabase.co/functions/v1/send-web-push',
          body:=jsonb_build_object('job_id',o.id,'dispatch_token',o.dispatch_token),
          params:='{}'::jsonb,
          headers:=jsonb_build_object('Content-Type','application/json'),
          timeout_milliseconds:=4000
        )
        from public.web_push_outbox o
        where o.status in ('pending','failed')
          and o.next_attempt_at<=now()
          and o.attempts<5
        order by o.created_at
        limit 20;
      $cron$
    );
  end if;
end $$;
