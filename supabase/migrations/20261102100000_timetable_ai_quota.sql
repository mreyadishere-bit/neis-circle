-- Timetable AI: bounded, atomic, per-user quota with no direct client table access.
-- Apply to the active OVH database before enabling the Edge Function.
create table if not exists public.timetable_ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null,
  requests integer not null default 0,
  minute_bucket timestamptz not null,
  minute_requests integer not null default 0,
  primary key (user_id, usage_date)
);
alter table public.timetable_ai_usage enable row level security;
revoke all on table public.timetable_ai_usage from public, anon, authenticated;

create or replace function public.consume_timetable_ai_quota()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  permitted boolean;
  uid uuid := (select auth.uid());
begin
  if uid is null then return false; end if;
  insert into public.timetable_ai_usage as usage
    (user_id, usage_date, requests, minute_bucket, minute_requests)
  values (uid, (now() at time zone 'utc')::date, 1, date_trunc('minute', now()), 1)
  on conflict (user_id, usage_date)
  do update set
    requests = usage.requests + 1,
    minute_bucket = excluded.minute_bucket,
    minute_requests = case
      when usage.minute_bucket = excluded.minute_bucket then usage.minute_requests + 1
      else 1 end
  where usage.requests < 25
    and (usage.minute_bucket <> excluded.minute_bucket or usage.minute_requests < 4)
  returning true into permitted;
  return coalesce(permitted, false);
end;
$$;
revoke all on function public.consume_timetable_ai_quota() from public, anon;
grant execute on function public.consume_timetable_ai_quota() to authenticated;

-- Optional monthly maintenance can delete rows older than 30 days.
