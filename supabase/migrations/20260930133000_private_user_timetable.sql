create table if not exists public.user_timetable_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  day_of_week smallint not null check (day_of_week between 0 and 6),
  title text not null check (char_length(trim(title)) between 1 and 100),
  start_time time not null,
  end_time time not null,
  notes text not null default '' check (char_length(notes) <= 1000),
  location text not null default '' check (char_length(location) <= 120),
  category text not null default 'Class' check (category in ('Class','Lab','Study','Exam','Activity','Other')),
  color text not null default '#2f7db8' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_time > start_time)
);

create index if not exists user_timetable_entries_owner_day_time_idx
  on public.user_timetable_entries(user_id,day_of_week,start_time);

alter table public.user_timetable_entries enable row level security;

drop policy if exists timetable_owner_select on public.user_timetable_entries;
create policy timetable_owner_select on public.user_timetable_entries
for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists timetable_owner_insert on public.user_timetable_entries;
create policy timetable_owner_insert on public.user_timetable_entries
for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists timetable_owner_update on public.user_timetable_entries;
create policy timetable_owner_update on public.user_timetable_entries
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists timetable_owner_delete on public.user_timetable_entries;
create policy timetable_owner_delete on public.user_timetable_entries
for delete to authenticated
using ((select auth.uid()) = user_id);

create or replace function public.touch_user_timetable_entry()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  new.updated_at=now();
  return new;
end;
$$;

drop trigger if exists user_timetable_entries_touch on public.user_timetable_entries;
create trigger user_timetable_entries_touch
before update on public.user_timetable_entries
for each row execute function public.touch_user_timetable_entry();

revoke all on public.user_timetable_entries from anon;
grant select,insert,update,delete on public.user_timetable_entries to authenticated;
