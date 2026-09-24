-- NEIS Circle v21 — repair direct-message soft deletion.
-- `messages_body_check` rejects an empty string, so retain a private tombstone
-- value while `deleted_at` remains the source of truth shown by the UI.
begin;

create or replace function public.delete_direct_message(message_id_input uuid)
returns boolean
language plpgsql
security definer
set search_path=public,auth
as $$
declare
  changed boolean:=false;
begin
  if auth.uid() is null then
    raise exception 'authentication_required';
  end if;

  update public.messages
     set body='[deleted]',
         deleted_at=coalesce(deleted_at,now())
   where id=message_id_input
     and deleted_at is null
     and (sender_id=auth.uid() or public.is_admin())
  returning true into changed;

  return coalesce(changed,false);
end;
$$;

revoke all on function public.delete_direct_message(uuid) from public,anon;
grant execute on function public.delete_direct_message(uuid) to authenticated;

commit;
