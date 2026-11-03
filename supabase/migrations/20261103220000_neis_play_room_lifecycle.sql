-- Safe room lifecycle: only room owners may delete waiting rooms or end active games.
-- Other participants can leave; all operations enforce auth.uid() in PostgreSQL.
create or replace function public.neis_play_my_rooms()
returns jsonb language plpgsql security definer set search_path=public
as $$
declare result jsonb;
begin
 if auth.uid() is null then raise exception 'login_required';end if;
 select coalesce(jsonb_agg(jsonb_build_object(
   'id',r.id,'code',r.code,'game',r.game,'title',r.title,'status',r.status,
   'creator_id',r.creator_id,'member_count',
   (select count(*) from public.neis_play_members x where x.room_id=r.id),
   'created_at',r.created_at
 ) order by r.created_at desc),'[]'::jsonb) into result
 from (
  select distinct r.* from public.neis_play_rooms r
  join public.neis_play_members m on m.room_id=r.id
  where m.user_id=auth.uid() and r.expires_at>now()
  and r.status in ('waiting','playing')
  order by r.created_at desc limit 25
 ) r;
 return result;
end;
$$;

create or replace function public.neis_play_manage_room(p_id uuid,p_action text)
returns boolean language plpgsql security definer set search_path=public
as $$
declare r public.neis_play_rooms%rowtype;
begin
 if auth.uid() is null then raise exception 'login_required';end if;
 select * into r from public.neis_play_rooms where id=p_id for update;
 if not found then raise exception 'room_unavailable';end if;
 if p_action='delete' then
  if r.creator_id<>auth.uid() then raise exception 'host_only';end if;
  if r.status<>'waiting' then raise exception 'only_waiting_rooms_can_be_deleted';end if;
  delete from public.neis_play_rooms where id=p_id; -- cascades members and temporary events
 elsif p_action='end' then
  if r.creator_id<>auth.uid() then raise exception 'host_only';end if;
  if r.status not in ('waiting','playing') then raise exception 'room_already_finished';end if;
  update public.neis_play_rooms set status='finished' where id=p_id;
 elsif p_action='leave' then
  if r.creator_id=auth.uid() then raise exception 'host_must_end_or_delete_room';end if;
  if not exists(select 1 from public.neis_play_members where room_id=p_id and user_id=auth.uid()) then raise exception 'room_members_only';end if;
  delete from public.neis_play_members where room_id=p_id and user_id=auth.uid();
 else
  raise exception 'invalid_action';
 end if;
 return true;
end;
$$;
revoke all on function public.neis_play_manage_room(uuid,text) from public;
grant execute on function public.neis_play_manage_room(uuid,text) to authenticated;
notify pgrst,'reload schema';
