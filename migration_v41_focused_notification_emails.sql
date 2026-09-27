-- NEIS Circle: focused email notifications for articles, opportunities and replies only.
-- Delivery remains server-side through send-notification-email.

alter table public.email_notification_outbox
  drop constraint if exists email_notification_outbox_event_type_check;

alter table public.email_notification_outbox
  add constraint email_notification_outbox_event_type_check
  check (event_type in (
    'admin_post','admin_article','important_activity','important_opportunity',
    'new_article','new_opportunity','reply'
  ));

-- Stop email events that are outside the requested scope.
drop trigger if exists posts_enqueue_admin_email on public.posts;
drop trigger if exists articles_enqueue_admin_email on public.articles;
drop trigger if exists opportunities_enqueue_important_email on public.opportunities;
drop trigger if exists notifications_enqueue_important_email on public.notifications;

create or replace function public.enqueue_new_article_email()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  should_send boolean;
  article_title text;
  article_preview text;
begin
  if tg_op = 'INSERT' then
    should_send := new.status = 'published';
  else
    should_send := new.status = 'published' and old.status is distinct from 'published';
  end if;

  if not should_send then return new; end if;

  article_title := coalesce(nullif(new.title_en,''),nullif(new.title_ar,''),'New article on NEIS Circle');
  article_preview := coalesce(
    nullif(new.excerpt_en,''),
    nullif(new.excerpt_ar,''),
    'A new article is available on NEIS Circle.'
  );

  insert into public.email_notification_outbox(
    user_id,event_key,event_type,subject,preview,action_path
  )
  select
    u.id,
    'article-published:' || new.id::text || ':' || u.id::text,
    'new_article',
    'New article: ' || article_title,
    left(article_preview,240),
    '/#/articles/' || new.id::text
  from auth.users u
  join public.profiles p on p.id = u.id
  where u.id <> new.author_id
    and p.account_status = 'active'
    and u.email is not null
    and u.email_confirmed_at is not null
  on conflict (event_key) do nothing;

  return new;
end;
$$;

create trigger articles_enqueue_new_email
after insert or update of status on public.articles
for each row execute function public.enqueue_new_article_email();

create or replace function public.enqueue_new_opportunity_email()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if new.status <> 'open' then return new; end if;

  insert into public.email_notification_outbox(
    user_id,event_key,event_type,subject,preview,action_path
  )
  select
    u.id,
    'opportunity-created:' || new.id::text || ':' || u.id::text,
    'new_opportunity',
    'New opportunity: ' || coalesce(nullif(new.title,''),'Opportunity on NEIS Circle'),
    left(coalesce(nullif(new.description,''),'A new opportunity is available on NEIS Circle.'),240),
    '/#/opportunities?opportunity=' || new.id::text
  from auth.users u
  join public.profiles p on p.id = u.id
  where u.id <> new.author_id
    and p.account_status = 'active'
    and u.email is not null
    and u.email_confirmed_at is not null
  on conflict (event_key) do nothing;

  return new;
end;
$$;

create trigger opportunities_enqueue_new_email
after insert on public.opportunities
for each row execute function public.enqueue_new_opportunity_email();

create or replace function public.enqueue_reply_notification_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare normalized_route text;
begin
  if new.type not in ('reply','comment_reply','post_comment','article_reply') then
    return new;
  end if;

  normalized_route := coalesce(nullif(trim(both '/' from new.route),''),'notifications');

  insert into public.email_notification_outbox(
    user_id,event_key,event_type,subject,preview,action_path
  )
  values (
    new.user_id,
    'reply-notification:' || new.id::text || ':' || new.user_id::text,
    'reply',
    coalesce(nullif(new.title,''),'New reply on NEIS Circle'),
    left(coalesce(new.body,'Someone replied to your content on NEIS Circle.'),240),
    '/#/' || normalized_route
  )
  on conflict (event_key) do nothing;

  return new;
end;
$$;

create trigger notifications_enqueue_reply_email
after insert on public.notifications
for each row execute function public.enqueue_reply_notification_email();

-- Restore one and only one post-comment notification trigger.
-- This creates the in-app notification consumed by the reply-email trigger above.
drop trigger if exists comments_notify_post_reply on public.comments;
drop trigger if exists comments_notify_reply on public.comments;
create trigger comments_notify_post_reply
after insert on public.comments
for each row execute function public.notify_post_comment();
