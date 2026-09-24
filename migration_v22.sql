-- NEIS Circle v22 — production Opportunities board.
begin;

create table if not exists public.opportunities (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 3 and 180),
  description text not null check (char_length(trim(description)) between 10 and 10000),
  opportunity_type text not null check (opportunity_type in ('Volunteering','Internship','Scholarship','Event','Competition','Course','Other')),
  organization text not null check (char_length(trim(organization)) between 2 and 180),
  location text not null default 'Online' check (char_length(trim(location)) between 2 and 180),
  external_url text,
  image_urls text[] not null default '{}',
  deadline date,
  start_date date,
  end_date date,
  status text not null default 'open' check (status in ('open','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint opportunities_external_url_check check (
    external_url is null or external_url = '' or external_url ~* '^https?://'
  ),
  constraint opportunities_date_order_check check (
    start_date is null or end_date is null or end_date >= start_date
  ),
  constraint opportunities_images_limit check (cardinality(image_urls) <= 6)
);

-- Upgrade the earlier empty opportunity table without destroying it.
alter table public.opportunities add column if not exists opportunity_type text;
alter table public.opportunities add column if not exists organization text;
alter table public.opportunities add column if not exists external_url text;
alter table public.opportunities add column if not exists image_urls text[];
alter table public.opportunities add column if not exists start_date date;
alter table public.opportunities add column if not exists end_date date;
alter table public.opportunities add column if not exists status text;
alter table public.opportunities add column if not exists updated_at timestamptz;

update public.opportunities set
  opportunity_type=coalesce(opportunity_type,nullif(category,''),'Other'),
  organization=coalesce(organization,'NEIS Circle'),
  external_url=coalesce(external_url,url),
  image_urls=coalesce(image_urls,'{}'),
  status=coalesce(status,case when approved then 'open' else 'open' end),
  updated_at=coalesce(updated_at,created_at,now()),
  location=coalesce(nullif(location,''),'Online');

alter table public.opportunities alter column opportunity_type set default 'Other';
alter table public.opportunities alter column opportunity_type set not null;
alter table public.opportunities alter column organization set default 'NEIS Circle';
alter table public.opportunities alter column organization set not null;
alter table public.opportunities alter column image_urls set default '{}';
alter table public.opportunities alter column image_urls set not null;
alter table public.opportunities alter column status set default 'open';
alter table public.opportunities alter column status set not null;
alter table public.opportunities alter column updated_at set default now();
alter table public.opportunities alter column updated_at set not null;
alter table public.opportunities alter column location set default 'Online';
alter table public.opportunities alter column location set not null;
-- Legacy fields remain available for compatibility but no longer block new posts.
alter table public.opportunities alter column category set default 'Other';
alter table public.opportunities alter column approved set default true;

do $$ begin
  if not exists(select 1 from pg_constraint where conname='opportunities_type_check') then
    alter table public.opportunities add constraint opportunities_type_check check (opportunity_type in ('Volunteering','Internship','Scholarship','Event','Competition','Course','Other'));
  end if;
  if not exists(select 1 from pg_constraint where conname='opportunities_status_check') then
    alter table public.opportunities add constraint opportunities_status_check check (status in ('open','closed'));
  end if;
  if not exists(select 1 from pg_constraint where conname='opportunities_external_url_check') then
    alter table public.opportunities add constraint opportunities_external_url_check check (external_url is null or external_url='' or external_url ~* '^https?://');
  end if;
  if not exists(select 1 from pg_constraint where conname='opportunities_date_order_check') then
    alter table public.opportunities add constraint opportunities_date_order_check check (start_date is null or end_date is null or end_date >= start_date);
  end if;
  if not exists(select 1 from pg_constraint where conname='opportunities_images_limit') then
    alter table public.opportunities add constraint opportunities_images_limit check (cardinality(image_urls) <= 6);
  end if;
end $$;

create index if not exists opportunities_created_at_idx on public.opportunities(created_at desc);
create index if not exists opportunities_deadline_idx on public.opportunities(deadline) where deadline is not null;
create index if not exists opportunities_type_idx on public.opportunities(opportunity_type);
create index if not exists opportunities_author_idx on public.opportunities(author_id);

create or replace function public.set_opportunity_updated_at()
returns trigger language plpgsql set search_path=public as $$
begin
  new.updated_at=now();
  return new;
end;
$$;

drop trigger if exists opportunities_updated_at_trigger on public.opportunities;
create trigger opportunities_updated_at_trigger
before update on public.opportunities
for each row execute function public.set_opportunity_updated_at();

alter table public.opportunities enable row level security;

drop policy if exists opportunities_read_authenticated on public.opportunities;
drop policy if exists "members read approved opportunities" on public.opportunities;
create policy opportunities_read_authenticated on public.opportunities
for select to authenticated using (true);

drop policy if exists opportunities_create_own on public.opportunities;
drop policy if exists "users submit opportunities" on public.opportunities;
create policy opportunities_create_own on public.opportunities
for insert to authenticated with check (author_id=auth.uid());

drop policy if exists opportunities_update_owner_admin on public.opportunities;
create policy opportunities_update_owner_admin on public.opportunities
for update to authenticated
using (author_id=auth.uid() or public.is_admin())
with check (author_id=auth.uid() or public.is_admin());

drop policy if exists opportunities_delete_owner_admin on public.opportunities;
create policy opportunities_delete_owner_admin on public.opportunities
for delete to authenticated using (author_id=auth.uid() or public.is_admin());

revoke all on public.opportunities from anon;
grant select,insert,update,delete on public.opportunities to authenticated;

do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime')
     and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='opportunities') then
    alter publication supabase_realtime add table public.opportunities;
  end if;
end $$;

commit;
