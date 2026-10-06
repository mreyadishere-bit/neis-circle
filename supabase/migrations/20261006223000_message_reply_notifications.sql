-- NEIS Circle — special notifications when someone replies directly to your chat message.
-- Reuses the existing notifications table, realtime listener, deep links, and push routing.

create or replace function public.notify_message()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  sender_name text;
begin
  select coalesce(nullif(p.full_name,''),nullif(p.username,''),'A student')
    into sender_name
  from public.profiles p
  where p.id=new.sender_id;

  insert into public.notifications(user_id,actor_id,type,title,body,entity_type,entity_id,route)
  select
    cm.user_id,
    new.sender_id,
    case
      when new.reply_to_id is not null
       and exists (
         select 1
         from public.messages parent
         where parent.id=new.reply_to_id
           and parent.conversation_id=new.conversation_id
           and parent.sender_id=cm.user_id
       )
      then 'reply'
      else 'message'
    end,
    case
      when new.reply_to_id is not null
       and exists (
         select 1
         from public.messages parent
         where parent.id=new.reply_to_id
           and parent.conversation_id=new.conversation_id
           and parent.sender_id=cm.user_id
       )
      then coalesce(sender_name,'A student')||' replied to your message'
      else 'New message'
    end,
    left(coalesce(new.body,'New message'),140),
    'message',
    new.id::text,
    'messages/'||new.conversation_id::text||'?message='||new.id::text
  from public.conversation_members cm
  where cm.conversation_id=new.conversation_id
    and cm.user_id<>new.sender_id;

  update public.conversations
  set updated_at=new.created_at
  where id=new.conversation_id;

  return new;
end;
$$;

create or replace function public.notify_circle_chat_message()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  circle_name text;
  sender_name text;
  reply_owner uuid;
begin
  select c.name into circle_name
  from public.circles c
  where c.id=new.circle_id;

  select coalesce(nullif(p.full_name,''),nullif(p.username,''),'A student')
    into sender_name
  from public.profiles p
  where p.id=new.sender_id;

  if new.reply_to_id is not null then
    select m.sender_id
      into reply_owner
    from public.circle_messages m
    where m.id=new.reply_to_id
      and m.circle_id=new.circle_id;
  end if;

  if reply_owner is not null and reply_owner<>new.sender_id then
    insert into public.notifications(user_id,actor_id,type,title,body,entity_type,entity_id,route)
    values (
      reply_owner,
      new.sender_id,
      'reply',
      coalesce(sender_name,'A student')||' replied to your message',
      left(coalesce(new.body,'New reply'),140),
      'circle_message',
      new.id::text,
      'circles/'||new.circle_id::text||'/chat?message='||new.id::text
    );
  end if;

  insert into public.notifications(user_id,actor_id,type,title,body,entity_type,entity_id,route)
  select
    cm.user_id,
    new.sender_id,
    'circle_message',
    'New message in '||coalesce(circle_name,'Circle'),
    coalesce(sender_name,'A student')||': '||left(coalesce(new.body,'New message'),140),
    'circle_message',
    new.id::text,
    'circles/'||new.circle_id::text||'/chat?message='||new.id::text
  from public.circle_members cm
  where cm.circle_id=new.circle_id
    and cm.status='active'
    and cm.user_id<>new.sender_id
    and (reply_owner is null or cm.user_id<>reply_owner);

  return new;
end;
$$;
