-- NEIS Play: isolated, opt-in game and learning tables. No existing table is altered.
-- Game rooms are CASUAL ONLY until authoritative chess/drawing engines are deployed.
create table if not exists public.neis_play_rooms (
 id uuid primary key default gen_random_uuid(),
 code text not null unique default upper(substr(replace(gen_random_uuid()::text,'-',''),1,16)),
 creator_id uuid not null references auth.users(id) on delete cascade,
 circle_id uuid references public.circles(id) on delete set null,
 game text not null check (game in ('chess','sketch','flashcards')),
 title text not null default '',
 max_players int not null check (max_players between 2 and 12),
 status text not null default 'waiting' check (status in ('waiting','playing','finished')),
 settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings)='object'),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default (now()+interval '2 hours')
);
create index if not exists neis_play_rooms_creator_idx on public.neis_play_rooms(creator_id,created_at desc);
create table if not exists public.neis_play_members (
 room_id uuid not null references public.neis_play_rooms(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 joined_at timestamptz not null default now(),
 primary key(room_id,user_id)
);
create index if not exists neis_play_members_user_idx on public.neis_play_members(user_id);
create table if not exists public.neis_play_events (
 id bigint generated always as identity primary key,
 room_id uuid not null references public.neis_play_rooms(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 type text not null check (type in ('start','move','stroke','guess','answer','end','chat')),
 payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload)='object'),
 created_at timestamptz not null default now()
);
create index if not exists neis_play_events_room_idx on public.neis_play_events(room_id,id);
create table if not exists public.neis_play_decks (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 title text not null check (char_length(btrim(title)) between 3 and 90),
 subject text not null default '',
 created_at timestamptz not null default now()
);
create table if not exists public.neis_play_cards (
 id uuid primary key default gen_random_uuid(),
 deck_id uuid not null references public.neis_play_decks(id) on delete cascade,
 question text not null check (char_length(btrim(question)) between 3 and 300),
 answer text not null check (char_length(btrim(answer)) between 1 and 300),
 created_at timestamptz not null default now()
);
create index if not exists neis_play_cards_deck_idx on public.neis_play_cards(deck_id);
create table if not exists public.neis_play_daily (
 day date primary key,
 question text not null check (char_length(btrim(question)) between 10 and 300),
 options jsonb not null check (jsonb_typeof(options)='array' and jsonb_array_length(options)=4),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
create table if not exists public.neis_play_daily_keys (
 day date primary key references public.neis_play_daily(day) on delete cascade,
 correct_index int not null check (correct_index between 0 and 3),
 explanation text not null default ''
);
create table if not exists public.neis_play_daily_answers (
 day date not null references public.neis_play_daily(day) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 chosen_index int not null check (chosen_index between 0 and 3),
 created_at timestamptz not null default now(),
 primary key(day,user_id)
);
create table if not exists public.neis_play_daily_suggestions (
 id uuid primary key default gen_random_uuid(),
 author_id uuid not null references auth.users(id) on delete cascade,
 question text not null check (char_length(btrim(question)) between 10 and 300),
 created_at timestamptz not null default now()
);
create table if not exists public.neis_play_championships (
 id uuid primary key default gen_random_uuid(),
 circle_id uuid not null references public.circles(id) on delete cascade,
 organizer_id uuid not null references auth.users(id),
 title text not null check (char_length(btrim(title)) between 3 and 100),
 game text not null check (game in ('chess','sketch','flashcards')),
 starts_at timestamptz not null,
 status text not null default 'registration' check (status in ('registration','running','finished')),
 created_at timestamptz not null default now()
);
create table if not exists public.neis_play_championship_entries (
 championship_id uuid not null references public.neis_play_championships(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 registered_at timestamptz not null default now(),
 primary key(championship_id,user_id)
);
create index if not exists neis_play_championships_starts_idx on public.neis_play_championships(starts_at);

alter table public.neis_play_rooms enable row level security;
alter table public.neis_play_members enable row level security;
alter table public.neis_play_events enable row level security;
alter table public.neis_play_decks enable row level security;
alter table public.neis_play_cards enable row level security;
alter table public.neis_play_daily enable row level security;
alter table public.neis_play_daily_keys enable row level security;
alter table public.neis_play_daily_answers enable row level security;
alter table public.neis_play_daily_suggestions enable row level security;
alter table public.neis_play_championships enable row level security;
alter table public.neis_play_championship_entries enable row level security;

-- Avoid recursive room/member policies: authenticated users can only read rooms
-- and events through SECURITY DEFINER RPCs that check their membership.
revoke all on public.neis_play_rooms,public.neis_play_members,public.neis_play_events from anon,authenticated;
grant select,insert,update,delete on public.neis_play_decks,public.neis_play_cards to authenticated;
grant select on public.neis_play_daily,public.neis_play_daily_answers,public.neis_play_championships,public.neis_play_championship_entries to authenticated;
grant insert on public.neis_play_daily_suggestions to authenticated;
grant usage on sequence public.neis_play_events_id_seq to authenticated;

create policy play_decks_read on public.neis_play_decks for select to authenticated using (true);
create policy play_decks_insert on public.neis_play_decks for insert to authenticated with check (owner_id=auth.uid());
create policy play_decks_update on public.neis_play_decks for update to authenticated using (owner_id=auth.uid()) with check (owner_id=auth.uid());
create policy play_decks_delete on public.neis_play_decks for delete to authenticated using (owner_id=auth.uid());
create policy play_cards_read on public.neis_play_cards for select to authenticated using (true);
create policy play_cards_insert on public.neis_play_cards for insert to authenticated with check (exists(select 1 from public.neis_play_decks d where d.id=deck_id and d.owner_id=auth.uid()));
create policy play_cards_update on public.neis_play_cards for update to authenticated using (exists(select 1 from public.neis_play_decks d where d.id=deck_id and d.owner_id=auth.uid()));
create policy play_cards_delete on public.neis_play_cards for delete to authenticated using (exists(select 1 from public.neis_play_decks d where d.id=deck_id and d.owner_id=auth.uid()));
create policy play_daily_read on public.neis_play_daily for select to authenticated using (true);
create policy play_answers_own on public.neis_play_daily_answers for select to authenticated using (user_id=auth.uid());
create policy play_suggestions_own on public.neis_play_daily_suggestions for insert to authenticated with check (author_id=auth.uid());
create policy play_championships_read on public.neis_play_championships for select to authenticated
 using (public.circle_role(circle_id) is not null or public.is_admin());
create policy play_championship_entries_read on public.neis_play_championship_entries for select to authenticated
 using (user_id=auth.uid() or exists(select 1 from public.neis_play_championships c where c.id=championship_id and (public.circle_role(c.circle_id) is not null or public.is_admin())));

create or replace function public.neis_play_create_room(p_game text,p_title text default '',p_circle uuid default null,p_settings jsonb default '{}'::jsonb)
returns table(room_id uuid,invite_code text)
language plpgsql security definer set search_path=public
as $$
declare r public.neis_play_rooms%rowtype; cap int;
begin
 if auth.uid() is null then raise exception 'login_required';end if;
 if p_game not in ('chess','sketch','flashcards') then raise exception 'invalid_game';end if;
 if p_circle is not null and public.circle_role(p_circle) is null and not public.is_admin() then raise exception 'circle_members_only';end if;
 if (select count(*) from public.neis_play_rooms where creator_id=auth.uid() and expires_at>now() and status<>'finished')>=5 then raise exception 'too_many_open_rooms';end if;
 if jsonb_typeof(coalesce(p_settings,'{}'::jsonb))<>'object' or length(p_settings::text)>1000 then raise exception 'invalid_settings';end if;
 if p_game='flashcards' and not exists(select 1 from public.neis_play_decks d join public.neis_play_cards c on c.deck_id=d.id where d.id::text=coalesce(p_settings->>'deck_id','') and d.owner_id=auth.uid()) then raise exception 'choose_your_nonempty_deck';end if;
 cap:=case p_game when 'chess' then 2 when 'sketch' then 12 else 8 end;
 insert into public.neis_play_rooms(creator_id,circle_id,game,title,max_players,settings)
 values(auth.uid(),p_circle,p_game,left(btrim(coalesce(p_title,'')),90),cap,coalesce(p_settings,'{}'::jsonb))
 returning * into r;
 insert into public.neis_play_members(room_id,user_id) values(r.id,auth.uid());
 return query select r.id,r.code;
end;
$$;

create or replace function public.neis_play_join_room(p_code text)
returns uuid language plpgsql security definer set search_path=public
as $$
declare r public.neis_play_rooms%rowtype; count_members int;
begin
 if auth.uid() is null then raise exception 'login_required';end if;
 select * into r from public.neis_play_rooms where code=upper(btrim(coalesce(p_code,''))) for update;
 if not found or r.expires_at<now() then raise exception 'room_unavailable';end if;
 if r.circle_id is not null and public.circle_role(r.circle_id) is null and not public.is_admin() then raise exception 'circle_members_only';end if;
 if exists(select 1 from public.neis_play_members where room_id=r.id and user_id=auth.uid()) then return r.id;end if;
 if r.status<>'waiting' then raise exception 'game_already_started';end if;
 select count(*) into count_members from public.neis_play_members where room_id=r.id;
 if count_members>=r.max_players then raise exception 'room_full';end if;
 insert into public.neis_play_members(room_id,user_id) values(r.id,auth.uid());
 return r.id;
end;
$$;

create or replace function public.neis_play_room_snapshot(p_id uuid,p_after bigint default 0)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare r public.neis_play_rooms%rowtype; people jsonb; history jsonb;
begin
 if auth.uid() is null then raise exception 'login_required';end if;
 if not exists(select 1 from public.neis_play_members where room_id=p_id and user_id=auth.uid()) then raise exception 'room_members_only';end if;
 select * into r from public.neis_play_rooms where id=p_id and expires_at>now();
 if not found then raise exception 'room_expired';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',m.user_id,'joined_at',m.joined_at) order by m.joined_at,m.user_id),'[]'::jsonb) into people
 from public.neis_play_members m where m.room_id=p_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'user_id',e.user_id,'type',e.type,'payload',e.payload,'created_at',e.created_at) order by e.id),'[]'::jsonb) into history
 from (select * from public.neis_play_events where room_id=p_id and id>greatest(0,coalesce(p_after,0)) order by id limit 250) e;
 return jsonb_build_object('id',r.id,'code',r.code,'game',r.game,'title',r.title,'status',r.status,'creator_id',r.creator_id,'settings',r.settings,'expires_at',r.expires_at,'members',people,'events',history);
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

create or replace function public.neis_play_answer_daily(p_day date,p_choice int)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare answer int; explanation text; stored int;
begin
 if auth.uid() is null then raise exception 'login_required';end if;
 if p_choice not between 0 and 3 then raise exception 'invalid_choice';end if;
 if p_day>(now() at time zone 'Africa/Cairo')::date then raise exception 'not_published';end if;
 select k.correct_index,k.explanation into answer,explanation from public.neis_play_daily d join public.neis_play_daily_keys k on k.day=d.day where d.day=p_day;
 if not found then raise exception 'daily_question_unavailable';end if;
 insert into public.neis_play_daily_answers(day,user_id,chosen_index) values(p_day,auth.uid(),p_choice)
 on conflict(day,user_id) do nothing;
 select chosen_index into stored from public.neis_play_daily_answers where day=p_day and user_id=auth.uid();
 return jsonb_build_object('chosen',stored,'correct',answer,'is_correct',stored=answer,'explanation',explanation);
end;
$$;

create or replace function public.neis_play_publish_daily(p_day date,p_question text,p_options jsonb,p_correct int,p_explanation text)
returns boolean language plpgsql security definer set search_path=public
as $$
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'admin_only';end if;
 if p_day<(now() at time zone 'Africa/Cairo')::date or p_day>(now() at time zone 'Africa/Cairo')::date+90 then raise exception 'invalid_day';end if;
 if length(btrim(coalesce(p_question,''))) not between 10 and 300 or jsonb_typeof(p_options)<>'array' or jsonb_array_length(p_options)<>4 or p_correct not between 0 and 3 then raise exception 'invalid_question';end if;
 if exists(select 1 from public.neis_play_daily where day=p_day) then raise exception 'date_already_has_question';end if;
 insert into public.neis_play_daily(day,question,options,created_by) values(p_day,btrim(p_question),p_options,auth.uid());
 insert into public.neis_play_daily_keys(day,correct_index,explanation) values(p_day,p_correct,left(coalesce(p_explanation,''),1000));
 return true;
end;
$$;

create or replace function public.neis_play_create_championship(p_circle uuid,p_title text,p_game text,p_start timestamptz)
returns uuid language plpgsql security definer set search_path=public
as $$
declare new_id uuid;
begin
 if auth.uid() is null then raise exception 'login_required';end if;
 if public.circle_role(p_circle) not in ('owner','admin','moderator') and not public.is_admin() then raise exception 'circle_admin_only';end if;
 if p_game not in ('chess','sketch','flashcards') or length(btrim(coalesce(p_title,''))) not between 3 and 100 or p_start<now() or p_start>now()+interval '180 days' then raise exception 'invalid_championship';end if;
 insert into public.neis_play_championships(circle_id,organizer_id,title,game,starts_at)
 values(p_circle,auth.uid(),btrim(p_title),p_game,p_start) returning id into new_id;
 return new_id;
end;
$$;

create or replace function public.neis_play_register_championship(p_id uuid)
returns boolean language plpgsql security definer set search_path=public
as $$
declare r public.neis_play_championships%rowtype;
begin
 if auth.uid() is null then raise exception 'login_required';end if;
 select * into r from public.neis_play_championships where id=p_id for update;
 if not found or r.status<>'registration' or r.starts_at<=now() then raise exception 'registration_closed';end if;
 if public.circle_role(r.circle_id) is null and not public.is_admin() then raise exception 'circle_members_only';end if;
 insert into public.neis_play_championship_entries(championship_id,user_id) values(p_id,auth.uid()) on conflict do nothing;
 return true;
end;
$$;

create or replace function public.neis_play_my_rooms()
returns jsonb language plpgsql security definer set search_path=public
as $$
declare result jsonb;
begin
 if auth.uid() is null then raise exception 'login_required';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'code',r.code,'game',r.game,'title',r.title,'status',r.status,'created_at',r.created_at) order by r.created_at desc),'[]'::jsonb) into result
 from (select r.* from public.neis_play_rooms r join public.neis_play_members m on m.room_id=r.id
 where m.user_id=auth.uid() and r.expires_at>now() order by r.created_at desc limit 25) r;
 return result;
end;
$$;
create unique index if not exists neis_play_one_answer_per_card on public.neis_play_events (room_id,user_id,(payload->>'card_id'))
 where type='answer';

revoke all on function public.neis_play_create_room(text,text,uuid,jsonb) from public;
revoke all on function public.neis_play_my_rooms() from public;
revoke all on function public.neis_play_join_room(text) from public;
revoke all on function public.neis_play_room_snapshot(uuid,bigint) from public;
revoke all on function public.neis_play_send_event(uuid,text,jsonb) from public;
revoke all on function public.neis_play_answer_daily(date,int) from public;
revoke all on function public.neis_play_publish_daily(date,text,jsonb,int,text) from public;
revoke all on function public.neis_play_create_championship(uuid,text,text,timestamptz) from public;
revoke all on function public.neis_play_register_championship(uuid) from public;
grant execute on function public.neis_play_my_rooms(),public.neis_play_create_room(text,text,uuid,jsonb),public.neis_play_join_room(text),
 public.neis_play_room_snapshot(uuid,bigint),public.neis_play_send_event(uuid,text,jsonb),
 public.neis_play_answer_daily(date,int),public.neis_play_publish_daily(date,text,jsonb,int,text),
 public.neis_play_create_championship(uuid,text,text,timestamptz),public.neis_play_register_championship(uuid)
 to authenticated;
notify pgrst, 'reload schema';
