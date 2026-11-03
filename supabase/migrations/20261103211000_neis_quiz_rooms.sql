-- Quiz rooms added without touching unrelated chat/meeting data.
alter table public.neis_play_rooms drop constraint if exists neis_play_rooms_game_check;
alter table public.neis_play_rooms add constraint neis_play_rooms_game_check check(game in ('chess','sketch','flashcards','quiz'));
create or replace function public.neis_play_create_room(p_game text,p_title text default '',p_circle uuid default null,p_settings jsonb default '{}'::jsonb)
returns table(room_id uuid,invite_code text)
language plpgsql security definer set search_path=public
as $$
declare r public.neis_play_rooms%rowtype; cap int;
begin
 if auth.uid() is null then raise exception 'login_required';end if;
 if p_game not in ('chess','sketch','flashcards','quiz') then raise exception 'invalid_game';end if;
 if p_circle is not null and public.circle_role(p_circle) is null and not public.is_admin() then raise exception 'circle_members_only';end if;
 if (select count(*) from public.neis_play_rooms where creator_id=auth.uid() and expires_at>now() and status<>'finished')>=5 then raise exception 'too_many_open_rooms';end if;
 if jsonb_typeof(coalesce(p_settings,'{}'::jsonb))<>'object' or length(p_settings::text)>1000 then raise exception 'invalid_settings';end if;
 if p_game='flashcards' and not exists(select 1 from public.neis_play_decks d join public.neis_play_cards c on c.deck_id=d.id where d.id::text=coalesce(p_settings->>'deck_id','') and d.owner_id=auth.uid()) then raise exception 'choose_your_nonempty_deck';end if;
 if p_game='quiz' and not exists(select 1 from public.neis_quizzes z join public.neis_quiz_questions q on q.quiz_id=z.id where z.id::text=coalesce(p_settings->>'quiz_id','') and (z.visibility='public' or z.owner_id=auth.uid())) then raise exception 'choose_a_quiz_with_questions';end if;
 cap:=case p_game when 'chess' then 2 when 'sketch' then 12 else 8 end;
 insert into public.neis_play_rooms(creator_id,circle_id,game,title,max_players,settings)
 values(auth.uid(),p_circle,p_game,left(btrim(coalesce(p_title,'')),90),cap,coalesce(p_settings,'{}'::jsonb))
 returning * into r;
 insert into public.neis_play_members(room_id,user_id) values(r.id,auth.uid());
 return query select r.id,r.code;
end;
$$;


create or replace function public.neis_play_send_event(p_room uuid,p_type text,p_payload jsonb default '{}'::jsonb)
returns bigint language plpgsql security definer set search_path=public
as $$
declare r public.neis_play_rooms%rowtype; n bigint; player_order uuid[]; move_count int; current_turn uuid; ev_id bigint;
begin
 if auth.uid() is null then raise exception 'login_required';end if;
 select * into r from public.neis_play_rooms where id=p_room for update;
 if not found or r.expires_at<now() then raise exception 'room_unavailable';end if;
 if not exists(select 1 from public.neis_play_members where room_id=p_room and user_id=auth.uid()) then raise exception 'room_members_only';end if;
 if p_type not in ('start','move','stroke','guess','answer','end','chat') or jsonb_typeof(coalesce(p_payload,'{}'::jsonb))<>'object' or length(p_payload::text)>2800 then raise exception 'invalid_event';end if;
 if r.status='finished' then raise exception 'game_finished';end if;
 select count(*) into n from public.neis_play_events where room_id=p_room;
 if n>=1500 then raise exception 'event_limit_reached';end if;
 if (select count(*) from public.neis_play_events where room_id=p_room and user_id=auth.uid() and created_at>now()-interval '1 minute')>=100 then raise exception 'room_rate_limit';end if;
 if p_type='start' then
  if r.creator_id<>auth.uid() or r.status<>'waiting' then raise exception 'host_only';end if;
  if (select count(*) from public.neis_play_members where room_id=p_room)<2 then raise exception 'need_two_players';end if;
  update public.neis_play_rooms set status='playing' where id=p_room;
 elsif p_type='end' then
  if r.creator_id<>auth.uid() then raise exception 'host_only';end if;
  update public.neis_play_rooms set status='finished' where id=p_room;
 else
  if r.status<>'playing' then raise exception 'game_not_started';end if;
  if p_type='move' then
   if r.game<>'chess' or coalesce(p_payload->>'uci','') !~ '^[a-h][1-8][a-h][1-8][qrbn]?$' then raise exception 'invalid_chess_move';end if;
   select array_agg(user_id order by joined_at,user_id) into player_order from public.neis_play_members where room_id=p_room;
   select count(*) into move_count from public.neis_play_events where room_id=p_room and type='move';
   current_turn:=player_order[1+(move_count%2)];
   if current_turn<>auth.uid() then raise exception 'not_your_turn';end if;
  elsif p_type='stroke' then
   if r.game<>'sketch' or jsonb_typeof(p_payload->'points')<>'array' or jsonb_array_length(p_payload->'points')<2 or jsonb_array_length(p_payload->'points')>120 then raise exception 'invalid_stroke';end if;
  elsif p_type='guess' then
   if r.game<>'sketch' or char_length(coalesce(p_payload->>'text',''))>80 then raise exception 'invalid_guess';end if;
  elsif p_type='answer' and r.game='quiz' then
   if coalesce(p_payload->>'card_id','') !~ '^[a-f0-9-]{36}   if r.game<>'flashcards' or length(coalesce(p_payload->>'text',''))>300 or
    not exists(select 1 from public.neis_play_cards where id::text=coalesce(p_payload->>'card_id','') and deck_id::text=coalesce(r.settings->>'deck_id','')) then raise exception 'invalid_answer';end if;
  elsif p_type<>'chat' or length(coalesce(p_payload->>'text',''))>500 then
   raise exception 'invalid_chat';end if;
 end if;
 insert into public.neis_play_events(room_id,user_id,type,payload)
 values(p_room,auth.uid(),p_type,p_payload) returning id into ev_id;
 return ev_id;
end;
$$;


    or coalesce(p_payload->>'choice','') !~ '^[0-3]   if r.game<>'flashcards' or length(coalesce(p_payload->>'text',''))>300 or
    not exists(select 1 from public.neis_play_cards where id::text=coalesce(p_payload->>'card_id','') and deck_id::text=coalesce(r.settings->>'deck_id','')) then raise exception 'invalid_answer';end if;
  elsif p_type<>'chat' or length(coalesce(p_payload->>'text',''))>500 then
   raise exception 'invalid_chat';end if;
 end if;
 insert into public.neis_play_events(room_id,user_id,type,payload)
 values(p_room,auth.uid(),p_type,p_payload) returning id into ev_id;
 return ev_id;
end;
$$;


    or not exists(select 1 from public.neis_quiz_questions q
       where q.id::text=p_payload->>'card_id' and q.quiz_id::text=r.settings->>'quiz_id')
   then raise exception 'invalid_quiz_answer';end if;
  elsif p_type='answer' then
   if r.game<>'flashcards' or length(coalesce(p_payload->>'text',''))>300 or
    not exists(select 1 from public.neis_play_cards where id::text=coalesce(p_payload->>'card_id','') and deck_id::text=coalesce(r.settings->>'deck_id','')) then raise exception 'invalid_answer';end if;
  elsif p_type<>'chat' or length(coalesce(p_payload->>'text',''))>500 then
   raise exception 'invalid_chat';end if;
 end if;
 insert into public.neis_play_events(room_id,user_id,type,payload)
 values(p_room,auth.uid(),p_type,p_payload) returning id into ev_id;
 return ev_id;
end;
$$;


create or replace function public.neis_quiz_room_scores(p_room uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 if auth.uid() is null or not exists(select 1 from public.neis_play_members where room_id=p_room and user_id=auth.uid()) then raise exception 'room_members_only';end if;
 if not exists(select 1 from public.neis_play_rooms where id=p_room and game='quiz') then raise exception 'not_quiz_room';end if;
 select coalesce(jsonb_agg(jsonb_build_object('user_id',user_id,'correct',correct_count,'answered',answer_count) order by correct_count desc,answer_count desc),'[]'::jsonb) into result
 from (
   select e.user_id,count(*)::int answer_count,count(*) filter(where e.payload->>'choice'=a.correct_index::text)::int correct_count
   from public.neis_play_events e join public.neis_quiz_answers a on a.question_id::text=e.payload->>'card_id'
   where e.room_id=p_room and e.type='answer'
   group by e.user_id
 ) counts;
 return result;
end;$$;
revoke all on function public.neis_quiz_room_scores(uuid) from public;
grant execute on function public.neis_quiz_room_scores(uuid) to authenticated;
notify pgrst,'reload schema';
