-- Main-owner-only capacity breakdown and bounded retention on self-hosted OVH.
-- No student, auth, post, chat, notifications or storage objects are deleted.
begin;
create table if not exists public.neis_private_usage_daily (
  day date primary key,
  recorded_at timestamptz not null,
  snapshot jsonb not null check (jsonb_typeof(snapshot)='object')
);
create table if not exists public.neis_private_storage_daily (
  day date primary key,
  recorded_at timestamptz not null,
  database_bytes bigint not null check(database_bytes>=0),
  relations jsonb not null check(jsonb_typeof(relations)='array')
);
alter table public.neis_private_usage_daily enable row level security;
alter table public.neis_private_usage_daily force row level security;
alter table public.neis_private_storage_daily enable row level security;
alter table public.neis_private_storage_daily force row level security;
revoke all on public.neis_private_usage_daily from PUBLIC,anon,authenticated;
revoke all on public.neis_private_storage_daily from PUBLIC,anon,authenticated;

create or replace function public.neis_maintenance_storage_retention()
returns jsonb
language plpgsql volatile security definer
set search_path=pg_catalog,public
as $maintenance$
declare
  recent JSONB;
  cleaned_detailed int := 0;
  cleaned_email int := 0;
  captured bigint := 0;
begin
  -- Callable only through a local PostgreSQL superuser maintenance job.
  -- This is NOT an authenticated user or front-end RPC.
  if session_user <> 'postgres' then
    raise exception 'Host maintenance only' using errcode='42501';
  end if;

  -- Preserve one sample from each day before trimming minute-level samples.
  insert into public.neis_private_usage_daily(day,recorded_at,snapshot)
  select day,recorded_at,snapshot
  from (
    select distinct on ((s.collected_at at time zone 'UTC')::date)
      (s.collected_at at time zone 'UTC')::date as day,
      s.collected_at as recorded_at,s.snapshot
    from public.neis_private_server_usage_samples s
    order by (s.collected_at at time zone 'UTC')::date, s.collected_at desc
  ) recent_days
  on conflict(day) do update set
    recorded_at=excluded.recorded_at,
    snapshot=excluded.snapshot
  where excluded.recorded_at>neis_private_usage_daily.recorded_at;

  -- Only today's table sizes can be sampled now. Never fabricate past relation sizes.
  select coalesce(jsonb_agg(jsonb_build_object(
       'schema',t.nspname,
       'table',t.relname,
       'size_bytes',t.total_bytes,
       'data_bytes',t.data_bytes,
       'index_bytes',t.index_bytes
      ) order by t.total_bytes desc,t.nspname,t.relname),'[]'::jsonb)
  into recent from (
    select n.nspname,c.relname,
      pg_total_relation_size(c.oid)::bigint as total_bytes,
      pg_relation_size(c.oid)::bigint as data_bytes,
      pg_indexes_size(c.oid)::bigint as index_bytes
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where c.relkind='r' and n.nspname in ('public','auth','storage')
  ) t;
  select pg_database_size(current_database()) into captured;
  insert into public.neis_private_storage_daily(day,recorded_at,database_bytes,relations)
  values((now() at time zone 'UTC')::date,now(),captured,recent)
  on conflict(day) do update set
    recorded_at=excluded.recorded_at,
    database_bytes=excluded.database_bytes,
    relations=excluded.relations
  where excluded.recorded_at>neis_private_storage_daily.recorded_at;

  -- 24-hour *detailed* history. The daily summaries above persist for 90 days.
  with expired as (
    select collected_at from public.neis_private_server_usage_samples
    where collected_at < now()-interval '24 hours'
    order by collected_at limit 5000
  ), deleted as (
    delete from public.neis_private_server_usage_samples s
    using expired e where s.collected_at=e.collected_at returning 1
  )
  select count(*) into cleaned_detailed from deleted;
  delete from public.neis_private_usage_daily
  where day < (now() at time zone 'UTC')::date-90;
  delete from public.neis_private_storage_daily
  where day < (now() at time zone 'UTC')::date-90;

  -- Retain manual emails 90 days, all other provider-accepted outbox receipts
  -- 30 days. Never touch pending/sending/failed or unprocessed jobs.
  -- Existing manual broadcast summary/audit records are retained indefinitely.
  with expired as (
    select id from public.email_notification_outbox
    where status='sent'
      and processed_at is not null
      and processed_at <
        now()-case when event_key like 'manual-content:%'
              then interval '90 days' else interval '30 days' end
    order by processed_at limit 300
  ), deleted as (
    delete from public.email_notification_outbox o using expired x
    where o.id=x.id and o.status='sent' returning 1
  )
  select count(*) into cleaned_email from deleted;

  return jsonb_build_object('detailed_pruned',cleaned_detailed,
    'accepted_outbox_pruned',cleaned_email,
    'database_bytes',captured);
end;
$maintenance$;

revoke all on function public.neis_maintenance_storage_retention()
  from PUBLIC,anon,authenticated;
grant execute on function public.neis_maintenance_storage_retention() to postgres;

create or replace function public.main_admin_database_storage()
returns jsonb
language plpgsql stable security definer
set search_path=pg_catalog,public,auth
as $owner$
declare
  listed jsonb;
  history jsonb;
  current_bytes bigint;
  prev_bytes bigint;
  prev_day date;
  latest_summary timestamptz;
  detail_count bigint;
  sent_outbox_count bigint;
  all_relation_bytes bigint;
begin
  if auth.uid() is null or auth.role()<>'authenticated' or not exists (
    select 1 from auth.users u join public.profiles p on p.id=u.id
    where u.id=auth.uid()
      and u.id='25b556a3-ec6f-49e7-ac6c-1b09720e3bfd'::uuid
      and lower(u.email)='mreyadishere@gmail.com'
      and p.role='admin' and coalesce(p.account_status,'active')='active'
      and u.deleted_at is null
  ) then raise exception 'Main admin only' using errcode='42501'; end if;

  select pg_database_size(current_database()) into current_bytes;
  with sizes as (
    select n.nspname,c.relname,
     pg_total_relation_size(c.oid)::bigint as total,
     pg_relation_size(c.oid)::bigint as data,
     pg_indexes_size(c.oid)::bigint as indexes
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where c.relkind='r' and n.nspname in ('public','auth','storage')
  )
  select coalesce(jsonb_agg(jsonb_build_object(
     'schema',t.nspname,'table',t.relname,
     'bytes',t.total,'data_bytes',t.data,'index_bytes',t.indexes
     ) order by t.total desc),'[]'::jsonb)
    into listed from (
      select * from sizes order by total desc,nspname,relname limit 15
    ) t;

  select coalesce(sum(pg_total_relation_size(c.oid)),0)::bigint
  into all_relation_bytes
  from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where c.relkind='r' and n.nspname in ('public','auth','storage');

  select coalesce(jsonb_agg(jsonb_build_object(
    'day',d.day,'bytes',d.database_bytes,'at',d.recorded_at
    ) order by d.day),'[]'::jsonb)
  into history
  from (
    select day,database_bytes,recorded_at
    from public.neis_private_storage_daily
    order by day desc limit 90
  ) d;

  select database_bytes,day into prev_bytes,prev_day
    from public.neis_private_storage_daily
    where day<(now() at time zone 'UTC')::date
    order by day desc limit 1;
  select max(recorded_at) into latest_summary from public.neis_private_storage_daily;
  select count(*) into detail_count from public.neis_private_server_usage_samples;
  select count(*) into sent_outbox_count from public.email_notification_outbox where status='sent';

  return jsonb_build_object(
    'database_bytes',current_bytes,
    'relations_bytes',all_relation_bytes,
    'tables',listed,
    'history',history,
    'previous_day',prev_day,
    'previous_bytes',prev_bytes,
    'daily_change_bytes',case when prev_bytes is null then null else current_bytes-prev_bytes end,
    'detail_samples',detail_count,
    'sent_outbox_count',sent_outbox_count,
    'detail_retention_hours',24,
    'summary_retention_days',90,
    'sent_outbox_retention_days',30,
    'manual_outbox_retention_days',90,
    'last_summary_at',latest_summary
  );
end;
$owner$;

revoke all on function public.main_admin_database_storage() from PUBLIC,anon,authenticated;
grant execute on function public.main_admin_database_storage() to authenticated;
commit;
notify pgrst,'reload schema';
