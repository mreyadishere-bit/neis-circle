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
alter table public.neis_play_championships drop constraint if exists neis_play_championships_game_check;
alter table public.neis_play_championships add constraint neis_play_championships_game_check check(game in ('chess','sketch','flashcards','quiz'));
create or replace function public.neis_play_create_championship(p_circle uuid,p_title text,p_game text,p_start timestamptz)
returns uuid language plpgsql security definer set search_path=public
as $
declare new_id uuid;
begin
 if auth.uid() is null then raise exception 'login_required';end if;
 if public.circle_role(p_circle) not in ('owner','admin','moderator') and not public.is_admin() then raise exception 'circle_admin_only';end if;
 if p_game not in ('chess','sketch','flashcards','quiz') or length(btrim(coalesce(p_title,''))) not between 3 and 100 or p_start<now() or p_start>now()+interval '180 days' then raise exception 'invalid_championship';end if;
 insert into public.neis_play_championships(circle_id,organizer_id,title,game,starts_at)
 values(p_circle,auth.uid(),btrim(p_title),p_game,p_start) returning id into new_id;
 return new_id;
end;
$;


notify pgrst,'reload schema';
