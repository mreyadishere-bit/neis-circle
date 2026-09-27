create or replace function public.study_lessons_are_valid(values_input text[])
returns boolean
language sql
immutable
set search_path=public
as $$
  select coalesce(
    cardinality(values_input) between 1 and 20
    and bool_and(btrim(value)<>'' and char_length(btrim(value))<=160),
    false
  )
  from unnest(values_input) as value;
$$;

alter table public.study_resources
  add column if not exists lessons text[] not null default '{}'::text[];

update public.study_resources
set lessons = array[lesson]
where coalesce(cardinality(lessons),0)=0
  and btrim(coalesce(lesson,''))<>'';

alter table public.study_resources
  drop constraint if exists study_resources_lessons_nonempty;

alter table public.study_resources
  add constraint study_resources_lessons_nonempty
  check (public.study_lessons_are_valid(lessons));

grant insert(lessons), update(lessons) on public.study_resources to authenticated;

drop index if exists public.study_resources_hierarchy_idx;
create index if not exists study_resources_hierarchy_idx
  on public.study_resources(subject,unit,created_at desc);
create index if not exists study_resources_lessons_gin_idx
  on public.study_resources using gin(lessons);

drop function if exists public.study_filter_values(text,text,text);
create function public.study_filter_values(
  level_input text,
  subject_input text default null,
  unit_input text default null
)
returns table(value text)
language sql
stable
security invoker
set search_path=public
as $$
  select distinct x.value
  from public.study_resources r
  cross join lateral (
    select case
      when level_input='subject' then r.subject
      when level_input='unit' then r.unit
      else null
    end as value
    where level_input in ('subject','unit')
    union all
    select l
    from unnest(r.lessons) as l
    where level_input='lesson'
  ) x
  where (level_input='subject' or r.subject=subject_input)
    and (level_input<>'lesson' or r.unit=unit_input)
    and x.value is not null
    and btrim(x.value)<>''
  order by 1;
$$;

revoke all on function public.study_filter_values(text,text,text) from public,anon;
grant execute on function public.study_filter_values(text,text,text) to authenticated;

drop function if exists public.study_resource_page(text,text,text,text,text,text,text,boolean,integer,integer);
create function public.study_resource_page(
  mode_input text default 'resources',
  subject_input text default null,
  unit_input text default null,
  lesson_input text default null,
  search_input text default null,
  type_input text default null,
  language_input text default null,
  oldest_input boolean default false,
  page_size_input integer default 12,
  offset_input integer default 0
)
returns table(
  id uuid,
  author_id uuid,
  title text,
  description text,
  subject text,
  unit text,
  lesson text,
  lessons text[],
  external_url text,
  resource_type text,
  language text,
  link_access_confirmed boolean,
  helpful_count integer,
  created_at timestamptz,
  updated_at timestamptz,
  total_count bigint
)
language sql
stable
security invoker
set search_path=public
as $$
  select
    r.id,r.author_id,r.title,r.description,r.subject,r.unit,r.lesson,r.lessons,r.external_url,
    r.resource_type,r.language,r.link_access_confirmed,r.helpful_count,r.created_at,r.updated_at,
    count(*) over()
  from public.study_resources r
  where mode_input in ('resources','saved','my')
    and (mode_input<>'my' or r.author_id=(select auth.uid()))
    and (
      mode_input<>'saved'
      or exists(
        select 1 from public.study_resource_actions a
        where a.resource_id=r.id
          and a.user_id=(select auth.uid())
          and a.saved
      )
    )
    and (subject_input is null or r.subject=subject_input)
    and (unit_input is null or r.unit=unit_input)
    and (lesson_input is null or lesson_input=any(r.lessons))
    and (type_input is null or r.resource_type=type_input)
    and (language_input is null or r.language=language_input)
    and (
      search_input is null
      or btrim(search_input)=''
      or r.title ilike '%'||btrim(search_input)||'%'
      or r.description ilike '%'||btrim(search_input)||'%'
      or r.subject ilike '%'||btrim(search_input)||'%'
      or r.unit ilike '%'||btrim(search_input)||'%'
      or array_to_string(r.lessons,' ') ilike '%'||btrim(search_input)||'%'
    )
  order by
    case when oldest_input then r.created_at end asc,
    case when not oldest_input then r.created_at end desc,
    r.id
  limit least(greatest(page_size_input,1),24)
  offset greatest(offset_input,0);
$$;

revoke all on function public.study_resource_page(text,text,text,text,text,text,text,boolean,integer,integer) from public,anon;
grant execute on function public.study_resource_page(text,text,text,text,text,text,text,boolean,integer,integer) to authenticated;
