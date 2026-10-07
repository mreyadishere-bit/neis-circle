-- Keep post/article email delivery manual-only from Content moderation.
-- Site notifications are intentionally unaffected.

update public.system_settings
set enabled=false, updated_at=now()
where setting_key='admin_post_emails_enabled';

drop trigger if exists posts_enqueue_admin_email on public.posts;
drop trigger if exists posts_enqueue_email on public.posts;
drop trigger if exists articles_enqueue_new_email on public.articles;
drop trigger if exists articles_enqueue_admin_email on public.articles;
drop trigger if exists articles_enqueue_email on public.articles;

-- Make legacy auto-email trigger functions harmless even if an old trigger is
-- accidentally recreated later.
create or replace function public.enqueue_admin_post_email()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  return new;
end;
$$;

create or replace function public.enqueue_admin_article_email()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  return new;
end;
$$;

create or replace function public.enqueue_new_article_email()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  return new;
end;
$$;

revoke execute on function public.enqueue_admin_post_email() from public, anon, authenticated;
revoke execute on function public.enqueue_admin_article_email() from public, anon, authenticated;
revoke execute on function public.enqueue_new_article_email() from public, anon, authenticated;

-- Remove only stale automatic post/article jobs on environments receiving
-- this migration. Manual Content moderation jobs use manual-content:* keys
-- and are intentionally preserved.
delete from public.email_notification_outbox
where status in ('pending','failed','sending')
  and (
    event_key like 'admin-post:%'
    or event_key like 'admin-article:%'
    or event_key like 'article-published:%'
    or event_type in ('admin_article','new_article')
  );
