#!/usr/bin/env bash
set -Eeuo pipefail
cd /home/ubuntu/neis-supabase
dc=(sudo -n /usr/bin/docker compose -f docker-compose.yml -f docker-compose.security.yml -f docker-compose.caddy.yml)
echo 'PUSH_DELIVERY_AUDIT=READ_ONLY'
"${dc[@]}" exec -T db psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -Atqc "
SELECT 'EXTENSION_PG_NET='||exists(SELECT 1 FROM pg_extension WHERE extname='pg_net')::text
UNION ALL SELECT 'EXTENSION_PG_CRON='||exists(SELECT 1 FROM pg_extension WHERE extname='pg_cron')::text
UNION ALL SELECT 'EXTENSION_VAULT='||exists(SELECT 1 FROM pg_extension WHERE extname='supabase_vault')::text
UNION ALL SELECT 'PRIVATE_PUSH_DISPATCH_FUNCTION='||(to_regprocedure('private.dispatch_web_push_job()') IS NOT NULL)::text
UNION ALL SELECT 'PUSH_OUTBOX_TRIGGER='||exists(SELECT 1 FROM pg_trigger WHERE tgname='web_push_outbox_dispatch' AND tgenabled<>'D')::text
UNION ALL SELECT 'NET_HTTP_POST_FUNCTION='||exists(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='net' AND p.proname='http_post')::text
UNION ALL SELECT 'NET_REQUEST_QUEUE='||(to_regclass('net.http_request_queue') IS NOT NULL)::text
UNION ALL SELECT 'PUSH_DISPATCH_OLD_CLOUD='||(CASE WHEN to_regprocedure('private.dispatch_web_push_job()') IS NOT NULL THEN pg_get_functiondef('private.dispatch_web_push_job()'::regprocedure) LIKE '%ydieijgynqlckaczalju.supabase.co%' ELSE false END)::text
UNION ALL SELECT 'PUSH_DISPATCH_OVH='||(CASE WHEN to_regprocedure('private.dispatch_web_push_job()') IS NOT NULL THEN pg_get_functiondef('private.dispatch_web_push_job()'::regprocedure) LIKE '%supabase.neiscircle.site%' ELSE false END)::text;
" </dev/null || echo 'DELIVERY_SCHEMA_CHECK_FAILED'
python3 - <<'PY'
import urllib.request,urllib.error,json
base='https://supabase.neiscircle.site/functions/v1/send-web-push'
request=urllib.request.Request(base,data=json.dumps({'job_id':'synthetic-invalid','dispatch_token':'synthetic-invalid'}).encode(),headers={'Content-Type':'application/json','User-Agent':'NEIS-Delivery-Audit'},method='POST')
try:r=urllib.request.urlopen(request,timeout=12)
except urllib.error.HTTPError as e:r=e
except Exception:
 print('SEND_WEB_PUSH_NETWORK=FAILED')
 r=None
if r:
 with r:
  print('SEND_WEB_PUSH_HTTP='+str(r.status))
  print('SEND_WEB_PUSH_TYPE='+(r.headers.get('Content-Type','').split(';')[0] or 'other'))
  print('SEND_WEB_PUSH_CORS='+str(r.headers.get('Access-Control-Allow-Origin') in ('*','https://neiscircle.site')))
PY
echo 'PUSH_DELIVERY_AUDIT=COMPLETE_NO_IDENTIFIERS'
