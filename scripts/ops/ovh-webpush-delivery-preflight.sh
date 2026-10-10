#!/usr/bin/env bash
set -Eeuo pipefail
cd /home/ubuntu/neis-supabase
dc=(sudo -n /usr/bin/docker compose -f docker-compose.yml -f docker-compose.security.yml -f docker-compose.caddy.yml)
"${dc[@]}" exec -T db psql -X -U postgres -d postgres -Atqc "
SELECT 'VAULT_EXTENSION='||(to_regclass('vault.secrets') IS NOT NULL)::text
UNION ALL SELECT 'VAULT_CREATE_FUNCTION='||(to_regprocedure('vault.create_secret(text,text,text)') IS NOT NULL)::text
UNION ALL SELECT 'VAULT_PUBLIC_VAPID_RECORD='||exists(SELECT 1 FROM vault.secrets WHERE name='neis_web_push_vapid_public')::text
UNION ALL SELECT 'VAULT_PRIVATE_VAPID_RECORD='||exists(SELECT 1 FROM vault.secrets WHERE name='neis_web_push_vapid_private')::text
UNION ALL SELECT 'DISPATCH_USES_OLD_CLOUD='||(pg_get_functiondef('private.dispatch_web_push_job()'::regprocedure) LIKE '%ydieijgynqlckaczalju.supabase.co%')::text
UNION ALL SELECT 'DISPATCH_USES_SELFHOST='||(pg_get_functiondef('private.dispatch_web_push_job()'::regprocedure) LIKE '%supabase.neiscircle.site%')::text
UNION ALL SELECT 'CRON_TABLE_PRESENT='||(to_regclass('cron.job') IS NOT NULL)::text;
" </dev/null
"${dc[@]}" exec -T db psql -X -U postgres -d postgres -Atqc "
SELECT 'WEBPUSH_CRON_JOB_COUNT='||count(*) FROM cron.job WHERE jobname='neis-web-push-retry'
UNION ALL SELECT 'WEBPUSH_CRON_OLD_URL_COUNT='||count(*) FROM cron.job WHERE jobname='neis-web-push-retry' AND command LIKE '%ydieijgynqlckaczalju.supabase.co%';
" </dev/null
echo 'WEBPUSH_PREFLIGHT=COMPLETE_READ_ONLY'
