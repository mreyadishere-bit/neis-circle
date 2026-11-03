-- Repair Circle message moderation and editing at the database authorization layer.
-- No existing messages are changed by the migration.
begin;
create or replace function public.neis_circle_can_manage_message(
  p_circle uuid,p_sender uuid
) returns boolean language sql stable security definer
set search_path=pg_catalog,public,auth as $$
 select auth.uid() is not null and (
  auth.uid()=p_sender
  or exists (
    select 1 from public.profiles p
    where p.id=auth.uid() and p.role='admin'
  )
  or exists(
    select 1 from public.circles c
    where c.id=p_circle and c.owner_id=auth.uid()
  )
  or exists (
    select 1 from public.circle_members cm
    where cm.circle_id=p_circle and cm.user_id=auth.uid()
      and cm.status='active' and cm.role in ('owner','admin','moderator')
  )
 );
$$;
create or replace function public.neis_circle_delete_message(p_message_id bigint)
returns public.circle_messages language plpgsql volatile security definer
set search_path=pg_catalog,public,auth as $$
declare existing public.circle_messages%rowtype;
begin
 if auth.uid() is null or p_message_id is null then
  raise exception 'Authentication required' using errcode='42501';
 end if;
 select * into existing from public.circle_messages
 where id=p_message_id for update;
 if not found then raise exception 'Message not found' using errcode='P0002'; end if;
 if not public.neis_circle_can_manage_message(existing.circle_id,existing.sender_id) then
  raise exception 'Not allowed to delete this message' using errcode='42501';
 end if;
 if existing.deleted_at is not null then return existing; end if;
 -- A nonempty replacement avoids legacy body-length constraints and erases content.
 update public.circle_messages
 set body='[deleted]',deleted_at=now(),
     pinned_at=null,pinned_by=null,pin_expires_at=null
 where id=p_message_id returning * into existing;
 return existing;
end;$$;
create or replace function public.neis_circle_edit_message(
 p_message_id bigint,p_body text
) returns public.circle_messages language plpgsql volatile security definer
set search_path=pg_catalog,public,auth as $$
declare existing public.circle_messages%rowtype;
begin
 if auth.uid() is null or p_message_id is null then
  raise exception 'Authentication required' using errcode='42501';
 end if;
 if p_body is null or char_length(btrim(p_body)) not between 1 and 4000 then
  raise exception 'Message must be between 1 and 4000 characters' using errcode='22023';
 end if;
 select * into existing from public.circle_messages
 where id=p_message_id for update;
 if not found then raise exception 'Message not found' using errcode='P0002'; end if;
 if existing.sender_id<>auth.uid() or existing.deleted_at is not null then
  raise exception 'Only the author can edit an active message' using errcode='42501';
 end if;
 update public.circle_messages
 set body=btrim(p_body),edited_at=now()
 where id=p_message_id returning * into existing;
 return existing;
end;$$;
revoke all on function public.neis_circle_can_manage_message(uuid,uuid) from public,anon;
revoke all on function public.neis_circle_delete_message(bigint) from public,anon;
revoke all on function public.neis_circle_edit_message(bigint,text) from public,anon;
grant execute on function public.neis_circle_delete_message(bigint) to authenticated;
grant execute on function public.neis_circle_edit_message(bigint,text) to authenticated;
-- Internal authorization helper runs only inside functions.
revoke all on function public.neis_circle_can_manage_message(uuid,uuid) from authenticated;
commit;
notify pgrst,'reload schema';
