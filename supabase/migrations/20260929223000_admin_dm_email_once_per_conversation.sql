create or replace function public.enqueue_admin_dm_email()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  recipient uuid;
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

  select cm.user_id
    into recipient
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

  if exists (
    select 1
    from public.admin_dm_email_state s
    where s.conversation_id=new.conversation_id
      and s.recipient_id=recipient
  ) then
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
    'admin-dm-conversation:'||new.conversation_id::text||':'||recipient::text,
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
  on conflict (conversation_id,recipient_id) do nothing;

  return new;
end;
$$;

revoke all on function public.enqueue_admin_dm_email() from public, anon, authenticated;
