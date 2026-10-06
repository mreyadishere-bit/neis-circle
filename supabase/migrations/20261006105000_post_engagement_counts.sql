create or replace function public.post_engagement_counts()
returns table(post_id bigint, reaction_count bigint, comment_count bigint)
language sql
stable
security invoker
set search_path=public
as $$
  with reaction_counts as (
    select r.post_id, count(*)::bigint as reaction_count
    from public.reactions r
    group by r.post_id
  ),
  comment_counts as (
    select c.post_id, count(*)::bigint as comment_count
    from public.comments c
    where c.deleted_at is null
    group by c.post_id
  )
  select p.id,
         coalesce(r.reaction_count,0)::bigint,
         coalesce(c.comment_count,0)::bigint
  from public.posts p
  left join reaction_counts r on r.post_id=p.id
  left join comment_counts c on c.post_id=p.id;
$$;

grant execute on function public.post_engagement_counts() to authenticated;
