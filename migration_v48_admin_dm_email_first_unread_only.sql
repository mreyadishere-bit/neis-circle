
create table if not exists public.admin_dm_email_state (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  last_emailed_at timestamptz not null,
  last_message_id uuid not null references public.messages(id) on delete cascade,
  primary key (conversation_id, recipient_id)
);

alter table public.admin_dm_email_state enable row level security;
revoke all on table public.admin_dm_email_state from anon, authenticated;

insert into public.system_settings(setting_key, enabled)
values ('admin_dm_emails_enabled', true)
on conflict (setting_key) do nothing;

create or replace function public.get_admin_dm_email_setting()
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
    join public.profiles p on p.id=u.id
    where u.id=auth.uid()
      and lower(coalesce(u.email,''))='mreyadishere@gmail.com'
      and p.role='admin'
      and coalesce(p.account_status,'active')='active'
  ) then
    raise exception 'not_authorized';
  end if;

  return coalesce(
    (select enabled from public.system_settings where setting_key='admin_dm_emails_enabled'),
    true
  );
end;
$$;

create or replace function public.set_admin_dm_email_setting(desired_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null or not exists (
    select 1
    from auth.users u
    join public.profiles p on p.id=u.id
    where u.id=auth.uid()
      and lower(coalesce(u.email,''))='mreyadishere@gmail.com'
      and p.role='admin'
      and coalesce(p.account_status,'active')='active'
  ) then
    raise exception 'not_authorized';
  end if;

  insert into public.system_settings(setting_key,enabled,updated_at,updated_by)
  values ('admin_dm_emails_enabled',coalesce(desired_enabled,false),now(),auth.uid())
  on conflict (setting_key) do update
  set enabled=excluded.enabled,updated_at=now(),updated_by=auth.uid();

  return coalesce(desired_enabled,false);
end;
$$;

revoke all on function public.get_admin_dm_email_setting() from public, anon;
revoke all on function public.set_admin_dm_email_setting(boolean) from public, anon;
grant execute on function public.get_admin_dm_email_setting() to authenticated;
grant execute on function public.set_admin_dm_email_setting(boolean) to authenticated;

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
    'content_like'::text,
    'admin_dm'::text
  ]));

create or replace function public.enqueue_admin_dm_email()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  recipient uuid;
  recipient_last_read timestamptz;
  last_emailed timestamptz;
  sender_name text;
begin
  if coalesce(
    (select enabled from public.system_settings where setting_key='admin_dm_emails_enabled'),
    true
  ) is not true then
    return new;
  end if;

  if not exists (
    select 1
    from auth.users u
    join public.profiles p on p.id=u.id
    where u.id=new.sender_id
      and lower(coalesce(u.email,''))='mreyadishere@gmail.com'
      and p.role='admin'
      and coalesce(p.account_status,'active')='active'
  ) then
    return new;
  end if;

  if not exists (
    select 1 from public.conversations c
    where c.id=new.conversation_id and c.kind='direct'
  ) then
    return new;
  end if;

  select cm.user_id,cm.last_read_at
    into recipient,recipient_last_read
  from public.conversation_members cm
  join public.profiles p on p.id=cm.user_id
  join auth.users u on u.id=cm.user_id
  where cm.conversation_id=new.conversation_id
    and cm.user_id<>new.sender_id
    and coalesce(p.account_status,'active')='active'
    and u.email is not null
    and u.email_confirmed_at is not null
  order by cm.joined_at
  limit 1;

  if recipient is null then
    return new;
  end if;

  select s.last_emailed_at
    into last_emailed
  from public.admin_dm_email_state s
  where s.conversation_id=new.conversation_id
    and s.recipient_id=recipient;

  -- If the recipient has not opened/read the conversation since the last
  -- email, suppress all further DM emails. The first unread message wins.
  if last_emailed is not null
     and coalesce(recipient_last_read,'epoch'::timestamptz) < last_emailed then
    return new;
  end if;

  select coalesce(nullif(p.full_name,''),nullif(p.username,''),'NEIS Circle Admin')
    into sender_name
  from public.profiles p
  where p.id=new.sender_id;

  insert into public.email_notification_outbox(
    user_id,event_key,event_type,subject,preview,action_path
  )
  values (
    recipient,
    'admin-dm:'||new.id::text||':'||recipient::text,
    'admin_dm',
    'New message from NEIS Circle · رسالة جديدة',
    left(coalesce(sender_name,'NEIS Circle Admin')||': '||
         coalesce(nullif(new.body,''),'Sent you a new message.'),240),
    '/#/messages/'||new.conversation_id::text
  )
  on conflict (event_key) do nothing;

  insert into public.admin_dm_email_state(
    conversation_id,recipient_id,last_emailed_at,last_message_id
  )
  values (
    new.conversation_id,recipient,new.created_at,new.id
  )
  on conflict (conversation_id,recipient_id) do update
  set last_emailed_at=excluded.last_emailed_at,
      last_message_id=excluded.last_message_id;

  return new;
end;
$$;

revoke all on function public.enqueue_admin_dm_email() from public, anon, authenticated;

drop trigger if exists messages_enqueue_admin_dm_email on public.messages;
create trigger messages_enqueue_admin_dm_email
after insert on public.messages
for each row execute function public.enqueue_admin_dm_email();
