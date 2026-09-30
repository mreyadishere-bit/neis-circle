-- NEIS Circle v137 — exact notification targets and comment-edit alerts.
-- Mirrors the production migration applied on 2026-09-30.

create or replace function public.notify_post_comment()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  post_owner uuid;
  post_title text;
  parent_owner uuid;
  commenter_name text;
begin
  select p.author_id,coalesce(nullif(p.title,''),'Post')
    into post_owner,post_title
  from public.posts p
  where p.id=new.post_id;

  if post_owner is null then return new; end if;

  select coalesce(nullif(profile.full_name,''),nullif(profile.username,''),'A student')
    into commenter_name
  from public.profiles profile
  where profile.id=new.author_id;

  if post_owner<>new.author_id then
    insert into public.notifications(user_id,actor_id,type,title,body,entity_type,entity_id,route)
    values (
      post_owner,new.author_id,'reply',
      case when new.parent_id is null then 'New reply to your post' else 'New reply in your discussion' end,
      coalesce(commenter_name,'A student')||' replied to “'||post_title||'”.',
      'comment',new.id::text,
      'post/'||new.post_id::text||'?comment='||new.id::text
    );
  end if;

  if new.parent_id is not null then
    select c.author_id into parent_owner
    from public.comments c
    where c.id=new.parent_id and c.post_id=new.post_id;

    if parent_owner is not null
       and parent_owner<>new.author_id
       and parent_owner is distinct from post_owner then
      insert into public.notifications(user_id,actor_id,type,title,body,entity_type,entity_id,route)
      values (
        parent_owner,new.author_id,'comment_reply',
        'New reply to your comment',
        coalesce(commenter_name,'A student')||' replied to your comment on “'||post_title||'”.',
        'comment',new.id::text,
        'post/'||new.post_id::text||'?comment='||new.id::text
      );
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.notify_article_comment()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  article_owner uuid;
  article_title text;
  parent_owner uuid;
  commenter_name text;
begin
  select a.author_id,coalesce(nullif(a.title_en,''),nullif(a.title_ar,''),'Article')
    into article_owner,article_title
  from public.articles a
  where a.id=new.article_id and a.status='published';

  if article_owner is null then return new; end if;

  select coalesce(nullif(p.full_name,''),nullif(p.username,''),'A student')
    into commenter_name
  from public.profiles p
  where p.id=new.author_id;

  if article_owner<>new.author_id then
    insert into public.notifications(user_id,actor_id,type,title,body,entity_type,entity_id,route)
    values (
      article_owner,new.author_id,'reply',
      case when new.parent_id is null then 'New article comment' else 'New reply on your article' end,
      coalesce(commenter_name,'A student')||' commented on “'||article_title||'”.',
      'article_comment',new.id::text,
      'articles/'||new.article_id::text||'?comment='||new.id::text
    );
  end if;

  if new.parent_id is not null then
    select c.author_id into parent_owner
    from public.article_comments c
    where c.id=new.parent_id;

    if parent_owner is not null
       and parent_owner<>new.author_id
       and parent_owner is distinct from article_owner then
      insert into public.notifications(user_id,actor_id,type,title,body,entity_type,entity_id,route)
      values (
        parent_owner,new.author_id,'comment_reply',
        'New reply to your comment',
        coalesce(commenter_name,'A student')||' replied to your comment on “'||article_title||'”.',
        'article_comment',new.id::text,
        'articles/'||new.article_id::text||'?comment='||new.id::text
      );
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.notify_post_comment_edit()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  post_owner uuid;
  post_title text;
  parent_owner uuid;
  editor_id uuid:=coalesce(auth.uid(),new.author_id);
  editor_name text;
begin
  if new.body is not distinct from old.body then return new; end if;

  select p.author_id,coalesce(nullif(p.title,''),'Post')
    into post_owner,post_title
  from public.posts p
  where p.id=new.post_id;

  select coalesce(nullif(p.full_name,''),nullif(p.username,''),'A student')
    into editor_name
  from public.profiles p
  where p.id=editor_id;

  if post_owner is not null and post_owner<>editor_id then
    insert into public.notifications(user_id,actor_id,type,title,body,entity_type,entity_id,route)
    values (
      post_owner,editor_id,'comment_edit',
      case when new.parent_id is null then 'Comment edited on your post' else 'Reply edited in your discussion' end,
      coalesce(editor_name,'A student')||' edited a comment on “'||post_title||'”.',
      'comment',new.id::text,
      'post/'||new.post_id::text||'?comment='||new.id::text
    );
  end if;

  if new.parent_id is not null then
    select c.author_id into parent_owner
    from public.comments c
    where c.id=new.parent_id and c.post_id=new.post_id;

    if parent_owner is not null
       and parent_owner<>editor_id
       and parent_owner is distinct from post_owner then
      insert into public.notifications(user_id,actor_id,type,title,body,entity_type,entity_id,route)
      values (
        parent_owner,editor_id,'comment_edit',
        'A reply to your comment was edited',
        coalesce(editor_name,'A student')||' edited their reply on “'||post_title||'”.',
        'comment',new.id::text,
        'post/'||new.post_id::text||'?comment='||new.id::text
      );
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists comments_notify_edit on public.comments;
create trigger comments_notify_edit
after update of body on public.comments
for each row
when (old.body is distinct from new.body)
execute function public.notify_post_comment_edit();

create or replace function public.notify_article_comment_edit()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  article_owner uuid;
  article_title text;
  parent_owner uuid;
  editor_id uuid:=coalesce(auth.uid(),new.author_id);
  editor_name text;
begin
  if new.body is not distinct from old.body then return new; end if;

  select a.author_id,coalesce(nullif(a.title_en,''),nullif(a.title_ar,''),'Article')
    into article_owner,article_title
  from public.articles a
  where a.id=new.article_id;

  select coalesce(nullif(p.full_name,''),nullif(p.username,''),'A student')
    into editor_name
  from public.profiles p
  where p.id=editor_id;

  if article_owner is not null and article_owner<>editor_id then
    insert into public.notifications(user_id,actor_id,type,title,body,entity_type,entity_id,route)
    values (
      article_owner,editor_id,'article_comment_edit',
      case when new.parent_id is null then 'Comment edited on your article' else 'Reply edited on your article' end,
      coalesce(editor_name,'A student')||' edited a comment on “'||article_title||'”.',
      'article_comment',new.id::text,
      'articles/'||new.article_id::text||'?comment='||new.id::text
    );
  end if;

  if new.parent_id is not null then
    select c.author_id into parent_owner
    from public.article_comments c
    where c.id=new.parent_id;

    if parent_owner is not null
       and parent_owner<>editor_id
       and parent_owner is distinct from article_owner then
      insert into public.notifications(user_id,actor_id,type,title,body,entity_type,entity_id,route)
      values (
        parent_owner,editor_id,'article_comment_edit',
        'A reply to your article comment was edited',
        coalesce(editor_name,'A student')||' edited their reply on “'||article_title||'”.',
        'article_comment',new.id::text,
        'articles/'||new.article_id::text||'?comment='||new.id::text
      );
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists article_comments_notify_edit on public.article_comments;
create trigger article_comments_notify_edit
after update of body on public.article_comments
for each row
when (old.body is distinct from new.body)
execute function public.notify_article_comment_edit();

create or replace function public.notify_message()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  insert into public.notifications(user_id,actor_id,type,title,body,entity_type,entity_id,route)
  select cm.user_id,new.sender_id,'message','New message',left(new.body,120),
         'message',new.id::text,
         'messages/'||new.conversation_id::text||'?message='||new.id::text
  from public.conversation_members cm
  where cm.conversation_id=new.conversation_id
    and cm.user_id<>new.sender_id;

  update public.conversations
  set updated_at=new.created_at
  where id=new.conversation_id;

  return new;
end;
$$;

create or replace function public.notify_circle_chat_message()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  circle_name text;
  sender_name text;
begin
  select c.name into circle_name
  from public.circles c where c.id=new.circle_id;

  select coalesce(nullif(p.full_name,''),nullif(p.username,''),'A student')
    into sender_name
  from public.profiles p where p.id=new.sender_id;

  insert into public.notifications(user_id,actor_id,type,title,body,entity_type,entity_id,route)
  select cm.user_id,new.sender_id,'circle_message',
         'New message in '||coalesce(circle_name,'Circle'),
         coalesce(sender_name,'A student')||': '||left(coalesce(new.body,'New message'),140),
         'circle_message',new.id::text,
         'circles/'||new.circle_id::text||'/chat?message='||new.id::text
  from public.circle_members cm
  where cm.circle_id=new.circle_id
    and cm.status='active'
    and cm.user_id<>new.sender_id;

  return new;
end;
$$;

update public.notifications
set route=route||case when position('?' in route)>0 then '&' else '?' end||'comment='||entity_id
where entity_type='comment'
  and coalesce(entity_id,'')<>''
  and route like 'post/%'
  and route not like '%comment=%';

update public.notifications
set route=route||case when position('?' in route)>0 then '&' else '?' end||'comment='||entity_id
where entity_type='article_comment'
  and coalesce(entity_id,'')<>''
  and route like 'articles/%'
  and route not like '%comment=%';

update public.notifications
set route=route||case when position('?' in route)>0 then '&' else '?' end||'message='||entity_id
where entity_type='circle_message'
  and coalesce(entity_id,'')<>''
  and route like 'circles/%/chat%'
  and route not like '%message=%';
