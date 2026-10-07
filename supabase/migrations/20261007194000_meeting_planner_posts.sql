-- Meeting Planner post type: weekly availability ranges + aggregate best-time calculation.

alter table public.posts drop constraint if exists posts_kind_check;
alter table public.posts add constraint posts_kind_check
check (kind = any (array[
  'Discussion'::text,'Question'::text,'Resource'::text,'Experience'::text,
  'Poll'::text,'Opportunity'::text,'Announcement'::text,'Meeting Planner'::text
]));

create table if not exists public.meeting_planners (
  post_id uuid primary key references public.posts(id) on delete cascade,
  creator_id uuid not null references public.profiles(id) on delete cascade,
  timezone text not null default 'Africa/Cairo',
  slot_minutes integer not null default 30 check (slot_minutes in (15,30,60)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.meeting_availability_ranges (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.meeting_planners(post_id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  start_minute smallint not null check (start_minute between 0 and 1425),
  end_minute smallint not null check (end_minute between 15 and 1440),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meeting_availability_range_order check (end_minute > start_minute)
);

create index if not exists meeting_availability_post_user_idx
on public.meeting_availability_ranges(post_id,user_id);

create table if not exists public.meeting_availability_responses (
  post_id uuid not null references public.meeting_planners(post_id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  updated_at timestamptz not null default now(),
  primary key(post_id,user_id)
);

alter table public.meeting_planners enable row level security;
alter table public.meeting_availability_ranges enable row level security;
alter table public.meeting_availability_responses enable row level security;

drop policy if exists "meeting planners read" on public.meeting_planners;
create policy "meeting planners read"
on public.meeting_planners for select to authenticated
using (
  exists(
    select 1 from public.posts p
    where p.id=post_id
      and (
        p.circle_id is null
        or exists(select 1 from public.circle_members cm where cm.circle_id=p.circle_id and cm.user_id=(select auth.uid()) and cm.status='active')
        or exists(select 1 from public.circles c where c.id=p.circle_id and c.owner_id=(select auth.uid()))
        or public.is_admin()
      )
  )
);

drop policy if exists "meeting ranges own read" on public.meeting_availability_ranges;
create policy "meeting ranges own read"
on public.meeting_availability_ranges for select to authenticated
using (
  user_id=(select auth.uid())
  and exists(
    select 1 from public.posts p
    where p.id=post_id
      and (
        p.circle_id is null
        or exists(select 1 from public.circle_members cm where cm.circle_id=p.circle_id and cm.user_id=(select auth.uid()) and cm.status='active')
        or exists(select 1 from public.circles c where c.id=p.circle_id and c.owner_id=(select auth.uid()))
        or public.is_admin()
      )
  )
);

drop policy if exists "meeting responses own read" on public.meeting_availability_responses;
create policy "meeting responses own read"
on public.meeting_availability_responses for select to authenticated
using (
  user_id=(select auth.uid())
  and exists(
    select 1 from public.posts p
    where p.id=post_id
      and (
        p.circle_id is null
        or exists(select 1 from public.circle_members cm where cm.circle_id=p.circle_id and cm.user_id=(select auth.uid()) and cm.status='active')
        or exists(select 1 from public.circles c where c.id=p.circle_id and c.owner_id=(select auth.uid()))
        or public.is_admin()
      )
  )
);

revoke all on public.meeting_planners from anon;
revoke all on public.meeting_availability_ranges from anon;
revoke all on public.meeting_availability_responses from anon;
grant select on public.meeting_planners to authenticated;
grant select on public.meeting_availability_ranges to authenticated;
grant select on public.meeting_availability_responses to authenticated;

create or replace function public.touch_meeting_planner_from_range()
returns trigger
language plpgsql
security invoker
set search_path=pg_catalog,public
as $$
begin
  update public.meeting_planners
  set updated_at=now()
  where post_id=coalesce(new.post_id,old.post_id);
  return coalesce(new,old);
end;
$$;

drop trigger if exists meeting_availability_touch_planner on public.meeting_availability_ranges;
create trigger meeting_availability_touch_planner
after insert or update or delete on public.meeting_availability_ranges
for each row execute function public.touch_meeting_planner_from_range();

drop trigger if exists meeting_response_touch_planner on public.meeting_availability_responses;
create trigger meeting_response_touch_planner
after insert or update or delete on public.meeting_availability_responses
for each row execute function public.touch_meeting_planner_from_range();

create or replace function public.create_meeting_planner_post(
  p_title text,
  p_body text,
  p_tags text[] default '{}',
  p_circle_id uuid default null,
  p_timezone text default 'Africa/Cairo',
  p_slot_minutes integer default 30
)
returns uuid
language plpgsql
security definer
set search_path=pg_catalog,public,auth
as $$
declare
  v_post_id uuid;
begin
  if auth.uid() is null then raise exception 'Not authorized' using errcode='42501'; end if;
  if char_length(btrim(coalesce(p_title,'')))<3 then raise exception 'Title is too short' using errcode='22023'; end if;
  if char_length(btrim(coalesce(p_body,'')))<1 then raise exception 'Description is required' using errcode='22023'; end if;
  if p_slot_minutes not in (15,30,60) then raise exception 'Invalid slot size' using errcode='22023'; end if;

  if p_circle_id is not null and not exists(
    select 1 from public.circle_members cm
    where cm.circle_id=p_circle_id and cm.user_id=auth.uid() and cm.status='active'
  ) and not exists(
    select 1 from public.circles c where c.id=p_circle_id and c.owner_id=auth.uid()
  ) and not public.is_admin() then
    raise exception 'Not a Circle member' using errcode='42501';
  end if;

  insert into public.posts(author_id,circle_id,kind,title,body,tags,post_type)
  values(auth.uid(),p_circle_id,'Meeting Planner',btrim(p_title),btrim(p_body),coalesce(p_tags,'{}'),'meeting_availability')
  returning id into v_post_id;

  insert into public.meeting_planners(post_id,creator_id,timezone,slot_minutes)
  values(v_post_id,auth.uid(),coalesce(nullif(btrim(p_timezone),''),'Africa/Cairo'),p_slot_minutes);

  return v_post_id;
end;
$$;

create or replace function public.save_meeting_availability(
  p_post_id uuid,
  p_ranges jsonb
)
returns boolean
language plpgsql
security definer
set search_path=pg_catalog,public,auth
as $$
declare
  v_count integer;
begin
  if auth.uid() is null then raise exception 'Not authorized' using errcode='42501'; end if;
  if jsonb_typeof(coalesce(p_ranges,'[]'::jsonb))<>'array' then raise exception 'Ranges must be an array' using errcode='22023'; end if;
  v_count=jsonb_array_length(coalesce(p_ranges,'[]'::jsonb));
  if v_count>40 then raise exception 'Too many ranges' using errcode='22023'; end if;

  if not exists(select 1 from public.meeting_planners mp where mp.post_id=p_post_id) then
    raise exception 'Meeting planner not found' using errcode='P0002';
  end if;

  if exists(
    select 1 from public.posts p
    where p.id=p_post_id and p.circle_id is not null
      and not (
        exists(select 1 from public.circle_members cm where cm.circle_id=p.circle_id and cm.user_id=auth.uid() and cm.status='active')
        or exists(select 1 from public.circles c where c.id=p.circle_id and c.owner_id=auth.uid())
        or public.is_admin()
      )
  ) then raise exception 'Not allowed to respond to this Circle planner' using errcode='42501'; end if;

  create temporary table if not exists tmp_meeting_ranges(day_of_week smallint,start_minute smallint,end_minute smallint) on commit drop;
  truncate tmp_meeting_ranges;

  insert into tmp_meeting_ranges(day_of_week,start_minute,end_minute)
  select (x->>'day')::smallint,(x->>'start')::smallint,(x->>'end')::smallint
  from jsonb_array_elements(coalesce(p_ranges,'[]'::jsonb)) x;

  if exists(select 1 from tmp_meeting_ranges where day_of_week not between 0 and 6 or start_minute<0 or end_minute>1440 or end_minute<=start_minute or start_minute%15<>0 or end_minute%15<>0) then
    raise exception 'Invalid availability range' using errcode='22023';
  end if;

  if exists(
    select 1 from tmp_meeting_ranges a join tmp_meeting_ranges b
      on a.ctid<>b.ctid and a.day_of_week=b.day_of_week
      and a.start_minute<b.end_minute and b.start_minute<a.end_minute
  ) then raise exception 'Availability ranges cannot overlap' using errcode='22023'; end if;

  delete from public.meeting_availability_ranges where post_id=p_post_id and user_id=auth.uid();
  insert into public.meeting_availability_ranges(post_id,user_id,day_of_week,start_minute,end_minute)
  select p_post_id,auth.uid(),day_of_week,start_minute,end_minute from tmp_meeting_ranges;

  insert into public.meeting_availability_responses(post_id,user_id,updated_at)
  values(p_post_id,auth.uid(),now())
  on conflict(post_id,user_id) do update set updated_at=excluded.updated_at;

  update public.meeting_planners set updated_at=now() where post_id=p_post_id;
  return true;
end;
$$;

create or replace function public.get_meeting_planner_results(p_post_ids uuid[])
returns table(post_id uuid,day_of_week smallint,slot_start integer,available_count bigint,participant_count bigint)
language sql
security definer
set search_path=pg_catalog,public,auth
as $$
  with allowed as (
    select mp.post_id,mp.slot_minutes
    from public.meeting_planners mp
    join public.posts p on p.id=mp.post_id
    where mp.post_id=any(coalesce(p_post_ids,'{}'::uuid[]))
      and auth.uid() is not null
      and (
        p.circle_id is null
        or exists(select 1 from public.circle_members cm where cm.circle_id=p.circle_id and cm.user_id=auth.uid() and cm.status='active')
        or exists(select 1 from public.circles c where c.id=p.circle_id and c.owner_id=auth.uid())
        or public.is_admin()
      )
  ),
  participants as (
    select r.post_id,count(*)::bigint participant_count
    from public.meeting_availability_responses r
    join allowed a on a.post_id=r.post_id
    group by r.post_id
  ),
  slots as (
    select a.post_id,d.day::smallint day_of_week,s.slot_start::integer,a.slot_minutes
    from allowed a
    cross join generate_series(0,6) d(day)
    cross join lateral generate_series(0,1440-a.slot_minutes,a.slot_minutes) s(slot_start)
  )
  select s.post_id,s.day_of_week,s.slot_start,
    count(distinct r.user_id)::bigint available_count,
    coalesce(p.participant_count,0)::bigint participant_count
  from slots s
  left join public.meeting_availability_ranges r
    on r.post_id=s.post_id and r.day_of_week=s.day_of_week
    and r.start_minute<=s.slot_start and r.end_minute>=s.slot_start+s.slot_minutes
  left join participants p on p.post_id=s.post_id
  group by s.post_id,s.day_of_week,s.slot_start,p.participant_count
  order by s.post_id,s.day_of_week,s.slot_start;
$$;

revoke all on function public.create_meeting_planner_post(text,text,text[],uuid,text,integer) from public,anon;
revoke all on function public.save_meeting_availability(uuid,jsonb) from public,anon;
revoke all on function public.get_meeting_planner_results(uuid[]) from public,anon;
grant execute on function public.create_meeting_planner_post(text,text,text[],uuid,text,integer) to authenticated;
grant execute on function public.save_meeting_availability(uuid,jsonb) to authenticated;
grant execute on function public.get_meeting_planner_results(uuid[]) to authenticated;

do $$
begin
  if not exists(
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='meeting_planners'
  ) then alter publication supabase_realtime add table public.meeting_planners; end if;
end $$;
