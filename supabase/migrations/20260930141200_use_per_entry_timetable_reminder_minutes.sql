create or replace function public.enqueue_due_timetable_reminders()
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare
  cairo_now timestamp without time zone := timezone('Africa/Cairo', now());
  cairo_date date := timezone('Africa/Cairo', now())::date;
  cairo_dow int := extract(dow from timezone('Africa/Cairo', now()))::int;
  inserted_count integer := 0;
begin
  with due as (
    select
      e.id,
      e.user_id,
      e.title,
      e.start_time,
      e.location,
      e.reminder_minutes
    from public.user_timetable_entries e
    where e.reminder_enabled=true
      and e.day_of_week=cairo_dow
      and (cairo_date + e.start_time - make_interval(mins=>e.reminder_minutes))
            <= cairo_now + interval '1 minute'
      and (cairo_date + e.start_time - make_interval(mins=>e.reminder_minutes))
            > cairo_now - interval '2 minutes'
      and not exists (
        select 1
        from public.user_timetable_reminder_log l
        where l.entry_id=e.id
          and l.occurrence_date=cairo_date
      )
  ),
  logged as (
    insert into public.user_timetable_reminder_log(entry_id,occurrence_date,user_id)
    select id,cairo_date,user_id from due
    on conflict(entry_id,occurrence_date) do nothing
    returning entry_id,user_id
  ),
  made as (
    insert into public.notifications(
      user_id,actor_id,type,title,body,entity_type,entity_id,route
    )
    select
      d.user_id,
      null,
      'timetable_reminder',
      'Upcoming: '||d.title,
      case
        when coalesce(nullif(d.location,''),'')<>'' then
          d.title||' starts in '||d.reminder_minutes||' minutes · '||d.location
        else
          d.title||' starts in '||d.reminder_minutes||' minutes'
      end,
      'timetable_entry',
      d.id::text,
      'timetable?entry='||d.id::text
    from due d
    join logged l on l.entry_id=d.id and l.user_id=d.user_id
    returning 1
  )
  select count(*) into inserted_count from made;

  return inserted_count;
end;
$$;