#!/usr/bin/env bash
# Safely diagnose missing data in production, without touching user content.
set -Eeuo pipefail
cd /home/ubuntu/neis-supabase
dc=(sudo -n /usr/bin/docker compose -f docker-compose.yml -f docker-compose.security.yml -f docker-compose.caddy.yml)
echo 'LIVE_DATA_DIAGNOSIS=READ_ONLY'
"${dc[@]}" exec -T db psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -Atqc "
SELECT 'COUNT_PROFILES='||count(*) FROM public.profiles
UNION ALL SELECT 'COUNT_AUTH_USERS='||count(*) FROM auth.users
UNION ALL SELECT 'COUNT_AUTH_IDENTITIES='||count(*) FROM auth.identities
UNION ALL SELECT 'COUNT_POSTS='||count(*) FROM public.posts
UNION ALL SELECT 'COUNT_ARTICLES='||count(*) FROM public.articles
UNION ALL SELECT 'COUNT_CIRCLES='||count(*) FROM public.circles
UNION ALL SELECT 'COUNT_MESSAGES='||count(*) FROM public.messages
UNION ALL SELECT 'COUNT_CIRCLE_MESSAGES='||count(*) FROM public.circle_messages
UNION ALL SELECT 'COUNT_NOTIFICATIONS='||count(*) FROM public.notifications
UNION ALL SELECT 'COUNT_STORAGE_OBJECTS='||count(*) FROM storage.objects
UNION ALL SELECT 'COUNT_PROFILE_AUTH_ORPHANS='||count(*) FROM public.profiles p LEFT JOIN auth.users u ON u.id=p.id WHERE u.id IS NULL
UNION ALL SELECT 'COUNT_PUBLIC_POLICIES='||count(*) FROM pg_policies WHERE schemaname='public'
UNION ALL SELECT 'COUNT_ENABLED_RLS_PUBLIC='||count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relrowsecurity
ORDER BY 1;
" </dev/null
"${dc[@]}" exec -T db psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -Atqc "
SELECT 'RLS_'||c.relname||'='||c.relrowsecurity::text
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind IN ('r','p')
AND c.relname IN ('profiles','posts','articles','circles')
ORDER BY c.relname;
" </dev/null
"${dc[@]}" exec -T db psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -Atqc "
SELECT 'SELECT_POLICY_'||tablename||'='||count(*) FROM pg_policies
WHERE schemaname='public' AND tablename IN ('profiles','posts','articles','circles')
AND (cmd IN ('SELECT','ALL'))
GROUP BY tablename ORDER BY tablename;
" </dev/null
# Only report aggregate Content-Range, never actual profile/post contents.
python3 - <<'PY'
import pathlib,re,urllib.request,urllib.error
env=(pathlib.Path('/home/ubuntu/neis-supabase')/'.env').read_text()
m=re.search(r'^ANON_KEY=(.*)$',env,re.M)
key=m.group(1).strip().strip('"').strip("'") if m else ''
print('LIVE_ANON_KEY_PRESENT='+str(bool(key)))
if not key:raise SystemExit('LIVE_REST_CHECK=BLOCKED_MISSING_KEY')
base='https://supabase.neiscircle.site/rest/v1/'
for table in ('profiles','posts','articles','circles'):
 for label,auth in (('anon',False),):
  req=urllib.request.Request(base+table+'?select=id&limit=1',headers={
   'apikey':key,'Authorization':'Bearer '+key,'Prefer':'count=exact',
   'Range':'0-0','Origin':'https://neiscircle.site','User-Agent':'NEIS-Live-Data-Audit'})
  try:res=urllib.request.urlopen(req,timeout=15)
  except urllib.error.HTTPError as e:res=e
  except Exception:
   print('REST_'+table.upper()+'_'+label+'_NETWORK=FAIL')
   continue
  with res:
   value=res.headers.get('Content-Range','').split('/')[-1]
   print('REST_'+table.upper()+'_'+label+'_HTTP='+str(res.status))
   print('REST_'+table.upper()+'_'+label+'_VISIBLE_COUNT='+value if value.isdigit() or value=='*' else 'UNKNOWN')
print('LIVE_DATA_DIAGNOSIS=COMPLETE_NO_USER_RECORDS')
PY
