-- NEIS Circle v33: persist post/comment reply notifications at the database layer.

create or replace function public.notify_post_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  post_owner uuid;
  post_title text;
  parent_owner uuid;
  commenter_name text;
begin
  select p.author_id, coalesce(nullif(p.title,''),'Post')
    into post_owner, post_title
  from public.posts p
  where p.id = new.post_id;

  if post_owner is null then return new; end if;

  select coalesce(nullif(profile.full_name,''),nullif(profile.username,''),'A student')
    into commenter_name
  from public.profiles profile
  where profile.id = new.author_id;

  if post_owner <> new.author_id then
    insert into public.notifications(user_id,actor_id,type,title,body,entity_type,entity_id,route)
    values (
      post_owner,
      new.author_id,
      'reply',
      case when new.parent_id is null then 'New reply to your post' else 'New reply in your discussion' end,
      coalesce(commenter_name,'A student') || ' replied to “' || post_title || '”.',
      'post',
      new.post_id::text,
      'post/' || new.post_id::text
    );
  end if;

  if new.parent_id is not null then
    select c.author_id into parent_owner
    from public.comments c
    where c.id = new.parent_id and c.post_id = new.post_id;

    if parent_owner is not null
       and parent_owner <> new.author_id
       and parent_owner is distinct from post_owner then
      insert into public.notifications(user_id,actor_id,type,title,body,entity_type,entity_id,route)
      values (
        parent_owner,
        new.author_id,
        'comment_reply',
        'New reply to your comment',
        coalesce(commenter_name,'A student') || ' replied to your comment on “' || post_title || '”.',
        'comment',
        new.id::text,
        'post/' || new.post_id::text
      );
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists comments_notify_reply on public.comments;
create trigger comments_notify_reply
after insert on public.comments
for each row execute function public.notify_post_comment();

