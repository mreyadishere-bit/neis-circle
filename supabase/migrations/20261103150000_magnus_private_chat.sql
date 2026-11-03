-- Magnus private direct AI conversation. No Circle or ordinary DM access.
begin;
create table if not exists public.magnus_messages (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  role text not null check (role in ('user','assistant')),
  body text not null check (char_length(body) between 1 and 3500),
  reaction text,
  created_at timestamptz not null default now(),
  unique(user_id, request_id, role)
);
create index if not exists magnus_messages_user_recent_idx
 on public.magnus_messages (user_id,created_at desc,id desc);
alter table public.magnus_messages enable row level security;
drop policy if exists magnus_private_read on public.magnus_messages;
create policy magnus_private_read on public.magnus_messages
 for select to authenticated using(user_id=auth.uid());
revoke all on public.magnus_messages from public,anon,authenticated;
grant select on public.magnus_messages to authenticated;
grant select,insert,delete on public.magnus_messages to service_role;
grant usage,select on sequence public.magnus_messages_id_seq to service_role;

create table if not exists public.magnus_rate_limits(
  user_id uuid primary key references auth.users(id) on delete cascade,
  burst_start timestamptz not null default now(),
  burst_count integer not null default 0,
  day_start timestamptz not null default now(),
  day_count integer not null default 0
);
revoke all on public.magnus_rate_limits from public,anon,authenticated;

-- Each authenticated student receives an independently enforced quota.
-- Atomic row updates serialize concurrent requests for one user.
create or replace function public.magnus_claim_turn()
returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,public,auth as $$
declare u uuid := auth.uid();
declare current_time timestamptz := clock_timestamp();
declare item public.magnus_rate_limits%rowtype;
begin
 if u is null or not exists(select 1 from auth.users where id=u and deleted_at is null)
 then raise exception 'Authentication required' using errcode='42501'; end if;
 insert into public.magnus_rate_limits(user_id) values(u)
 on conflict(user_id) do nothing;
 select * into item from public.magnus_rate_limits where user_id=u for update;
 if item.day_start < current_time-interval '24 hours' then
  item.day_start:=current_time;item.day_count:=0;
 end if;
 if item.burst_start < current_time-interval '60 seconds' then
  item.burst_start:=current_time;item.burst_count:=0;
 end if;
 if item.burst_count>=12 or item.day_count>=250 then
  return jsonb_build_object('allowed',false,'reason',
    case when item.day_count>=250 then 'daily_limit' else 'busy' end);
 end if;
 update public.magnus_rate_limits set burst_start=item.burst_start,
  day_start=item.day_start,burst_count=item.burst_count+1,day_count=item.day_count+1
 where user_id=u;
 return jsonb_build_object('allowed',true);
end;$$;

-- Only the server-side service role may commit assistant messages.
-- Both records are written atomically; browser users cannot forge bot replies.
create or replace function public.magnus_commit_turn(
 p_user uuid,p_request uuid,p_question text,p_reply text,p_reaction text default null
) returns boolean language plpgsql volatile security definer
set search_path=pg_catalog,public,auth as $$
begin
 if p_user is null or p_request is null or
    char_length(btrim(p_question)) not between 1 and 2400 or
    char_length(btrim(p_reply)) not between 1 and 3500 then
  raise exception 'Invalid Magnus turn' using errcode='22023';
 end if;
 if not exists(select 1 from auth.users where id=p_user and deleted_at is null) then
  raise exception 'Account not found' using errcode='P0002';
 end if;
 insert into public.magnus_messages(user_id,request_id,role,body)
 values(p_user,p_request,'user',btrim(p_question))
 on conflict(user_id,request_id,role) do nothing;
 insert into public.magnus_messages(user_id,request_id,role,body,reaction)
 values(p_user,p_request,'assistant',btrim(p_reply),left(p_reaction,8))
 on conflict(user_id,request_id,role) do nothing;
 return true;
end;$$;

create or replace function public.magnus_clear_my_chat()
returns integer language plpgsql volatile security definer
set search_path=pg_catalog,public,auth as $$
declare count_removed integer;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 delete from public.magnus_messages where user_id=auth.uid();
 get diagnostics count_removed=row_count;
 return count_removed;
end;$$;

revoke all on function public.magnus_claim_turn() from public,anon;
revoke all on function public.magnus_commit_turn(uuid,uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.magnus_clear_my_chat() from public,anon;
grant execute on function public.magnus_claim_turn() to authenticated;
grant execute on function public.magnus_clear_my_chat() to authenticated;
grant execute on function public.magnus_commit_turn(uuid,uuid,text,text,text) to service_role;
commit;
notify pgrst,'reload schema';
