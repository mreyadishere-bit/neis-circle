#!/usr/bin/env bash
set -Eeuo pipefail
cd /home/ubuntu/neis-supabase
dc=(sudo -n /usr/bin/docker compose -f docker-compose.yml -f docker-compose.security.yml -f docker-compose.caddy.yml)
echo 'PUSH_AUDIT=READ_ONLY'
"${dc[@]}" exec -T db psql -X -U postgres -d postgres -Atqc "
SELECT 'REGISTER_EXISTS='||(to_regprocedure('public.register_web_push_subscription(text,text,text,text)') IS NOT NULL)::text
UNION ALL SELECT 'STATUS_EXISTS='||(to_regprocedure('public.get_web_push_subscription_status(text)') IS NOT NULL)::text
UNION ALL SELECT 'REGISTER_EXECUTE_AUTH='||(CASE WHEN to_regprocedure('public.register_web_push_subscription(text,text,text,text)') IS NOT NULL THEN has_function_privilege('authenticated','public.register_web_push_subscription(text,text,text,text)','EXECUTE') ELSE false END)::text
UNION ALL SELECT 'STATUS_EXECUTE_AUTH='||(CASE WHEN to_regprocedure('public.get_web_push_subscription_status(text)') IS NOT NULL THEN has_function_privilege('authenticated','public.get_web_push_subscription_status(text)','EXECUTE') ELSE false END)::text
UNION ALL SELECT 'PREF_EXECUTE_AUTH='||(CASE WHEN to_regprocedure('public.set_web_push_device_preferences(text,jsonb)') IS NOT NULL THEN has_function_privilege('authenticated','public.set_web_push_device_preferences(text,jsonb)','EXECUTE') ELSE false END)::text
UNION ALL SELECT 'TABLE_SUBS='||(to_regclass('public.web_push_subscriptions') IS NOT NULL)::text
UNION ALL SELECT 'VAPID_VAULT_PRESENT='||(to_regclass('vault.secrets') IS NOT NULL)::text;
" </dev/null || echo 'RPC_QUERY=FAILED'
"${dc[@]}" exec -T db psql -X -U postgres -d postgres -Atqc "
SELECT 'PUSH_ACTIVE='||count(*) FROM public.web_push_subscriptions WHERE enabled=true
UNION ALL SELECT 'PUSH_RECENT_1H='||count(*) FROM public.web_push_subscriptions WHERE last_seen_at>now()-interval '1 hour'
UNION ALL SELECT 'OUTBOX_PENDING='||count(*) FROM public.web_push_outbox WHERE status='pending'
UNION ALL SELECT 'OUTBOX_FAILED='||count(*) FROM public.web_push_outbox WHERE status='failed';
" </dev/null || echo 'SUBSCRIPTIONS_QUERY=FAILED'
"${dc[@]}" exec -T db psql -X -U postgres -d postgres -Atqc "
SELECT 'VAPID_KEY_PAIR_PRESENT='||(EXISTS(SELECT 1 FROM public.get_web_push_vapid_keys() WHERE length(public_key)>80 AND length(private_key)>30))::text;
" </dev/null || echo 'VAPID_QUERY=FAILED'
python3 - <<'PY'
import re,subprocess
for path in ('/srv/neis-circle/scripts/pwa-install-v117.js','/srv/neis-circle/neis-pwa-sw.js'):
 p=subprocess.run(['sudo','-n','/usr/bin/docker','exec','supabase-caddy','cat',path],capture_output=True,text=True,timeout=12)
 src=p.stdout if p.returncode==0 else ''
 label='LIVE_PWA' if 'pwa-install' in path else 'LIVE_WORKER'
 print(label+'_AVAILABLE='+str(bool(src)))
 print(label+'_VAPID_PRESENT='+str('VAPID_PUBLIC_KEY=' in src))
 if label=='LIVE_PWA':
  print(label+'_REGISTER_RPC='+str('register_web_push_subscription' in src))
  print(label+'_STATUS_RPC='+str('get_web_push_subscription_status' in src))
PY
echo 'PUSH_AUDIT=COMPLETE'
