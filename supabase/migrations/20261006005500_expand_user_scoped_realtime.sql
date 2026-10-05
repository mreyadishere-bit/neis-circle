do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='bookmarks'
  ) then
    alter publication supabase_realtime add table public.bookmarks;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='study_resources'
  ) then
    alter publication supabase_realtime add table public.study_resources;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='study_resource_actions'
  ) then
    alter publication supabase_realtime add table public.study_resource_actions;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='user_timetable_entries'
  ) then
    alter publication supabase_realtime add table public.user_timetable_entries;
  end if;
end
$$;
