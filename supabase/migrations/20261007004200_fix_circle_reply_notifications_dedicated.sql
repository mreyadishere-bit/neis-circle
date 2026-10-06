-- Keep the production Circle-chat bundling behavior, but give direct replies
-- a dedicated notification for the owner of the replied-to message.

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
  recipient record;
  existing_id bigint;
  existing_read_at timestamptz;
  notification_title text;
  notification_body text;
  notification_route text;
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
    insert into public.notifications(
      user_id,actor_id,type,title,body,entity_type,entity_id,route
    )
    values (
      reply_owner,
      new.sender_id,
      'reply',
      coalesce(sender_name,'A student')||' replied to your message',
      left(coalesce(nullif(new.body,''),'New reply'),140),
      'circle_message',
      new.id::text,
      'circles/'||new.circle_id::text||'/chat?message='||new.id::text
    );
  end if;

  notification_title := 'New messages in '||coalesce(circle_name,'Circle');
  notification_body := 'Open the Circle chat to see the latest messages.';
  notification_route := 'circles/'||new.circle_id::text||'/chat?message='||new.id::text;

  for recipient in
    select cm.user_id
    from public.circle_members cm
    where cm.circle_id=new.circle_id
      and cm.status='active'
      and cm.user_id<>new.sender_id
      and (reply_owner is null or cm.user_id<>reply_owner)
  loop
    existing_id := null;
    existing_read_at := null;

    select n.id,n.read_at
      into existing_id,existing_read_at
    from public.notifications n
    where n.user_id=recipient.user_id
      and n.type='circle_message'
      and (
        (n.entity_type='circle_chat' and n.entity_id=new.circle_id::text)
        or n.route like ('circles/'||new.circle_id::text||'/chat%')
      )
    order by n.created_at desc
    limit 1;

    if existing_id is not null and existing_read_at is null then
      update public.notifications
      set actor_id=new.sender_id,
          title=notification_title,
          body=notification_body,
          entity_type='circle_chat',
          entity_id=new.circle_id::text,
          route=notification_route,
          created_at=now()
      where id=existing_id;
    else
      if existing_id is not null then
        delete from public.notifications where id=existing_id;
      end if;

      insert into public.notifications(
        user_id,actor_id,type,title,body,entity_type,entity_id,route
      ) values(
        recipient.user_id,
        new.sender_id,
        'circle_message',
        notification_title,
        notification_body,
        'circle_chat',
        new.circle_id::text,
        notification_route
      );
    end if;
  end loop;

  return new;
end;
$$;
