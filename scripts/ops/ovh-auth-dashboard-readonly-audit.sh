#!/usr/bin/env bash
set -Eeuo pipefail
cd /home/ubuntu/neis-supabase
D=(sudo -n /usr/bin/docker compose -f docker-compose.yml -f docker-compose.security.yml -f docker-compose.caddy.yml)
"${D[@]}" exec -T db psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -Atqc "
select 'SCHEMA='||c.table_schema||'.'||c.table_name||':'||string_agg(c.column_name,',' order by c.ordinal_position)
from information_schema.columns c
where (c.table_schema,c.table_name) in (('auth','users'),('auth','identities'),('public','profiles'))
group by c.table_schema,c.table_name
union all
select 'FUNC='||p.proname||':'||pg_get_function_identity_arguments(p.oid)
from pg_proc p join pg_namespace n on p.pronamespace=n.oid
where n.nspname='public' and p.proname in ('main_admin_list_roles','main_admin_set_user_role','main_admin_server_usage')
order by 1
" </dev/null
"${D[@]}" exec -T db psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -Atqc "
select 'COUNTS_AUTH_USERS='||count(*) from auth.users
union all select 'COUNTS_PROFILES='||count(*) from public.profiles
union all select 'COUNTS_IDENTITY_GOOGLE='||count(*) from auth.identities where provider='google'
union all select 'COUNTS_POSTS='||count(*) from public.posts
union all select 'COUNTS_STORAGE_META='||count(*) from storage.objects
order by 1
" </dev/null
python3 - <<'PY'
import json,subprocess
from pathlib import Path
old="ydieijgynqlckaczalju.supabase.co"
new="supabase.neiscircle.site"
p=subprocess.run(["sudo","-n","/usr/bin/docker","inspect","supabase-caddy"],capture_output=True,text=True,timeout=20)
if p.returncode==0:
 data=json.loads(p.stdout)[0]
 mounts=[x.get("Source") for x in data.get("Mounts",[]) if x.get("Destination")=="/srv/neis-circle"]
 if len(mounts)==1 and mounts[0].startswith("/home/ubuntu/neis-frontend/releases/"):
  root=Path(mounts[0])
  print("RUNTIME_BASE_RELEASE=VALID")
  for f in ("index.html","scripts/01-core.js","neis-pwa-sw.js","scripts/server-usage-admin-v1.js","scripts/main-admin-roles-v1.js"):
   fp=root/f
   if fp.is_file():
    t=fp.read_text(errors="replace")
    key=f.replace("/","_").replace(".","_").upper()
    print("LIVE_FILE_"+key+"=PRESENT")
    print("LIVE_CLOUD_REF_"+key+"="+str(old in t))
    print("LIVE_OVH_REF_"+key+"="+str(new in t))
   else:print("LIVE_FILE_"+f.replace("/","_").replace(".","_").upper()+"=MISSING")
 else:print("RUNTIME_BASE_RELEASE=MISSING")
PY
echo "AUTH_SCHEMA_READONLY_AUDIT=COMPLETE"
