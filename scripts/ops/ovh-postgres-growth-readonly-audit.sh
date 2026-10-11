#!/usr/bin/env bash
set -Eeuo pipefail
cd /home/ubuntu/neis-supabase
D=(sudo -n /usr/bin/docker compose -f docker-compose.yml -f docker-compose.security.yml -f docker-compose.caddy.yml)
"${D[@]}" exec -T db psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -Atq <<'SQL'
begin transaction read only;
select 'DATABASE_BYTES='||pg_database_size(current_database());
select 'TOP_RELATION='||s.nspname||'.'||c.relname||
 ';TOTAL_KIB='||round(pg_total_relation_size(c.oid)::numeric/1024,1)||
 ';DATA_KIB='||round(pg_relation_size(c.oid)::numeric/1024,1)||
 ';INDEX_KIB='||round(pg_indexes_size(c.oid)::numeric/1024,1)
from pg_class c join pg_namespace s on c.relnamespace=s.oid
where c.relkind='r' and s.nspname in ('public','auth','storage')
order by pg_total_relation_size(c.oid) desc limit 18;
select 'USAGE_SAMPLES_COUNT='||count(*)||
 ';LAST_2H='||count(*) filter(where collected_at>=now()-interval '2 hours')||
 ';LAST_24H='||count(*) filter(where collected_at>=now()-interval '24 hours')||
 ';AVG_JSON_BYTES='||coalesce(round(avg(pg_column_size(snapshot))::numeric,0),0)||
 ';TABLE_KIB='||round(pg_total_relation_size('public.neis_private_server_usage_samples'::regclass)::numeric/1024,1)
from public.neis_private_server_usage_samples;
select 'EMAIL_QUEUE_COUNT='||count(*)||
 ';LAST_2H='||count(*) filter(where created_at>=now()-interval '2 hours')||
 ';PENDING='||count(*) filter(where status='pending')||
 ';SENT='||count(*) filter(where status='sent')||
 ';FAILED='||count(*) filter(where status='failed')||
 ';TABLE_KIB='||round(pg_total_relation_size('public.email_notification_outbox'::regclass)::numeric/1024,1)
from public.email_notification_outbox;
select 'PUBLIC_TOTAL_KIB='||round(sum(pg_total_relation_size(c.oid))::numeric/1024,1)
from pg_class c join pg_namespace n on c.relnamespace=n.oid
where c.relkind='r' and n.nspname='public';
select 'AUTH_TOTAL_KIB='||round(sum(pg_total_relation_size(c.oid))::numeric/1024,1)
from pg_class c join pg_namespace n on c.relnamespace=n.oid
where c.relkind='r' and n.nspname='auth';
with points as (
 select collected_at,(snapshot->>'database_bytes')::bigint as bytes
 from public.neis_private_server_usage_samples
 where snapshot ? 'database_bytes' and (snapshot->>'database_bytes') ~ '^[0-9]{1,15}$'
), bounds as (
 select (select bytes from points order by collected_at asc limit 1) as first_bytes,
        (select collected_at from points order by collected_at asc limit 1) as first_time,
        (select bytes from points order by collected_at desc limit 1) as last_bytes,
        (select collected_at from points order by collected_at desc limit 1) as last_time
)
select 'HISTORY_DATABASE_FIRST_MIB='||round(first_bytes::numeric/1048576,3)||
 ';LAST_MIB='||round(last_bytes::numeric/1048576,3)||
 ';DELTA_KIB='||round((last_bytes-first_bytes)::numeric/1024,1)||
 ';DURATION_H='||round(extract(epoch from (last_time-first_time))::numeric/3600,2)
from bounds;
with points as (
 select collected_at,(snapshot->>'database_bytes')::bigint as bytes
 from public.neis_private_server_usage_samples
 where collected_at>=now()-interval '2 hours' and snapshot ? 'database_bytes'
 and (snapshot->>'database_bytes') ~ '^[0-9]{1,15}$'
)
select 'HISTORY_LAST_2H_CHANGE_KIB='||
  round(((select bytes from points order by collected_at desc limit 1)-
         (select bytes from points order by collected_at asc limit 1))::numeric/1024,1)
||';SAMPLES='||(select count(*) from points);
select 'TOP_ACTIVITY='||schemaname||'.'||relname||
  ';INSERTED_SINCE_STATS_RESET='||n_tup_ins||
  ';UPDATED_SINCE_STATS_RESET='||n_tup_upd||
  ';DELETED_SINCE_STATS_RESET='||n_tup_del||
  ';LIVE_ESTIMATE='||n_live_tup||
  ';DEAD_ESTIMATE='||n_dead_tup
from pg_stat_all_tables where schemaname in ('public','auth')
order by n_tup_ins+n_tup_upd desc limit 12;
select 'STATS_RESET='||coalesce(max(stats_reset)::text,'UNKNOWN') from pg_stat_database where datname=current_database();
select 'PERSISTENCE_CHECK=READ_ONLY_DONE';
rollback;
SQL
