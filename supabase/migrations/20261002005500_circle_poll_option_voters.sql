create or replace function public.get_circle_poll_option_voters(p_poll_id uuid,p_option_id uuid)
returns table(
  user_id uuid,
  full_name text,
  username text,
  grade text,
  branch text,
  campus text,
  avatar_url text
)
language plpgsql
security definer
set search_path=public
as $$
declare
  v_poll public.circle_polls%rowtype;
  v_circle_id uuid;
  v_role text;
  v_has_voted boolean;
  v_closed boolean;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;

  select cp.* into v_poll
  from public.circle_polls cp
  where cp.id=p_poll_id;

  if not found then raise exception 'Poll not found'; end if;

  select p.circle_id into v_circle_id
  from public.posts p
  where p.id=v_poll.post_id;

  if v_poll.anonymous then raise exception 'This poll is anonymous'; end if;

  if not exists(select 1 from public.circle_poll_options o where o.id=p_option_id and o.poll_id=p_poll_id) then
    raise exception 'Invalid poll option';
  end if;

  v_role:=public.circle_role(v_circle_id);
  if v_role is null and not public.is_admin() then
    raise exception 'Only Circle members can view voters';
  end if;

  select exists(
    select 1 from public.circle_poll_votes v
    where v.poll_id=p_poll_id and v.user_id=auth.uid()
  ) into v_has_voted;

  v_closed:=v_poll.closed_at is not null or (v_poll.closes_at is not null and v_poll.closes_at<=now());

  if not v_has_voted
     and not v_closed
     and auth.uid()<>v_poll.creator_id
     and coalesce(v_role,'') not in ('owner','admin','moderator')
     and not public.is_admin()
  then
    raise exception 'Vote first to view voters';
  end if;

  return query
  select pr.id,pr.full_name,pr.username,pr.grade,pr.branch,pr.campus,pr.avatar_url
  from public.circle_poll_votes v
  join public.profiles pr on pr.id=v.user_id
  where v.poll_id=p_poll_id and v.option_id=p_option_id
  order by lower(coalesce(pr.full_name,'')),lower(coalesce(pr.username,''));
end $$;

revoke all on function public.get_circle_poll_option_voters(uuid,uuid) from public,anon;
grant execute on function public.get_circle_poll_option_voters(uuid,uuid) to authenticated;
