-- NEIS Circle v31: server-only transactional email notification outbox.
-- Delivery is performed by supabase/functions/send-notification-email.

create table if not exists public.email_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_key text not null unique,
  event_type text not null check (event_type in ('direct_message','admin_post','admin_article')),
  subject text not null,
  preview text not null default '',
  action_path text not null,
  status text not null default 'pending' check (status in ('pending','sending','sent','failed')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists email_notification_outbox_pending_idx
  on public.email_notification_outbox(status,next_attempt_at,created_at);

alter table public.email_notification_outbox enable row level security;
revoke all on public.email_notification_outbox from anon, authenticated;
grant all on public.email_notification_outbox to service_role;

create or replace function public.enqueue_direct_message_email()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare sender_name text;
begin
  select coalesce(nullif(full_name,''),nullif(username,''),'NEIS student')
  into sender_name from public.profiles where id = new.sender_id;

  insert into public.email_notification_outbox(user_id,event_key,event_type,subject,preview,action_path)
  select cm.user_id,
         'direct-message:' || new.id::text || ':' || cm.user_id::text,
         'direct_message',
         'New message from ' || coalesce(sender_name,'NEIS student') || ' · رسالة جديدة',
         left(new.body,240),
         '/#/messages/' || new.conversation_id::text
  from public.conversation_members cm
  where cm.conversation_id = new.conversation_id
    and cm.user_id <> new.sender_id
  on conflict (event_key) do nothing;
  return new;
end;
$$;

drop trigger if exists messages_enqueue_email on public.messages;
create trigger messages_enqueue_email
after insert on public.messages
for each row execute function public.enqueue_direct_message_email();

create or replace function public.enqueue_admin_post_email()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not exists (select 1 from public.profiles where id = new.author_id and role = 'admin') then
    return new;
  end if;

  insert into public.email_notification_outbox(user_id,event_key,event_type,subject,preview,action_path)
  select u.id,
         'admin-post:' || new.id::text || ':' || u.id::text,
         'admin_post',
         coalesce(nullif(new.title,''),'New post from NEIS Circle') || ' · منشور جديد',
         left(new.body,240),
         '/#/post/' || new.id::text
  from auth.users u
  join public.profiles p on p.id = u.id
  where u.id <> new.author_id
    and u.email is not null
    and u.email_confirmed_at is not null
  on conflict (event_key) do nothing;
  return new;
end;
$$;

drop trigger if exists posts_enqueue_admin_email on public.posts;
create trigger posts_enqueue_admin_email
after insert on public.posts
for each row execute function public.enqueue_admin_post_email();

create or replace function public.enqueue_admin_article_email()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare should_send boolean;
declare article_title text;
declare article_preview text;
begin
  if tg_op = 'INSERT' then
    should_send := new.status = 'published';
  else
    should_send := new.status = 'published' and old.status is distinct from 'published';
  end if;
  if not should_send or not exists (select 1 from public.profiles where id = new.author_id and role = 'admin') then
    return new;
  end if;

  article_title := coalesce(nullif(new.title_en,''),nullif(new.title_ar,''),'New article from NEIS Circle');
  article_preview := coalesce(nullif(new.excerpt_en,''),nullif(new.excerpt_ar,''),'A new article is available on NEIS Circle.');
  insert into public.email_notification_outbox(user_id,event_key,event_type,subject,preview,action_path)
  select u.id,
         'admin-article:' || new.id::text || ':' || u.id::text,
         'admin_article',
         article_title || ' · مقال جديد',
         left(article_preview,240),
         '/#/articles/' || new.id::text
  from auth.users u
  join public.profiles p on p.id = u.id
  where u.id <> new.author_id
    and u.email is not null
    and u.email_confirmed_at is not null
  on conflict (event_key) do nothing;
  return new;
end;
$$;

drop trigger if exists articles_enqueue_admin_email on public.articles;
create trigger articles_enqueue_admin_email
after insert or update of status on public.articles
for each row execute function public.enqueue_admin_article_email();

comment on table public.email_notification_outbox is
  'Private delivery queue. Never exposed to client roles; only the email worker may read it.';
