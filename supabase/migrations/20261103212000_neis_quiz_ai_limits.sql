-- A bounded free-tier budget for generated quiz questions, keyed by user and UTC day.
create table if not exists public.neis_quiz_ai_usage(
 user_id uuid not null references auth.users(id) on delete cascade,
 day date not null,
 requests integer not null default 0 check(requests between 0 and 6),
 primary key(user_id,day)
);
alter table public.neis_quiz_ai_usage enable row level security;
revoke all on public.neis_quiz_ai_usage from anon,authenticated;
create or replace function public.neis_quiz_ai_claim()
returns integer language plpgsql security definer set search_path=public as $$
declare remaining integer;
begin
 if auth.uid() is null then raise exception 'login_required';end if;
 insert into public.neis_quiz_ai_usage(user_id,day,requests)
 values(auth.uid(),(now() at time zone 'UTC')::date,1)
 on conflict(user_id,day) do update set requests=public.neis_quiz_ai_usage.requests+1
 where public.neis_quiz_ai_usage.requests<6
 returning (6-requests) into remaining;
 if remaining is null then raise exception 'daily_ai_limit_reached';end if;
 return remaining;
end;$$;
revoke all on function public.neis_quiz_ai_claim() from public;
grant execute on function public.neis_quiz_ai_claim() to authenticated;
notify pgrst,'reload schema';
