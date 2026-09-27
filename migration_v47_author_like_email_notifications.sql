
create table if not exists public.system_settings (
  setting_key text primary key,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid null references public.profiles(id) on delete set null
);

alter table public.system_settings enable row level security;
revoke all on table public.system_settings from anon, authenticated;

insert into public.system_settings(setting_key, enabled)
values ('author_like_emails_enabled', true)
on conflict (setting_key) do nothing;

create or replace function public.get_author_like_email_setting()
returns boolean
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null or not exists (
    select 1
    from auth.users u
    join public.profiles p on p.id = u.id
    where u.id = auth.uid()
      and lower(coalesce(u.email,'')) = 'mreyadishere@gmail.com'
      and p.role = 'admin'
      and coalesce(p.account_status,'active') = 'active'
  ) then
    raise exception 'not_authorized';
  end if;

  return coalesce(
    (select s.enabled
     from public.system_settings s
     where s.setting_key = 'author_like_emails_enabled'),
    true
  );
end;
$$;

create or replace function public.set_author_like_email_setting(desired_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null or not exists (
    select 1
    from auth.users u
    join public.profiles p on p.id = u.id
    where u.id = auth.uid()
      and lower(coalesce(u.email,'')) = 'mreyadishere@gmail.com'
      and p.role = 'admin'
      and coalesce(p.account_status,'active') = 'active'
  ) then
    raise exception 'not_authorized';
  end if;

  insert into public.system_settings(setting_key, enabled, updated_at, updated_by)
  values ('author_like_emails_enabled', coalesce(desired_enabled,false), now(), auth.uid())
  on conflict (setting_key) do update
    set enabled = excluded.enabled,
        updated_at = now(),
        updated_by = auth.uid();

  return coalesce(desired_enabled,false);
end;
$$;

revoke all on function public.get_author_like_email_setting() from public, anon;
revoke all on function public.set_author_like_email_setting(boolean) from public, anon;
grant execute on function public.get_author_like_email_setting() to authenticated;
grant execute on function public.set_author_like_email_setting(boolean) to authenticated;

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
    'content_like'::text
  ]));

create or replace function public.enqueue_public_post_like_email()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  content_owner uuid;
  content_title text;
  liker_name text;
begin
  if new.reaction <> 'helpful' then
    return new;
  end if;

  if coalesce(
    (select enabled from public.system_settings
     where setting_key = 'author_like_emails_enabled'),
    true
  ) is not true then
    return new;
  end if;

  select p.author_id, coalesce(nullif(p.title,''),'Your post')
    into content_owner, content_title
  from public.posts p
  where p.id = new.post_id
    and p.circle_id is null;

  if content_owner is null or content_owner = new.user_id then
    return new;
  end if;

  if not exists (
    select 1
    from public.profiles pr
    join auth.users u on u.id = pr.id
    where pr.id = content_owner
      and coalesce(pr.account_status,'active') = 'active'
      and u.email is not null
      and u.email_confirmed_at is not null
  ) then
    return new;
  end if;

  select coalesce(nullif(pr.full_name,''),nullif(pr.username,''),'A student')
    into liker_name
  from public.profiles pr
  where pr.id = new.user_id;

  insert into public.email_notification_outbox(
    user_id,event_key,event_type,subject,preview,action_path
  )
  values (
    content_owner,
    'public-post-like:' || new.post_id::text || ':' || new.user_id::text,
    'content_like',
    'Someone liked your post · إعجاب جديد على منشورك',
    left(coalesce(liker_name,'A student') || ' liked “' || content_title || '”.',240),
    '/#/post/' || new.post_id::text
  )
  on conflict (event_key) do nothing;

  return new;
end;
$$;

create or replace function public.enqueue_article_like_email()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  content_owner uuid;
  content_title text;
  liker_name text;
begin
  if coalesce(
    (select enabled from public.system_settings
     where setting_key = 'author_like_emails_enabled'),
    true
  ) is not true then
    return new;
  end if;

  select a.author_id,
         coalesce(nullif(a.title_en,''),nullif(a.title_ar,''),'Your article')
    into content_owner, content_title
  from public.articles a
  where a.id = new.article_id
    and a.status = 'published';

  if content_owner is null or content_owner = new.user_id then
    return new;
  end if;

  if not exists (
    select 1
    from public.profiles pr
    join auth.users u on u.id = pr.id
    where pr.id = content_owner
      and coalesce(pr.account_status,'active') = 'active'
      and u.email is not null
      and u.email_confirmed_at is not null
  ) then
    return new;
  end if;

  select coalesce(nullif(pr.full_name,''),nullif(pr.username,''),'A student')
    into liker_name
  from public.profiles pr
  where pr.id = new.user_id;

  insert into public.email_notification_outbox(
    user_id,event_key,event_type,subject,preview,action_path
  )
  values (
    content_owner,
    'article-like:' || new.article_id::text || ':' || new.user_id::text,
    'content_like',
    'Someone liked your article · إعجاب جديد على مقالك',
    left(coalesce(liker_name,'A student') || ' liked “' || content_title || '”.',240),
    '/#/articles/' || new.article_id::text
  )
  on conflict (event_key) do nothing;

  return new;
end;
$$;

revoke all on function public.enqueue_public_post_like_email() from public, anon, authenticated;
revoke all on function public.enqueue_article_like_email() from public, anon, authenticated;

drop trigger if exists reactions_enqueue_author_like_email on public.reactions;
create trigger reactions_enqueue_author_like_email
after insert on public.reactions
for each row execute function public.enqueue_public_post_like_email();

drop trigger if exists article_reactions_enqueue_author_like_email on public.article_reactions;
create trigger article_reactions_enqueue_author_like_email
after insert on public.article_reactions
for each row execute function public.enqueue_article_like_email();
