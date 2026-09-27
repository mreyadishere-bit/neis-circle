-- Production repair: hard-delete direct chats/messages and secure Circle LiveKit meetings.

-- A deleted direct message must disappear completely for every participant.
create or replace function public.delete_direct_message(message_id_input uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  message_sender uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication_required';
  end if;

  select sender_id into message_sender
  from public.messages
  where id = message_id_input
  for update;

  if message_sender is null then
    return false;
  end if;

  if message_sender <> auth.uid() and not public.is_admin() then
    raise exception 'message_delete_not_allowed';
  end if;

  delete from public.messages where id = message_id_input;
  return found;
end;
$$;

-- Deleting a direct chat is intentionally permanent for both participants.
-- The conversation foreign keys already cascade to members and messages.
create or replace function public.delete_direct_conversation(conversation_id_input uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication_required';
  end if;

  perform 1
  from public.conversations c
  where c.id = conversation_id_input
    and c.kind = 'direct'
    and (
      public.is_admin()
      or exists (
        select 1 from public.conversation_members cm
        where cm.conversation_id = c.id and cm.user_id = auth.uid()
      )
    )
  for update;

  if not found then
    return false;
  end if;

  delete from public.notifications
  where entity_type = 'conversation' and entity_id = conversation_id_input::text;

  delete from public.conversations
  where id = conversation_id_input and kind = 'direct';

  return found;
end;
$$;

-- Remove old soft-delete markers so old deleted messages no longer reappear.
delete from public.messages where deleted_at is not null;

revoke all on function public.delete_direct_message(uuid) from public, anon;
revoke all on function public.delete_direct_conversation(uuid) from public, anon;
grant execute on function public.delete_direct_message(uuid) to authenticated;
grant execute on function public.delete_direct_conversation(uuid) to authenticated;

-- ended_at distinguishes a moderator ending a live room from cancelling/deleting it.
alter table public.circle_meetings
  add column if not exists ended_at timestamptz;

create index if not exists circle_meetings_circle_starts_idx
  on public.circle_meetings(circle_id, starts_at desc);

-- Only Circle management roles may schedule a meeting. The server generates both
-- the meeting UUID and collision-safe room name; clients cannot choose either.
create or replace function public.create_circle_meeting(
  circle_id_input uuid,
  title_input text,
  description_input text,
  starts_at_input timestamptz,
  duration_minutes_input integer default 60
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid := gen_random_uuid();
  actor_role text;
  room text;
begin
  if auth.uid() is null then
    raise exception 'authentication_required';
  end if;

  actor_role := public.circle_role(circle_id_input);
  if not public.is_admin() and coalesce(actor_role, '') not in ('owner','admin','moderator') then
    raise exception 'meeting_create_not_allowed';
  end if;

  if char_length(trim(coalesce(title_input,''))) not between 3 and 120 then
    raise exception 'meeting_title_invalid';
  end if;
  if starts_at_input <= now() then
    raise exception 'meeting_start_must_be_future';
  end if;
  if duration_minutes_input not between 15 and 480 then
    raise exception 'meeting_duration_invalid';
  end if;

  room := 'neis-circle-' || replace(circle_id_input::text, '-', '')
       || '-meeting-' || replace(new_id::text, '-', '');

  insert into public.circle_meetings(
    id, circle_id, creator_id, title, description, starts_at,
    duration_minutes, room_name
  ) values (
    new_id, circle_id_input, auth.uid(), trim(title_input),
    left(trim(coalesce(description_input,'')), 1000), starts_at_input,
    duration_minutes_input, room
  );

  return new_id;
end;
$$;

create or replace function public.end_circle_meeting(meeting_id_input uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.circle_meetings%rowtype;
begin
  if auth.uid() is null then
    raise exception 'authentication_required';
  end if;

  select * into target
  from public.circle_meetings
  where id = meeting_id_input
  for update;

  if target.id is null then return false; end if;
  if target.creator_id <> auth.uid()
     and not public.is_admin()
     and coalesce(public.circle_role(target.circle_id),'') not in ('owner','admin','moderator') then
    raise exception 'meeting_end_not_allowed';
  end if;

  update public.circle_meetings
  set ended_at = coalesce(ended_at, now()), updated_at = now()
  where id = meeting_id_input;
  return true;
end;
$$;

-- Prevent clients from changing meeting ownership, Circle, or trusted room name.
create or replace function public.protect_circle_meeting_identity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.id <> old.id
     or new.circle_id <> old.circle_id
     or new.creator_id <> old.creator_id
     or new.room_name <> old.room_name then
    raise exception 'meeting_identity_is_immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_circle_meeting_identity_trigger on public.circle_meetings;
create trigger protect_circle_meeting_identity_trigger
before update on public.circle_meetings
for each row execute function public.protect_circle_meeting_identity();

drop policy if exists circle_meetings_create on public.circle_meetings;
create policy circle_meetings_create on public.circle_meetings
for insert to authenticated
with check (
  creator_id = auth.uid()
  and (
    public.is_admin()
    or coalesce(public.circle_role(circle_id),'') in ('owner','admin','moderator')
  )
);

revoke all on function public.create_circle_meeting(uuid,text,text,timestamptz,integer) from public, anon;
revoke all on function public.end_circle_meeting(uuid) from public, anon;
grant execute on function public.create_circle_meeting(uuid,text,text,timestamptz,integer) to authenticated;
grant execute on function public.end_circle_meeting(uuid) to authenticated;
