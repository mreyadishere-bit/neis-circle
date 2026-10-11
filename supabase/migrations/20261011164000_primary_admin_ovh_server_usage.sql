-- Internal server metrics. Only postgres owns raw records; RPC authenticates primary owner.
begin;
create table if not exists public.neis_private_server_usage_samples (
  collected_at timestamptz primary key default now(),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object')
);
alter table public.neis_private_server_usage_samples enable row level security;
alter table public.neis_private_server_usage_samples force row level security;
revoke all on public.neis_private_server_usage_samples from public, anon, authenticated;
create or replace function public.main_admin_server_usage()
returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, public, auth
as $function$
declare
  latest_record record;
  points jsonb;
begin
  if auth.uid() is null or not exists (
    select 1
    from auth.users u
    join public.profiles p on p.id=u.id
    where u.id=auth.uid()
      and u.id='25b556a3-ec6f-49e7-ac6c-1b09720e3bfd'::uuid
      and lower(coalesce(u.email,''))='mreyadishere@gmail.com'
      and p.role='admin'
      and coalesce(p.account_status,'active')='active'
  ) then
    raise exception 'Not authorized to access server monitoring' using errcode='42501';
  end if;

  select s.collected_at, s.snapshot
    into latest_record
    from public.neis_private_server_usage_samples s
    order by s.collected_at desc
    limit 1;
  if not found then
    return jsonb_build_object('current',null,'history','[]'::jsonb);
  end if;

  select coalesce(
    jsonb_agg(jsonb_build_object(
      'at', s.collected_at,
      'cpu', s.snapshot->'cpu',
      'ram', s.snapshot#>'{memory,percent}'
    ) order by s.collected_at), '[]'::jsonb)
  into points
  from (
    select collected_at, snapshot
      from public.neis_private_server_usage_samples
      order by collected_at desc
      limit 120
  ) s;

  return jsonb_build_object(
    'current', latest_record.snapshot || jsonb_build_object('at',latest_record.collected_at),
    'history', points
  );
end;
$function$;
revoke all on function public.main_admin_server_usage() from public, anon;
grant execute on function public.main_admin_server_usage() to authenticated;
commit;
