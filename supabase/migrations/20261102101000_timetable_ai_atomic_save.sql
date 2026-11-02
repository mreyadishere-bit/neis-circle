-- Atomic, optimistic-concurrency timetable AI save.
-- All writes use the signed-in user's existing private timetable RLS policies.
create or replace function public.apply_timetable_ai_plan(p_plan jsonb, p_expected jsonb)
returns setof public.user_timetable_entries
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  item jsonb;
  row_id uuid;
  kept uuid[] := array[]::uuid[];
  saved_count integer;
  affected integer;
  raw_key text;
begin
  if uid is null then raise exception 'Sign in required'; end if;
  if p_plan is null or jsonb_typeof(p_plan) <> 'array' or jsonb_array_length(p_plan) > 80
     or p_expected is null or jsonb_typeof(p_expected) <> 'array'
     or jsonb_array_length(p_expected) > 80 then
    raise exception 'Invalid timetable plan';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(uid::text));
  -- Lock saved rows; compare BOTH the set of IDs and updated_at values.
  perform 1 from public.user_timetable_entries
    where user_id = uid for update;
  select count(*) into saved_count from public.user_timetable_entries where user_id = uid;
  if saved_count <> jsonb_array_length(p_expected) or exists (
    select 1 from public.user_timetable_entries e
      where e.user_id = uid and not exists (
        select 1 from jsonb_array_elements(p_expected) old
          where old->>'id' = e.id::text
            and (old->>'updated_at')::timestamptz = e.updated_at
      )
  ) then
    raise exception 'Your timetable changed. Reload it and try again.';
  end if;
  for item in select value from jsonb_array_elements(p_plan) as value loop
    if jsonb_typeof(item) <> 'object'
       or length(trim(coalesce(item->>'title',''))) not between 1 and 100
       or coalesce(item->>'day_of_week','') !~ '^[0-6]$'
       or coalesce(item->>'start_time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or coalesce(item->>'end_time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or item->>'end_time' <= item->>'start_time'
       or length(coalesce(item->>'location','')) > 120
       or length(coalesce(item->>'notes','')) > 1000
       or coalesce(item->>'category','Class') not in
         ('Class','Lab','Study','Exam','Activity','Other') then
      raise exception 'Invalid timetable item';
    end if;
    raw_key := coalesce(item->>'key','');
    if raw_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      row_id := raw_key::uuid;
      if row_id = any(kept) then raise exception 'Duplicate timetable entry'; end if;
      update public.user_timetable_entries set
        title=trim(item->>'title'),
        day_of_week=(item->>'day_of_week')::smallint,
        start_time=(item->>'start_time')::time,
        end_time=(item->>'end_time')::time,
        location=coalesce(item->>'location',''),
        notes=coalesce(item->>'notes',''),
        category=coalesce(item->>'category','Class')
      where id=row_id and user_id=uid;
      get diagnostics affected = row_count;
      if affected <> 1 then raise exception 'Unknown timetable entry'; end if;
    elsif raw_key = '' or raw_key ~ '^tmp_[a-f0-9-]{20,50}$' then
      insert into public.user_timetable_entries
        (user_id,title,day_of_week,start_time,end_time,location,notes,category,
         color,reminder_enabled,reminder_minutes)
      values (uid,trim(item->>'title'),(item->>'day_of_week')::smallint,
        (item->>'start_time')::time,(item->>'end_time')::time,
        coalesce(item->>'location',''),coalesce(item->>'notes',''),
        coalesce(item->>'category','Class'),'#2f7db8',false,15)
      returning id into row_id;
    else
      raise exception 'Invalid entry identifier';
    end if;
    kept := array_append(kept,row_id);
  end loop;
  delete from public.user_timetable_entries
    where user_id=uid and not (id=any(kept));
  return query select * from public.user_timetable_entries
    where user_id=uid order by day_of_week,start_time,title;
end;
$$;
revoke all on function public.apply_timetable_ai_plan(jsonb,jsonb) from public, anon;
grant execute on function public.apply_timetable_ai_plan(jsonb,jsonb) to authenticated;
