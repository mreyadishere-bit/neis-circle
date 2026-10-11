-- Read-only trend data added to the existing authenticated main-admin monitoring RPC.
-- Keep the exact account, email, active-profile and admin-role checks.
begin;
create or replace function public.main_admin_server_usage()
returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, public, auth
as $function$
declare
  latest_record record;
  points jsonb;
  trends jsonb;
  count_24h integer;
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

  select s.collected_at, s.snapshot into latest_record
    from public.neis_private_server_usage_samples s
    order by s.collected_at desc limit 1;
  if not found then
    return jsonb_build_object('current',null,'history','[]'::jsonb,'trends','[]'::jsonb,
                              'samples_24h',0,'retention_days',30);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
     'at', s.collected_at,
     'cpu', s.snapshot->'cpu',
     'ram', s.snapshot#>'{memory,percent}'
  ) order by s.collected_at),'[]'::jsonb) into points
  from (select collected_at, snapshot
        from public.neis_private_server_usage_samples
        order by collected_at desc limit 120) s;

  -- Return one verified observation per six-hour window, not 43,200 minute-level rows.
  select coalesce(jsonb_agg(jsonb_build_object(
     'at', s.collected_at,
     'disk_used_gib',s.snapshot#>'{disk,used_gib}',
     'disk_total_gib',s.snapshot#>'{disk,total_gib}',
     'database_bytes',s.snapshot->'database_bytes'
  ) order by s.collected_at),'[]'::jsonb) into trends
  from (
     select collected_at, snapshot from (
       select distinct on (date_bin('6 hours', collected_at, '2000-01-01'::timestamptz))
         collected_at, snapshot
       from public.neis_private_server_usage_samples
       where collected_at >= now() - interval '30 days'
       order by date_bin('6 hours',collected_at,'2000-01-01'::timestamptz), collected_at desc
     ) buckets
     order by collected_at desc limit 120
  ) s;

  select count(*) into count_24h
    from public.neis_private_server_usage_samples
    where collected_at >= now() - interval '24 hours';

  return jsonb_build_object(
    'current',latest_record.snapshot||jsonb_build_object('at',latest_record.collected_at),
    'history',points,'trends',trends,
    'samples_24h',count_24h,'retention_days',30);
end;
$function$;
revoke all on function public.main_admin_server_usage() from public, anon;
grant execute on function public.main_admin_server_usage() to authenticated;
commit;
