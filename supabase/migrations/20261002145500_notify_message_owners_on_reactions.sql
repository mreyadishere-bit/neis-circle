create or replace function public.notify_message_reaction()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  recipient_id uuid;
  actor_name text;
  target_route text;
  target_title text;
begin
  if tg_op='DELETE' then
    delete from public.notifications
    where type='reaction'
      and entity_type='message_reaction'
      and entity_id=old.id::text;
    return old;
  end if;

  select coalesce(nullif(p.full_name,''),nullif(p.username,''),'A student')
    into actor_name
  from public.profiles p
  where p.id=new.user_id;

  if new.dm_message_id is not null then
    select m.sender_id,
           'messages/'||m.conversation_id::text||'?message='||m.id::text
      into recipient_id,target_route
    from public.messages m
    where m.id=new.dm_message_id;

    target_title := 'New reaction to your message';
  elsif new.circle_message_id is not null then
    select m.sender_id,
           'circles/'||m.circle_id::text||'/chat?message='||m.id::text
      into recipient_id,target_route
    from public.circle_messages m
    where m.id=new.circle_message_id;

    target_title := 'New reaction in Circle chat';
  else
    return new;
  end if;

  if recipient_id is null or recipient_id=new.user_id then
    return new;
  end if;

  insert into public.notifications(
    user_id,actor_id,type,title,body,entity_type,entity_id,route
  )
  values(
    recipient_id,
    new.user_id,
    'reaction',
    target_title,
    coalesce(actor_name,'A student')||' reacted '||new.emoji||' to your message.',
    'message_reaction',
    new.id::text,
    target_route
  );

  return new;
end
$$;

drop trigger if exists message_reactions_notify_owner on public.message_reactions;
create trigger message_reactions_notify_owner
after insert or delete on public.message_reactions
for each row execute function public.notify_message_reaction();

revoke all on function public.notify_message_reaction() from public,anon,authenticated;

