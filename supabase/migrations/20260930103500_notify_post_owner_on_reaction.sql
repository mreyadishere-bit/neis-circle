-- Notify a post owner when another user reacts to their post.
create or replace function public.notify_post_reaction()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  post_owner uuid;
  post_title text;
  actor_name text;
begin
  select p.author_id,coalesce(nullif(p.title,''),'your post')
    into post_owner,post_title
  from public.posts p
  where p.id=new.post_id;

  if post_owner is null or post_owner=new.user_id then
    return new;
  end if;

  select coalesce(nullif(p.full_name,''),nullif(p.username,''),'A student')
    into actor_name
  from public.profiles p
  where p.id=new.user_id;

  insert into public.notifications(
    user_id,actor_id,type,title,body,entity_type,entity_id,route
  )
  values(
    post_owner,
    new.user_id,
    'reaction',
    'New like on your post',
    coalesce(actor_name,'A student')||' liked “'||post_title||'”.',
    'post',
    new.post_id::text,
    'post/'||new.post_id::text
  );

  return new;
end;
$$;

drop trigger if exists reactions_notify_post_owner on public.reactions;
create trigger reactions_notify_post_owner
after insert on public.reactions
for each row
execute function public.notify_post_reaction();

