-- Timetable AI: hard per-user AND project-wide request caps for a Groq Free Plan.
-- IMPORTANT: enable the API only on a Groq Free account. Never configure a paid key.
-- Apply to active OVH DB before enabling the Edge Function.
create table if not exists public.timetable_ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null,
  requests integer not null default 0,
  minute_bucket timestamptz not null,
  minute_requests integer not null default 0,
  primary key (user_id, usage_date)
);
create table if not exists public.timetable_ai_global_usage (
  usage_date date primary key,
  requests integer not null default 0,
  minute_bucket timestamptz not null,
  minute_requests integer not null default 0
);
alter table public.timetable_ai_usage enable row level security;
alter table public.timetable_ai_global_usage enable row level security;
revoke all on table public.timetable_ai_usage from public, anon, authenticated;
revoke all on table public.timetable_ai_global_usage from public, anon, authenticated;

create or replace function public.consume_timetable_ai_quota()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  permitted boolean;
  uid uuid := (select auth.uid());
  day_utc date := (now() at time zone 'utc')::date;
  minute_utc timestamptz := date_trunc('minute', now());
  global_daily integer;
  global_minute integer;
  global_bucket timestamptz;
begin
  if uid is null then return false; end if;
  -- The single dated global row is locked until the end of this RPC.
  -- This serializes quota deductions across all signed-in students.
  insert into public.timetable_ai_global_usage
    (usage_date, requests, minute_bucket, minute_requests)
  values (day_utc, 0, minute_utc, 0)
  on conflict (usage_date) do nothing;

  select requests, minute_bucket, minute_requests
  into global_daily, global_bucket, global_minute
  from public.timetable_ai_global_usage
  where usage_date = day_utc
  for update;

  -- Stay beneath provider's published 1K/day and 30/min request quotas.
  -- The provider enforces separate token limits and can respond with 429 earlier.
  if global_daily >= 600 then return false; end if;
  if global_bucket = minute_utc and global_minute >= 15 then return false; end if;

  -- Per-student protection: max 25/day, 4/min. Rejected requests are not
  -- counted against the global quota (all operations are one transaction).
  insert into public.timetable_ai_usage as usage
    (user_id, usage_date, requests, minute_bucket, minute_requests)
  values (uid, day_utc, 1, minute_utc, 1)
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

  if not coalesce(permitted,false) then return false; end if;
  update public.timetable_ai_global_usage
  set requests = requests + 1,
      minute_bucket = minute_utc,
      minute_requests = case when minute_bucket = minute_utc
        then minute_requests + 1 else 1 end
  where usage_date = day_utc;
  return true;
end;
$$;
revoke all on function public.consume_timetable_ai_quota() from public, anon;
grant execute on function public.consume_timetable_ai_quota() to authenticated;

-- Optional monthly maintenance can remove entries older than 30 days.
