-- NEIS Circle v23 — reliable, permission-aware global search.
-- The function runs as the signed-in caller, so existing RLS policies remain
-- the authority for which profiles, posts and circles may be returned.
begin;

drop function if exists public.global_search(text, integer);

create or replace function public.global_search(
  search_query text,
  result_limit integer default 30
)
returns table (
  type text,
  id text,
  title text,
  subtitle text,
  preview text,
  created_at timestamptz,
  relevance integer
)
language sql
stable
security invoker
set search_path = public
as $$
  with input as (
    select
      trim(coalesce(search_query, '')) as term,
      greatest(1, least(coalesce(result_limit, 30), 60)) as max_rows
  ), candidates as (
    select
      'profile'::text as type,
      p.id::text as id,
      coalesce(nullif(trim(p.full_name), ''), 'NEIS Student')::text as title,
      concat_ws(' · ', nullif('@' || p.username, '@'), nullif(p.grade, ''), nullif(p.branch, ''))::text as subtitle,
      coalesce(nullif(trim(p.bio), ''), array_to_string(p.interests, ' · '), '')::text as preview,
      null::timestamptz as created_at,
      case
        when lower(coalesce(p.username, '')) = lower(i.term) then 120
        when lower(coalesce(p.full_name, '')) = lower(i.term) then 115
        when position(lower(i.term) in lower(coalesce(p.username, ''))) > 0 then 100
        when position(lower(i.term) in lower(coalesce(p.full_name, ''))) > 0 then 95
        else 60
      end::integer as relevance
    from public.profiles p cross join input i
    where char_length(i.term) >= 2
      and position(lower(i.term) in lower(concat_ws(' ', p.full_name, p.username, p.grade, p.branch, p.bio, array_to_string(p.interests, ' ')))) > 0

    union all

    select
      'post'::text,
      p.id::text,
      coalesce(nullif(trim(p.title), ''), 'Post')::text,
      concat_ws(' · ', nullif(p.kind, ''), nullif(pr.full_name, ''))::text,
      left(coalesce(p.body, ''), 240)::text,
      p.created_at,
      case
        when lower(coalesce(p.title, '')) = lower(i.term) then 105
        when position(lower(i.term) in lower(coalesce(p.title, ''))) > 0 then 90
        when position(lower(i.term) in lower(coalesce(array_to_string(p.tags, ' '), ''))) > 0 then 80
        else 55
      end::integer
    from public.posts p
    left join public.profiles pr on pr.id = p.author_id
    cross join input i
    where char_length(i.term) >= 2
      and position(lower(i.term) in lower(concat_ws(' ', p.title, p.body, array_to_string(p.tags, ' '), p.kind, pr.full_name))) > 0

    union all

    select
      'circle'::text,
      c.id::text,
      c.name::text,
      concat_ws(' · ', nullif(c.category, ''), case when c.privacy = 'private' then 'Private Circle' else 'Public Circle' end)::text,
      left(coalesce(c.description, ''), 240)::text,
      c.created_at,
      case
        when lower(c.name) = lower(i.term) then 110
        when position(lower(i.term) in lower(c.name)) > 0 then 92
        else 50
      end::integer
    from public.circles c cross join input i
    where char_length(i.term) >= 2
      and position(lower(i.term) in lower(concat_ws(' ', c.name, c.description, c.category))) > 0
  )
  select c.type, c.id, c.title, c.subtitle, c.preview, c.created_at, c.relevance
  from candidates c cross join input i
  order by c.relevance desc, c.created_at desc nulls last, c.title asc
  limit (select max_rows from input);
$$;

revoke all on function public.global_search(text, integer) from public, anon;
grant execute on function public.global_search(text, integer) to authenticated;

commit;

select 'NEIS Circle v23 global search ready' as result;
