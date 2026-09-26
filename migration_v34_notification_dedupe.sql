-- Feature #1: prevent duplicate comment/reply notifications.
-- Root cause: comments INSERT had two notification triggers.
drop trigger if exists comments_notify_reply on public.comments;

-- Preserve the existing eligible email notification types while removing
-- "Important activity / نشاط مهم" from email presentation.
create or replace function public.enqueue_important_notification_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare normalized_route text;
begin
  if new.type not in (
    'reply','article_reply','comment_reply',
    'circle_invite','circle_invitation','membership_request',
    'membership_accepted','membership_rejected','membership_updated'
  ) then
    return new;
  end if;

  normalized_route := coalesce(nullif(trim(both '/' from new.route),''),'notifications');

  insert into public.email_notification_outbox(
    user_id,event_key,event_type,subject,preview,action_path
  )
  values (
    new.user_id,
    'notification:' || new.id::text || ':' || new.user_id::text,
    new.type,
    coalesce(nullif(new.title,''),'NEIS Circle notification'),
    left(coalesce(new.body,'Open NEIS Circle to view the update.'),240),
    '/#/' || normalized_route
  )
  on conflict (event_key) do nothing;

  return new;
end;
$$;
