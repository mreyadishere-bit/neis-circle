#!/usr/bin/env bash
set -Eeuo pipefail
cd /home/ubuntu/neis-supabase
dc=(sudo -n /usr/bin/docker compose -f docker-compose.yml -f docker-compose.security.yml -f docker-compose.caddy.yml)
echo 'WEBPUSH_DISPATCH_AUDIT=READ_ONLY'
"${dc[@]}" exec -T db psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -Atqc "
SELECT 'VAULT_PUBLIC_SECRET_RECORD='||exists(SELECT 1 FROM vault.secrets WHERE name='neis_web_push_vapid_public')::text
UNION ALL SELECT 'VAULT_PRIVATE_SECRET_RECORD='||exists(SELECT 1 FROM vault.secrets WHERE name='neis_web_push_vapid_private')::text
UNION ALL SELECT 'VAULT_PUBLIC_DECRYPTED_USABLE='||exists(SELECT 1 FROM vault.decrypted_secrets WHERE name='neis_web_push_vapid_public' AND length(decrypted_secret)>80)::text
UNION ALL SELECT 'VAULT_PRIVATE_DECRYPTED_USABLE='||exists(SELECT 1 FROM vault.decrypted_secrets WHERE name='neis_web_push_vapid_private' AND length(decrypted_secret)>30)::text
UNION ALL SELECT 'DISPATCH_FUNCTION_PRESENT='||(to_regprocedure('private.dispatch_web_push_job()') IS NOT NULL)::text
UNION ALL SELECT 'WEBPUSH_SEND_FUNCTION_PRESENT='||exists(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.proname='get_web_push_vapid_keys' AND n.nspname='public')::text;
" </dev/null || echo 'VAULT_AUDIT=UNAVAILABLE'
"${dc[@]}" exec -T db psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -Atqc "
SELECT 'DISPATCH_POINTS_OLD_HOST='||(CASE WHEN to_regprocedure('private.dispatch_web_push_job()') IS NOT NULL THEN pg_get_functiondef('private.dispatch_web_push_job()'::regprocedure) LIKE '%ydieijgynqlckaczalju.supabase.co%' ELSE false END)::text
UNION ALL SELECT 'DISPATCH_POINTS_NEW_HOST='||(CASE WHEN to_regprocedure('private.dispatch_web_push_job()') IS NOT NULL THEN pg_get_functiondef('private.dispatch_web_push_job()'::regprocedure) LIKE '%supabase.neiscircle.site%' ELSE false END)::text
UNION ALL SELECT 'PUSH_RETRY_CRON_COUNT='||count(*)::text FROM cron.job WHERE jobname='neis-web-push-retry'
UNION ALL SELECT 'PUSH_RETRY_CRON_OLD_HOST_COUNT='||count(*)::text FROM cron.job WHERE jobname='neis-web-push-retry' AND command LIKE '%ydieijgynqlckaczalju.supabase.co%';
" </dev/null || echo 'DISPATCH_QUERY=UNAVAILABLE'
python3 - <<'PY'
import subprocess,re
p=subprocess.run(['sudo','-n','/usr/bin/docker','exec','supabase-caddy','cat','/srv/neis-circle/neis-pwa-sw.js'],capture_output=True,text=True,timeout=15)
worker=p.stdout if p.returncode==0 else ''
q=subprocess.run(['sudo','-n','/usr/bin/docker','exec','supabase-caddy','cat','/srv/neis-circle/scripts/pwa-install-v117.js'],capture_output=True,text=True,timeout=15)
frontend=q.stdout if q.returncode==0 else ''
w=re.search(r'VAPID_PUBLIC_KEY\s*=\s*["\x27]([A-Za-z0-9_-]{80,100})',worker)
f=re.search(r'VAPID_PUBLIC_KEY\s*=\s*["\x27]([A-Za-z0-9_-]{80,100})',frontend)
print('ACTIVE_WORKER_PUBLIC_KEY_PRESENT='+str(bool(w)))
print('ACTIVE_PWA_PUBLIC_KEY_PRESENT='+str(bool(f)))
print('ACTIVE_PUBLIC_VAPID_MATCH='+str(bool(w and f and w.group(1)==f.group(1))))
print('ACTIVE_WORKER_ROTATION_POINTS_LEGACY='+str('ydieijgynqlckaczalju.supabase.co' in worker))
print('ACTIVE_WORKER_ROTATION_POINTS_SELFHOST='+str('supabase.neiscircle.site' in worker))
PY
echo 'WEBPUSH_DISPATCH_AUDIT=COMPLETE_NO_SECRETS'
