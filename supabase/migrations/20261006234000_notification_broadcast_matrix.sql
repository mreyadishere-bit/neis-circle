-- Primary-admin notification matrix for new platform content.
-- Controls in-app and email broadcasts independently per event type.

create table if not exists public.notification_broadcast_settings (
  event_key text primary key,
  site_enabled boolean not null default true,
  email_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid null references public.profiles(id) on delete set null,
  constraint notification_broadcast_settings_known_event check (event_key in (
    'new_public_post',
    'new_circle_post',
    'new_article',
    'new_opportunity',
    'new_study_resource',
    'new_gallery',
    'new_circle',
    'new_meeting'
  ))
);

alter table public.notification_broadcast_settings enable row level security;
revoke all on table public.notification_broadcast_settings from anon, authenticated;

insert into public.notification_broadcast_settings(event_key,site_enabled,email_enabled)
values
  ('new_public_post',true,false),
  ('new_circle_post',true,false),
  ('new_article',true,true),
  ('new_opportunity',true,true),
  ('new_study_resource',true,true),
  ('new_gallery',false,false),
  ('new_circle',false,false),
  ('new_meeting',true,false)
on conflict (event_key) do nothing;

create or replace function public.get_notification_broadcast_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
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

  return coalesce((
    select jsonb_object_agg(
      event_key,
      jsonb_build_object('site',site_enabled,'email',email_enabled)
      order by event_key
    )
    from public.notification_broadcast_settings
  ), '{}'::jsonb);
end;
$$;

create or replace function public.set_notification_broadcast_setting(
  event_key_input text,
  site_enabled_input boolean,
  email_enabled_input boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare result jsonb;
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

  if event_key_input not in (
    'new_public_post','new_circle_post','new_article','new_opportunity',
    'new_study_resource','new_gallery','new_circle','new_meeting'
  ) then
    raise exception 'unknown_notification_event';
  end if;

  insert into public.notification_broadcast_settings(
    event_key,site_enabled,email_enabled,updated_at,updated_by
  )
  values (
    event_key_input,coalesce(site_enabled_input,false),coalesce(email_enabled_input,false),now(),auth.uid()
  )
  on conflict (event_key) do update
    set site_enabled=excluded.site_enabled,
        email_enabled=excluded.email_enabled,
        updated_at=now(),
        updated_by=auth.uid();

  select jsonb_build_object('site',site_enabled,'email',email_enabled)
    into result
  from public.notification_broadcast_settings
  where event_key=event_key_input;

  return result;
end;
$$;

revoke all on function public.get_notification_broadcast_settings() from public, anon;
revoke all on function public.set_notification_broadcast_setting(text,boolean,boolean) from public, anon;
grant execute on function public.get_notification_broadcast_settings() to authenticated;
grant execute on function public.set_notification_broadcast_setting(text,boolean,boolean) to authenticated;

alter table public.email_notification_outbox
  drop constraint if exists email_notification_outbox_event_type_check;

alter table public.email_notification_outbox
  add constraint email_notification_outbox_event_type_check
  check (event_type = any (array[
    'admin_post'::text,
    'admin_article'::text,
    'important_activity'::text,
    'important_opportunity'::text,
    'new_article'::text,
    'new_opportunity'::text,
    'reply'::text,
    'content_like'::text,
    'admin_dm'::text,
    'new_post'::text,
    'new_circle_post'::text,
    'new_study_resource'::text,
    'new_gallery'::text,
    'new_circle'::text,
    'new_meeting'::text
  ]));

create or replace function public.broadcast_new_post()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  event_name text := case when new.circle_id is null then 'new_public_post' else 'new_circle_post' end;
  site_on boolean;
  email_on boolean;
  author_name text;
  circle_name text;
begin
  select site_enabled,email_enabled into site_on,email_on
  from public.notification_broadcast_settings where event_key=event_name;

  if coalesce(site_on,false) is not true and coalesce(email_on,false) is not true then return new; end if;

  select coalesce(nullif(p.full_name,''),nullif(p.username,''),'A student')
    into author_name from public.profiles p where p.id=new.author_id;

  if new.circle_id is null then
    if coalesce(site_on,false) then
      insert into public.notifications(user_id,actor_id,type,title,body,entity_type,entity_id,route)
      select p.id,new.author_id,'new_post',
             'New post',
             coalesce(author_name,'A student')||': '||left(coalesce(nullif(new.title,''),nullif(new.body,''),'New post'),140),
             'post',new.id::text,'post/'||new.id::text
      from public.profiles p
      where p.id<>new.author_id and coalesce(p.account_status,'active')='active';
    end if;

    if coalesce(email_on,false) then
      insert into public.email_notification_outbox(user_id,event_key,event_type,subject,preview,action_path)
      select u.id,
             'new-public-post:'||new.id::text||':'||u.id::text,
             'new_post',
             'New post: '||coalesce(nullif(new.title,''),'NEIS Circle'),
             left(coalesce(nullif(new.body,''),'A new post is available on NEIS Circle.'),240),
             '/#/post/'||new.id::text
      from auth.users u
      join public.profiles p on p.id=u.id
      where u.id<>new.author_id
        and coalesce(p.account_status,'active')='active'
        and u.email is not null and u.email_confirmed_at is not null
      on conflict (event_key) do nothing;
    end if;
  else
    select c.name into circle_name from public.circles c where c.id=new.circle_id;

    if coalesce(site_on,false) then
      insert into public.notifications(user_id,actor_id,type,title,body,entity_type,entity_id,route)
      select cm.user_id,new.author_id,'circle_post',
             'New post in '||coalesce(circle_name,'Circle'),
             coalesce(author_name,'A student')||': '||left(coalesce(nullif(new.title,''),nullif(new.body,''),'New post'),140),
             'post',new.id::text,
             'circles/'||new.circle_id::text||'/home?post='||new.id::text
      from public.circle_members cm
      where cm.circle_id=new.circle_id
        and cm.status='active'
        and cm.user_id<>new.author_id;
    end if;

    if coalesce(email_on,false) then
      insert into public.email_notification_outbox(user_id,event_key,event_type,subject,preview,action_path)
      select u.id,
             'new-circle-post:'||new.id::text||':'||u.id::text,
             'new_circle_post',
             'New post in '||coalesce(circle_name,'Circle'),
             left(coalesce(nullif(new.title,''),nullif(new.body,''),'A new Circle post is available.'),240),
             '/#/circles/'||new.circle_id::text||'/home?post='||new.id::text
      from public.circle_members cm
      join auth.users u on u.id=cm.user_id
      join public.profiles p on p.id=cm.user_id
      where cm.circle_id=new.circle_id
        and cm.status='active'
        and cm.user_id<>new.author_id
        and coalesce(p.account_status,'active')='active'
        and u.email is not null and u.email_confirmed_at is not null
      on conflict (event_key) do nothing;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists posts_enqueue_admin_email on public.posts;
drop trigger if exists posts_notify_new on public.posts;
drop trigger if exists posts_broadcast_new_content on public.posts;
create trigger posts_broadcast_new_content
after insert on public.posts
for each row execute function public.broadcast_new_post();

create or replace function public.broadcast_new_article()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  should_send boolean;
  site_on boolean;
  email_on boolean;
  article_title text;
  article_preview text;
begin
  if tg_op='INSERT' then
    should_send := new.status='published';
  else
    should_send := new.status='published' and old.status is distinct from 'published';
  end if;
  if not should_send then return new; end if;

  select site_enabled,email_enabled into site_on,email_on
  from public.notification_broadcast_settings where event_key='new_article';

  article_title := coalesce(nullif(new.title_en,''),nullif(new.title_ar,''),'New article');
  article_preview := coalesce(nullif(new.excerpt_en,''),nullif(new.excerpt_ar,''),'A new article is available on NEIS Circle.');

  if coalesce(site_on,false) then
    insert into public.notifications(user_id,actor_id,type,title,body,entity_type,entity_id,route)
    select p.id,new.author_id,'new_article',
           'New article: '||article_title,left(article_preview,180),
           'article',new.id::text,'articles/'||new.id::text
    from public.profiles p
    where p.id<>new.author_id and coalesce(p.account_status,'active')='active';
  end if;

  if coalesce(email_on,false) then
    insert into public.email_notification_outbox(user_id,event_key,event_type,subject,preview,action_path)
    select u.id,
           'article-published:'||new.id::text||':'||u.id::text,
           'new_article',
           'New article: '||article_title,
           left(article_preview,240),
           '/#/articles/'||new.id::text
    from auth.users u
    join public.profiles p on p.id=u.id
    where u.id<>new.author_id
      and coalesce(p.account_status,'active')='active'
      and u.email is not null and u.email_confirmed_at is not null
    on conflict (event_key) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists articles_enqueue_new_email on public.articles;
drop trigger if exists articles_notify_new on public.articles;
drop trigger if exists articles_broadcast_new_content on public.articles;
create trigger articles_broadcast_new_content
after insert or update of status on public.articles
for each row execute function public.broadcast_new_article();

create or replace function public.broadcast_new_opportunity()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare site_on boolean; email_on boolean;
begin
  if new.status<>'open' then return new; end if;
  select site_enabled,email_enabled into site_on,email_on
  from public.notification_broadcast_settings where event_key='new_opportunity';

  if coalesce(site_on,false) then
    insert into public.notifications(user_id,actor_id,type,title,body,entity_type,entity_id,route)
    select p.id,new.author_id,'new_opportunity',
           'New opportunity: '||coalesce(nullif(new.title,''),'Opportunity'),
           left(coalesce(nullif(new.description,''),'A new opportunity is available.'),180),
           'opportunity',new.id::text,'opportunities?opportunity='||new.id::text
    from public.profiles p
    where p.id<>new.author_id and coalesce(p.account_status,'active')='active';
  end if;

  if coalesce(email_on,false) then
    insert into public.email_notification_outbox(user_id,event_key,event_type,subject,preview,action_path)
    select u.id,
           'opportunity-created:'||new.id::text||':'||u.id::text,
           'new_opportunity',
           'New opportunity: '||coalesce(nullif(new.title,''),'Opportunity on NEIS Circle'),
           left(coalesce(nullif(new.description,''),'A new opportunity is available on NEIS Circle.'),240),
           '/#/opportunities?opportunity='||new.id::text
    from auth.users u
    join public.profiles p on p.id=u.id
    where u.id<>new.author_id
      and coalesce(p.account_status,'active')='active'
      and u.email is not null and u.email_confirmed_at is not null
    on conflict (event_key) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists opportunities_enqueue_new_email on public.opportunities;
drop trigger if exists opportunities_broadcast_new_content on public.opportunities;
create trigger opportunities_broadcast_new_content
after insert on public.opportunities
for each row execute function public.broadcast_new_opportunity();

create or replace function public.broadcast_new_study_resource()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare site_on boolean; email_on boolean;
begin
  select site_enabled,email_enabled into site_on,email_on
  from public.notification_broadcast_settings where event_key='new_study_resource';

  if coalesce(site_on,false) then
    insert into public.notifications(user_id,actor_id,type,title,body,entity_type,entity_id,route)
    select p.id,new.author_id,'new_study_resource',
           'New Study resource: '||coalesce(nullif(new.title,''),'Study resource'),
           left(coalesce(nullif(new.description,''),coalesce(new.subject,'Study')||' · '||coalesce(new.unit,'')),180),
           'study_resource',new.id::text,'study?resource='||new.id::text
    from public.profiles p
    where p.id<>new.author_id and coalesce(p.account_status,'active')='active';
  end if;

  if coalesce(email_on,false) then
    insert into public.email_notification_outbox(user_id,event_key,event_type,subject,preview,action_path)
    select u.id,
           'study-resource-created:'||new.id::text||':'||u.id::text,
           'new_study_resource',
           'New Study resource: '||coalesce(nullif(new.title,''),'Study resource'),
           left(coalesce(nullif(new.description,''),coalesce(new.subject,'Study')||' · '||coalesce(new.unit,'')),240),
           '/#/study?resource='||new.id::text
    from auth.users u
    join public.profiles p on p.id=u.id
    where u.id<>new.author_id
      and coalesce(p.account_status,'active')='active'
      and u.email is not null and u.email_confirmed_at is not null
    on conflict (event_key) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists study_resources_broadcast_new_content on public.study_resources;
create trigger study_resources_broadcast_new_content
after insert on public.study_resources
for each row execute function public.broadcast_new_study_resource();

create or replace function public.broadcast_gallery_approval()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare site_on boolean; email_on boolean; should_send boolean;
begin
  should_send := new.approved is true and (tg_op='INSERT' or old.approved is distinct from true);
  if not should_send then return new; end if;

  select site_enabled,email_enabled into site_on,email_on
  from public.notification_broadcast_settings where event_key='new_gallery';

  if coalesce(site_on,false) then
    insert into public.notifications(user_id,actor_id,type,title,body,entity_type,entity_id,route)
    select p.id,new.author_id,'new_gallery','New gallery item',
           left(coalesce(nullif(new.caption_en,''),nullif(new.caption_ar,''),'A new gallery item was published.'),180),
           'gallery',new.id::text,'gallery'
    from public.profiles p
    where p.id<>new.author_id and coalesce(p.account_status,'active')='active';
  end if;

  if coalesce(email_on,false) then
    insert into public.email_notification_outbox(user_id,event_key,event_type,subject,preview,action_path)
    select u.id,
           'gallery-approved:'||new.id::text||':'||u.id::text,
           'new_gallery',
           'New gallery item on NEIS Circle',
           left(coalesce(nullif(new.caption_en,''),nullif(new.caption_ar,''),'A new gallery item was published.'),240),
           '/#/gallery'
    from auth.users u
    join public.profiles p on p.id=u.id
    where u.id<>new.author_id
      and coalesce(p.account_status,'active')='active'
      and u.email is not null and u.email_confirmed_at is not null
    on conflict (event_key) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists gallery_broadcast_new_content on public.gallery_items;
create trigger gallery_broadcast_new_content
after insert or update of approved on public.gallery_items
for each row execute function public.broadcast_gallery_approval();

create or replace function public.broadcast_new_circle()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare site_on boolean; email_on boolean;
begin
  if coalesce(new.privacy,'public') <> 'public' then
    return new;
  end if;

  select site_enabled,email_enabled into site_on,email_on
  from public.notification_broadcast_settings where event_key='new_circle';

  if coalesce(site_on,false) then
    insert into public.notifications(user_id,actor_id,type,title,body,entity_type,entity_id,route)
    select p.id,new.owner_id,'new_circle',
           'New Circle: '||coalesce(nullif(new.name,''),'Circle'),
           left(coalesce(nullif(new.description,''),'A new Circle was created.'),180),
           'circle',new.id::text,'circles/'||new.id::text||'/home'
    from public.profiles p
    where p.id<>new.owner_id and coalesce(p.account_status,'active')='active';
  end if;

  if coalesce(email_on,false) then
    insert into public.email_notification_outbox(user_id,event_key,event_type,subject,preview,action_path)
    select u.id,
           'circle-created:'||new.id::text||':'||u.id::text,
           'new_circle',
           'New Circle: '||coalesce(nullif(new.name,''),'Circle'),
           left(coalesce(nullif(new.description,''),'A new Circle was created.'),240),
           '/#/circles/'||new.id::text||'/home'
    from auth.users u
    join public.profiles p on p.id=u.id
    where u.id<>new.owner_id
      and coalesce(p.account_status,'active')='active'
      and u.email is not null and u.email_confirmed_at is not null
    on conflict (event_key) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists circles_notify_new on public.circles;
drop trigger if exists circles_broadcast_new_content on public.circles;
create trigger circles_broadcast_new_content
after insert on public.circles
for each row execute function public.broadcast_new_circle();

create or replace function public.broadcast_new_meeting()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare site_on boolean; email_on boolean; circle_name text;
begin
  select site_enabled,email_enabled into site_on,email_on
  from public.notification_broadcast_settings where event_key='new_meeting';
  select c.name into circle_name from public.circles c where c.id=new.circle_id;

  if coalesce(site_on,false) then
    insert into public.notifications(user_id,actor_id,type,title,body,entity_type,entity_id,route)
    select cm.user_id,new.creator_id,'circle_meeting',
           'New meeting in '||coalesce(circle_name,'Circle'),
           left(coalesce(nullif(new.title,''),'A new meeting was scheduled.'),180),
           'meeting',new.id::text,
           'circles/'||new.circle_id::text||'/meetings?meeting='||new.id::text
    from public.circle_members cm
    where cm.circle_id=new.circle_id
      and cm.status='active'
      and cm.user_id<>new.creator_id;
  end if;

  if coalesce(email_on,false) then
    insert into public.email_notification_outbox(user_id,event_key,event_type,subject,preview,action_path)
    select u.id,
           'meeting-created:'||new.id::text||':'||u.id::text,
           'new_meeting',
           'New meeting in '||coalesce(circle_name,'Circle'),
           left(coalesce(nullif(new.title,''),'A new meeting was scheduled.'),240),
           '/#/circles/'||new.circle_id::text||'/meetings?meeting='||new.id::text
    from public.circle_members cm
    join auth.users u on u.id=cm.user_id
    join public.profiles p on p.id=cm.user_id
    where cm.circle_id=new.circle_id
      and cm.status='active'
      and cm.user_id<>new.creator_id
      and coalesce(p.account_status,'active')='active'
      and u.email is not null and u.email_confirmed_at is not null
    on conflict (event_key) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists circle_meetings_notify_new on public.circle_meetings;
drop trigger if exists circle_meetings_broadcast_new_content on public.circle_meetings;
create trigger circle_meetings_broadcast_new_content
after insert on public.circle_meetings
for each row execute function public.broadcast_new_meeting();

revoke all on function public.broadcast_new_post() from public, anon, authenticated;
revoke all on function public.broadcast_new_article() from public, anon, authenticated;
revoke all on function public.broadcast_new_opportunity() from public, anon, authenticated;
revoke all on function public.broadcast_new_study_resource() from public, anon, authenticated;
revoke all on function public.broadcast_gallery_approval() from public, anon, authenticated;
revoke all on function public.broadcast_new_circle() from public, anon, authenticated;
revoke all on function public.broadcast_new_meeting() from public, anon, authenticated;
