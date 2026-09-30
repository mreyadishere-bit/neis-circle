-- Collapse Circle chat notifications so each user sees at most one active notification per Circle.
-- New messages update the unread notification in place. After it has been read, the next message replaces it with one fresh row.

with ranked as (
  select
    id,
    row_number() over (
      partition by user_id, split_part(route,'/',2)
      order by created_at desc, id desc
    ) as rn
  from public.notifications
  where type='circle_message'
    and route like 'circles/%/chat%'
)
delete from public.notifications n
using ranked r
where n.id=r.id
  and r.rn>1;

update public.notifications n
set
  title='New messages in '||coalesce(c.name,'Circle'),
  body='Open the Circle chat to see the latest messages.',
  entity_type='circle_chat',
  entity_id=c.id::text
from public.circles c
where n.type='circle_message'
  and n.route like 'circles/%/chat%'
  and split_part(n.route,'/',2)=c.id::text;

create or replace function public.notify_circle_chat_message()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  circle_name text;
  recipient record;
  existing_id uuid;
  existing_read_at timestamptz;
  notification_title text;
  notification_body text;
  notification_route text;
begin
  select c.name into circle_name
  from public.circles c
  where c.id=new.circle_id;

  notification_title := 'New messages in '||coalesce(circle_name,'Circle');
  notification_body := 'Open the Circle chat to see the latest messages.';
  notification_route := 'circles/'||new.circle_id::text||'/chat?message='||new.id::text;

  for recipient in
    select cm.user_id
    from public.circle_members cm
    where cm.circle_id=new.circle_id
      and cm.status='active'
      and cm.user_id<>new.sender_id
  loop
    existing_id := null;
    existing_read_at := null;

    select n.id, n.read_at
      into existing_id, existing_read_at
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


-- Trigger-only function: do not expose it as a callable RPC.
revoke execute on function public.notify_circle_chat_message() from public, anon, authenticated;
