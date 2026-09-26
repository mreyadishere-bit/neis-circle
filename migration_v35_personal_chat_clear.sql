-- Per-user chat deletion: preserve the other participant's history while
-- clearing all existing history for the user who deletes the chat.
alter table public.conversation_members
  add column if not exists cleared_at timestamptz;

create or replace function public.hide_conversation_for_me(conversation_id_input uuid)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
declare changed boolean:=false;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  update public.conversation_members
     set hidden_at=now(),
         cleared_at=now(),
         last_read_at=now()
   where conversation_id=conversation_id_input
     and user_id=auth.uid()
  returning true into changed;
  return coalesce(changed,false);
end;
$$;
