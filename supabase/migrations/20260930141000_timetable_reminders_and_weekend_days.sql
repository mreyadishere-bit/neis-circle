
alter table public.user_timetable_entries
  add column if not exists reminder_enabled boolean not null default true,
  add column if not exists reminder_minutes smallint not null default 15
    check (reminder_minutes in (5,10,15,30,60));

create table if not exists public.user_timetable_reminder_log (
  entry_id uuid not null references public.user_timetable_entries(id) on delete cascade,
  occurrence_date date not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(entry_id,occurrence_date)
);

alter table public.user_timetable_reminder_log enable row level security;
drop policy if exists timetable_reminder_log_owner_select on public.user_timetable_reminder_log;
create policy timetable_reminder_log_owner_select
on public.user_timetable_reminder_log
for select to authenticated
using ((select auth.uid())=user_id);

revoke all on public.user_timetable_reminder_log from anon;
grant select on public.user_timetable_reminder_log to authenticated;

alter table public.push_preferences
  add column if not exists timetable_reminders boolean not null default true;

create or replace function public.enqueue_due_timetable_reminders()
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare
  cairo_now timestamp without time zone := timezone('Africa/Cairo', now());
  cairo_date date := timezone('Africa/Cairo', now())::date;
  cairo_dow int := extract(dow from timezone('Africa/Cairo', now()))::int;
  inserted_count integer := 0;
begin
  with due as (
    select
      e.id,
      e.user_id,
      e.title,
      e.start_time,
      e.location,
      e.reminder_minutes
    from public.user_timetable_entries e
    where e.reminder_enabled=true
      and e.day_of_week=cairo_dow
      and (cairo_date + e.start_time) > cairo_now
      and (cairo_date + e.start_time) <= cairo_now + interval '16 minutes'
      and (cairo_date + e.start_time) >= cairo_now + interval '14 minutes'
      and not exists (
        select 1
        from public.user_timetable_reminder_log l
        where l.entry_id=e.id
          and l.occurrence_date=cairo_date
      )
  ),
  logged as (
    insert into public.user_timetable_reminder_log(entry_id,occurrence_date,user_id)
    select id,cairo_date,user_id from due
    on conflict(entry_id,occurrence_date) do nothing
    returning entry_id,user_id
  ),
  made as (
    insert into public.notifications(
      user_id,actor_id,type,title,body,entity_type,entity_id,route
    )
    select
      d.user_id,
      null,
      'timetable_reminder',
      'Upcoming: '||d.title,
      case
        when coalesce(nullif(d.location,''),'')<>'' then
          d.title||' starts in about 15 minutes · '||d.location
        else
          d.title||' starts in about 15 minutes'
      end,
      'timetable_entry',
      d.id::text,
      'timetable?entry='||d.id::text
    from due d
    join logged l on l.entry_id=d.id and l.user_id=d.user_id
    returning 1
  )
  select count(*) into inserted_count from made;

  return inserted_count;
end;
$$;

create or replace function private.enqueue_web_push_from_notification()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  category_value text;
  allowed boolean:=true;
  prefs public.push_preferences%rowtype;
  push_title text:=new.title;
  push_route text:=coalesce(new.route,'');
begin
  category_value:=case
    when new.type='message' then 'messages'
    when new.type in ('reply','comment_reply','comment_edit','article_comment_edit') then 'replies'
    when new.type in ('circle_message','circle_meeting','membership_accepted','membership_request','membership_updated','membership_rejected','new_circle','circle_post') then 'circles'
    when new.type='follow' then 'social'
    when new.type in ('admin_post','new_post','new_article') then 'announcements'
    when new.type in ('reaction','comment_like','article_comment_like','comment_heart','article_comment_heart') then 'reactions'
    when new.type='timetable_reminder' then 'timetable'
    else null end;
  if category_value is null then return new; end if;

  select * into prefs from public.push_preferences where user_id=new.user_id;
  if found then
    allowed:=case
      when new.type='message' then prefs.direct_messages
      when new.type in ('reply','comment_reply','comment_edit') and new.entity_type='comment' then prefs.post_comments_replies
      when new.type in ('reply','comment_reply','article_comment_edit') and new.entity_type='article_comment' then prefs.article_comments_replies
      when new.type='reaction' and new.entity_type='post' then prefs.post_likes
      when new.type='reaction' and new.entity_type='article' then prefs.article_likes
      when new.type in ('comment_like','article_comment_like','comment_heart','article_comment_heart') then prefs.comment_reactions
      when new.type in ('admin_post','new_post') then prefs.new_posts
      when new.type='new_article' then prefs.new_articles
      when new.type='new_circle' then prefs.new_circles
      when new.type='circle_post' then prefs.circle_posts
      when new.type='circle_message' then prefs.circle_messages
      when new.type='circle_meeting' then prefs.circle_meetings
      when new.type in ('membership_accepted','membership_request','membership_updated','membership_rejected') then prefs.circle_membership
      when new.type='follow' then prefs.followers
      when new.type='timetable_reminder' then prefs.timetable_reminders
      else true
    end;
  end if;
  if not allowed then return new; end if;

  if new.type='message' and new.actor_id is not null then
    select coalesce(nullif(p.full_name,''),nullif(p.username,''),'New message')
      into push_title from public.profiles p where p.id=new.actor_id;
  end if;

  if new.entity_type='comment' and coalesce(new.entity_id,'')<>'' and push_route like 'post/%' and push_route not like '%comment=%' then
    push_route:=push_route||case when position('?' in push_route)>0 then '&' else '?' end||'comment='||new.entity_id;
  elsif new.entity_type='article_comment' and coalesce(new.entity_id,'')<>'' and push_route like 'articles/%' and push_route not like '%comment=%' then
    push_route:=push_route||case when position('?' in push_route)>0 then '&' else '?' end||'comment='||new.entity_id;
  elsif new.entity_type in ('message','circle_message') and coalesce(new.entity_id,'')<>'' and push_route not like '%message=%' then
    push_route:=push_route||case when position('?' in push_route)>0 then '&' else '?' end||'message='||new.entity_id;
  end if;

  if push_route='' then push_route:='/#/';
  elsif push_route like '/#/%' then null;
  elsif push_route like '#/%' then push_route:='/'||push_route;
  else push_route:='/#/'||regexp_replace(push_route,'^/+','','g');
  end if;

  if exists(select 1 from public.web_push_subscriptions s where s.user_id=new.user_id and s.enabled=true) then
    insert into public.web_push_outbox(notification_id,user_id,category,title,body,route,notification_type)
    values(new.id,new.user_id,category_value,coalesce(push_title,new.title),coalesce(new.body,''),push_route,new.type)
    on conflict(notification_id) do nothing;
  end if;
  return new;
end;
$$;

create or replace function private.enqueue_mobile_push_from_notification()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  category_value text;
  allowed boolean:=true;
  prefs public.push_preferences%rowtype;
  push_title text:=new.title;
  push_route text:=coalesce(new.route,'');
begin
  category_value:=case
    when new.type='message' then 'messages'
    when new.type in ('reply','comment_reply','comment_edit','article_comment_edit') then 'replies'
    when new.type in ('circle_message','circle_meeting','membership_accepted','membership_request','membership_updated','membership_rejected','new_circle','circle_post') then 'circles'
    when new.type='follow' then 'social'
    when new.type in ('admin_post','new_post','new_article') then 'announcements'
    when new.type in ('reaction','comment_like','article_comment_like','comment_heart','article_comment_heart') then 'reactions'
    when new.type='timetable_reminder' then 'timetable'
    else null end;
  if category_value is null then return new; end if;

  select * into prefs from public.push_preferences where user_id=new.user_id;
  if found then
    allowed:=case
      when new.type='message' then prefs.direct_messages
      when new.type in ('reply','comment_reply','comment_edit') and new.entity_type='comment' then prefs.post_comments_replies
      when new.type in ('reply','comment_reply','article_comment_edit') and new.entity_type='article_comment' then prefs.article_comments_replies
      when new.type='reaction' and new.entity_type='post' then prefs.post_likes
      when new.type='reaction' and new.entity_type='article' then prefs.article_likes
      when new.type in ('comment_like','article_comment_like','comment_heart','article_comment_heart') then prefs.comment_reactions
      when new.type in ('admin_post','new_post') then prefs.new_posts
      when new.type='new_article' then prefs.new_articles
      when new.type='new_circle' then prefs.new_circles
      when new.type='circle_post' then prefs.circle_posts
      when new.type='circle_message' then prefs.circle_messages
      when new.type='circle_meeting' then prefs.circle_meetings
      when new.type in ('membership_accepted','membership_request','membership_updated','membership_rejected') then prefs.circle_membership
      when new.type='follow' then prefs.followers
      when new.type='timetable_reminder' then prefs.timetable_reminders
      else true
    end;
  end if;
  if not allowed then return new; end if;

  if new.type='message' and new.actor_id is not null then
    select coalesce(nullif(p.full_name,''),nullif(p.username,''),'New message')
      into push_title from public.profiles p where p.id=new.actor_id;
  end if;

  if new.entity_type='comment' and coalesce(new.entity_id,'')<>'' and push_route like 'post/%' and push_route not like '%comment=%' then
    push_route:=push_route||case when position('?' in push_route)>0 then '&' else '?' end||'comment='||new.entity_id;
  elsif new.entity_type='article_comment' and coalesce(new.entity_id,'')<>'' and push_route like 'articles/%' and push_route not like '%comment=%' then
    push_route:=push_route||case when position('?' in push_route)>0 then '&' else '?' end||'comment='||new.entity_id;
  elsif new.entity_type in ('message','circle_message') and coalesce(new.entity_id,'')<>'' and push_route not like '%message=%' then
    push_route:=push_route||case when position('?' in push_route)>0 then '&' else '?' end||'message='||new.entity_id;
  end if;

  if exists(select 1 from public.push_devices d where d.user_id=new.user_id and d.enabled=true) then
    insert into public.push_notification_outbox(notification_id,user_id,category,title,body,route,notification_type)
    values(new.id,new.user_id,category_value,coalesce(push_title,new.title),coalesce(new.body,''),push_route,new.type)
    on conflict(notification_id) do nothing;
  end if;
  return new;
end;
$$;

select cron.schedule(
  'neis-timetable-reminders',
  '* * * * *',
  $$select public.enqueue_due_timetable_reminders();$$
)
where not exists (
  select 1 from cron.job where jobname='neis-timetable-reminders'
);
