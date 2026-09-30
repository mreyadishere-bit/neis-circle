
alter table public.push_preferences
  add column if not exists direct_messages boolean not null default true,
  add column if not exists post_comments_replies boolean not null default true,
  add column if not exists article_comments_replies boolean not null default true,
  add column if not exists post_likes boolean not null default true,
  add column if not exists article_likes boolean not null default true,
  add column if not exists comment_reactions boolean not null default true,
  add column if not exists new_posts boolean not null default true,
  add column if not exists new_articles boolean not null default true,
  add column if not exists new_circles boolean not null default true,
  add column if not exists circle_posts boolean not null default true,
  add column if not exists circle_messages boolean not null default true,
  add column if not exists circle_meetings boolean not null default true,
  add column if not exists circle_membership boolean not null default true,
  add column if not exists followers boolean not null default true;

create or replace function public.notify_new_post()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  author_is_admin boolean:=false;
  circle_name text;
begin
  select exists(select 1 from public.profiles p where p.id=new.author_id and p.role='admin')
    into author_is_admin;

  if new.circle_id is null then
    insert into public.notifications(user_id,actor_id,type,title,body,entity_type,entity_id,route)
    select
      p.id,new.author_id,
      case when author_is_admin then 'admin_post' else 'new_post' end,
      case when author_is_admin then 'New announcement' else 'New post' end,
      left(coalesce(nullif(new.title,''),'A new post was published'),180),
      'post',new.id::text,'post/'||new.id::text
    from public.profiles p
    where p.id<>new.author_id
      and coalesce(p.account_status,'active')='active';
  else
    select c.name into circle_name from public.circles c where c.id=new.circle_id;
    insert into public.notifications(user_id,actor_id,type,title,body,entity_type,entity_id,route)
    select
      cm.user_id,new.author_id,'circle_post',
      'New post in '||coalesce(circle_name,'your Circle'),
      left(coalesce(nullif(new.title,''),'A new Circle post was published'),180),
      'post',new.id::text,
      'circles/'||new.circle_id::text||'/home?post='||new.id::text
    from public.circle_members cm
    where cm.circle_id=new.circle_id
      and cm.status in ('active','muted')
      and cm.user_id<>new.author_id;
  end if;
  return new;
end;
$$;

create or replace function public.notify_new_circle()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  insert into public.notifications(user_id,actor_id,type,title,body,entity_type,entity_id,route)
  select
    p.id,new.owner_id,'new_circle','New Circle',
    left(coalesce(nullif(new.name,''),'A new Circle was created'),180),
    'circle',new.id::text,'circles/'||new.id::text||'/home'
  from public.profiles p
  where p.id<>new.owner_id
    and coalesce(p.account_status,'active')='active';
  return new;
end;
$$;

drop trigger if exists circles_notify_new on public.circles;
create trigger circles_notify_new
after insert on public.circles
for each row execute function public.notify_new_circle();

create or replace function public.notify_article_like()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  article_owner uuid;
  article_title text;
  liker_name text;
begin
  select a.author_id,coalesce(nullif(a.title_en,''),nullif(a.title_ar,''),'Article')
    into article_owner,article_title
  from public.articles a where a.id=new.article_id and a.status='published';
  if article_owner is null or article_owner=new.user_id then return new; end if;

  select coalesce(nullif(p.full_name,''),nullif(p.username,''),'A student')
    into liker_name from public.profiles p where p.id=new.user_id;

  insert into public.notifications(user_id,actor_id,type,title,body,entity_type,entity_id,route)
  values(
    article_owner,new.user_id,'reaction','New like on your article',
    coalesce(liker_name,'A student')||' liked “'||article_title||'”.',
    'article',new.article_id::text,'articles/'||new.article_id::text
  );
  return new;
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
      else case category_value
        when 'messages' then prefs.messages
        when 'replies' then prefs.replies
        when 'circles' then prefs.circles
        when 'social' then prefs.social
        when 'announcements' then prefs.announcements
        when 'reactions' then prefs.reactions
        else true end
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
      else case category_value
        when 'messages' then prefs.messages
        when 'replies' then prefs.replies
        when 'circles' then prefs.circles
        when 'social' then prefs.social
        when 'announcements' then prefs.announcements
        when 'reactions' then prefs.reactions
        else true end
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
