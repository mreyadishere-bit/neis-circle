-- Disable all automatically queued notification emails.
-- Preserve explicit primary-admin Content moderation broadcasts (manual-content:*).
create or replace function public.reject_automatic_notification_email()
returns trigger language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.event_key like 'manual-content:%' then return new; end if;
  return null;
end;
$$;
revoke all on function public.reject_automatic_notification_email() from public, anon, authenticated;
drop trigger if exists reject_automatic_notification_email_insert on public.email_notification_outbox;
create trigger reject_automatic_notification_email_insert
before insert on public.email_notification_outbox
for each row execute function public.reject_automatic_notification_email();
delete from public.email_notification_outbox
where status in ('pending','failed','sending')
and event_key not like 'manual-content:%';
update public.system_settings set enabled=false,updated_at=now()
where setting_key in ('admin_dm_emails_enabled','admin_post_emails_enabled','author_like_emails_enabled');
