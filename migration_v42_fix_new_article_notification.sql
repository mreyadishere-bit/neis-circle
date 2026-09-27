-- Fix the existing in-app new-article notification function for the current notifications schema.
-- The notifications table has no event_key column, so dedupe by article/user directly.

create or replace function public.notify_new_article()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  should_notify boolean;
  article_title text;
begin
  if tg_op = 'INSERT' then
    should_notify := new.status = 'published';
  else
    should_notify := new.status = 'published'
      and old.status is distinct from 'published';
  end if;

  if not should_notify then
    return new;
  end if;

  article_title := coalesce(nullif(new.title_en,''), nullif(new.title_ar,''), 'New article');

  insert into public.notifications(
    user_id, actor_id, type, title, body,
    entity_type, entity_id, route
  )
  select
    p.id,
    new.author_id,
    'new_article',
    'New article',
    left(article_title,180),
    'article',
    new.id::text,
    'articles/' || new.id::text
  from public.profiles p
  where p.id <> new.author_id
    and p.account_status = 'active'
    and not exists (
      select 1
      from public.notifications n
      where n.user_id = p.id
        and n.type = 'new_article'
        and n.entity_type = 'article'
        and n.entity_id = new.id::text
    );

  return new;
end;
$$;
