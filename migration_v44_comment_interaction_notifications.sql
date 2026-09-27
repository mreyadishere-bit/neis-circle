-- Database-side in-site notifications for comment likes and creator hearts.
-- Keeps existing reply notifications and the existing notifications Realtime channel unchanged.

create or replace function public.notify_comment_like_interaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  comment_owner uuid;
  target_post uuid;
  target_parent uuid;
  actor_name text;
  preview text;
begin
  select c.author_id, c.post_id, c.parent_id,
         left(replace(replace(c.body, E'\n', ' '), E'\r', ' '), 80)
    into comment_owner, target_post, target_parent, preview
  from public.comments c
  where c.id = new.comment_id
    and c.deleted_at is null;

  if comment_owner is null or comment_owner = new.user_id then
    return new;
  end if;

  select coalesce(nullif(p.full_name,''), nullif(p.username,''), 'A student')
    into actor_name
  from public.profiles p
  where p.id = new.user_id;

  if not exists (
    select 1
    from public.notifications n
    where n.user_id = comment_owner
      and n.actor_id = new.user_id
      and n.type = 'comment_like'
      and n.entity_type = 'comment'
      and n.entity_id = new.comment_id::text
  ) then
    insert into public.notifications(
      user_id, actor_id, type, title, body, entity_type, entity_id, route
    )
    values (
      comment_owner,
      new.user_id,
      'comment_like',
      case when target_parent is null then 'New like on your comment' else 'New like on your reply' end,
      coalesce(actor_name,'A student') ||
        case when target_parent is null then ' liked your comment' else ' liked your reply' end ||
        case when nullif(trim(preview),'') is null then '.' else ': “' || preview || case when length(preview) >= 80 then '…' else '' end || '”' end,
      'comment',
      new.comment_id::text,
      'post/' || target_post::text
    );
  end if;

  return new;
end;
$$;

revoke all on function public.notify_comment_like_interaction() from public, anon, authenticated;

drop trigger if exists comment_likes_notify on public.comment_likes;
create trigger comment_likes_notify
after insert on public.comment_likes
for each row execute function public.notify_comment_like_interaction();

create or replace function public.notify_comment_creator_heart_interaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  comment_owner uuid;
  target_post uuid;
  target_parent uuid;
  post_owner uuid;
  actor_name text;
  preview text;
begin
  select c.author_id, c.post_id, c.parent_id, p.author_id,
         left(replace(replace(c.body, E'\n', ' '), E'\r', ' '), 80)
    into comment_owner, target_post, target_parent, post_owner, preview
  from public.comments c
  join public.posts p on p.id = c.post_id
  where c.id = new.comment_id
    and c.deleted_at is null;

  if comment_owner is null
     or comment_owner = new.creator_id
     or post_owner is distinct from new.creator_id then
    return new;
  end if;

  select coalesce(nullif(p.full_name,''), nullif(p.username,''), 'A student')
    into actor_name
  from public.profiles p
  where p.id = new.creator_id;

  if not exists (
    select 1
    from public.notifications n
    where n.user_id = comment_owner
      and n.actor_id = new.creator_id
      and n.type = 'comment_heart'
      and n.entity_type = 'comment'
      and n.entity_id = new.comment_id::text
  ) then
    insert into public.notifications(
      user_id, actor_id, type, title, body, entity_type, entity_id, route
    )
    values (
      comment_owner,
      new.creator_id,
      'comment_heart',
      case when target_parent is null then 'Your comment received a creator heart' else 'Your reply received a creator heart' end,
      coalesce(actor_name,'A student') ||
        case when target_parent is null then ' loved your comment ❤️' else ' loved your reply ❤️' end ||
        case when nullif(trim(preview),'') is null then '' else ' “' || preview || case when length(preview) >= 80 then '…' else '' end || '”' end,
      'comment',
      new.comment_id::text,
      'post/' || target_post::text
    );
  end if;

  return new;
end;
$$;

revoke all on function public.notify_comment_creator_heart_interaction() from public, anon, authenticated;

drop trigger if exists comment_creator_hearts_notify on public.comment_creator_hearts;
create trigger comment_creator_hearts_notify
after insert on public.comment_creator_hearts
for each row execute function public.notify_comment_creator_heart_interaction();

create or replace function public.notify_article_comment_like_interaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  comment_owner uuid;
  target_article bigint;
  target_parent uuid;
  actor_name text;
  preview text;
begin
  select c.author_id, c.article_id, c.parent_id,
         left(replace(replace(c.body, E'\n', ' '), E'\r', ' '), 80)
    into comment_owner, target_article, target_parent, preview
  from public.article_comments c
  where c.id = new.comment_id;

  if comment_owner is null or comment_owner = new.user_id then
    return new;
  end if;

  select coalesce(nullif(p.full_name,''), nullif(p.username,''), 'A student')
    into actor_name
  from public.profiles p
  where p.id = new.user_id;

  if not exists (
    select 1
    from public.notifications n
    where n.user_id = comment_owner
      and n.actor_id = new.user_id
      and n.type = 'article_comment_like'
      and n.entity_type = 'article_comment'
      and n.entity_id = new.comment_id::text
  ) then
    insert into public.notifications(
      user_id, actor_id, type, title, body, entity_type, entity_id, route
    )
    values (
      comment_owner,
      new.user_id,
      'article_comment_like',
      case when target_parent is null then 'New like on your article comment' else 'New like on your article reply' end,
      coalesce(actor_name,'A student') ||
        case when target_parent is null then ' liked your article comment' else ' liked your article reply' end ||
        case when nullif(trim(preview),'') is null then '.' else ': “' || preview || case when length(preview) >= 80 then '…' else '' end || '”' end,
      'article_comment',
      new.comment_id::text,
      'articles/' || target_article::text
    );
  end if;

  return new;
end;
$$;

revoke all on function public.notify_article_comment_like_interaction() from public, anon, authenticated;

drop trigger if exists article_comment_likes_notify on public.article_comment_likes;
create trigger article_comment_likes_notify
after insert on public.article_comment_likes
for each row execute function public.notify_article_comment_like_interaction();

create or replace function public.notify_article_comment_creator_heart_interaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  comment_owner uuid;
  target_article bigint;
  target_parent uuid;
  article_owner uuid;
  actor_name text;
  preview text;
begin
  select c.author_id, c.article_id, c.parent_id, a.author_id,
         left(replace(replace(c.body, E'\n', ' '), E'\r', ' '), 80)
    into comment_owner, target_article, target_parent, article_owner, preview
  from public.article_comments c
  join public.articles a on a.id = c.article_id
  where c.id = new.comment_id;

  if comment_owner is null
     or comment_owner = new.creator_id
     or article_owner is distinct from new.creator_id then
    return new;
  end if;

  select coalesce(nullif(p.full_name,''), nullif(p.username,''), 'A student')
    into actor_name
  from public.profiles p
  where p.id = new.creator_id;

  if not exists (
    select 1
    from public.notifications n
    where n.user_id = comment_owner
      and n.actor_id = new.creator_id
      and n.type = 'article_comment_heart'
      and n.entity_type = 'article_comment'
      and n.entity_id = new.comment_id::text
  ) then
    insert into public.notifications(
      user_id, actor_id, type, title, body, entity_type, entity_id, route
    )
    values (
      comment_owner,
      new.creator_id,
      'article_comment_heart',
      case when target_parent is null then 'Your article comment received a creator heart' else 'Your article reply received a creator heart' end,
      coalesce(actor_name,'A student') ||
        case when target_parent is null then ' loved your article comment ❤️' else ' loved your article reply ❤️' end ||
        case when nullif(trim(preview),'') is null then '' else ' “' || preview || case when length(preview) >= 80 then '…' else '' end || '”' end,
      'article_comment',
      new.comment_id::text,
      'articles/' || target_article::text
    );
  end if;

  return new;
end;
$$;

revoke all on function public.notify_article_comment_creator_heart_interaction() from public, anon, authenticated;

drop trigger if exists article_comment_creator_hearts_notify on public.article_comment_creator_hearts;
create trigger article_comment_creator_hearts_notify
after insert on public.article_comment_creator_hearts
for each row execute function public.notify_article_comment_creator_heart_interaction();
