-- DMs: deleting a chat is personal, never a global conversation deletion.
-- Compatible with old browser/PWA clients that still call delete_direct_conversation.
-- Both entry points now preserve messages and the other person's membership.
begin;

create or replace function public.hide_conversation_for_me(conversation_id_input uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  did_change boolean := false;
begin
  if auth.uid() is null then
    raise exception 'authentication_required';
  end if;

  update public.conversation_members cm
  set hidden_at = now(),
      cleared_at = now(),
      last_read_at = now()
  where cm.conversation_id = conversation_id_input
    and cm.user_id = auth.uid()
    and exists (
      select 1 from public.conversations c
      where c.id = cm.conversation_id and c.kind = 'direct'
    )
  returning true into did_change;

  return coalesce(did_change, false);
end;
$$;

-- SECURITY: old clients must not be able to cascade-delete a DM via this RPC.
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
  return public.hide_conversation_for_me(conversation_id_input);
end;
$$;

revoke all on function public.hide_conversation_for_me(uuid) from public, anon;
revoke all on function public.delete_direct_conversation(uuid) from public, anon;
grant execute on function public.hide_conversation_for_me(uuid) to authenticated;
grant execute on function public.delete_direct_conversation(uuid) to authenticated;

commit;
