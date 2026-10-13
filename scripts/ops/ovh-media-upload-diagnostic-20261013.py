#!/usr/bin/env python3
"""Read-only, privacy-preserving 2026-10-13 diagnosis of OVH post media failures.
Print statuses and failure categories only: no user IDs, object names, tokens,
URLs, email addresses, raw logs, SQL policy expressions or secrets.
"""
import json,re,subprocess,urllib.request,urllib.error
from pathlib import Path
root=Path('/home/ubuntu/neis-supabase')
docker=['sudo','-n','/usr/bin/docker']
files=['docker-compose.yml','docker-compose.security.yml','docker-compose.caddy.yml']
base=docker+['compose']+[a for f in files for a in ('-f',f)]
def run(args,timeout=35):
 try:return subprocess.run(args,cwd=root,text=True,capture_output=True,timeout=timeout)
 except Exception:return None
def echo(key,value):
 print('MEDIA_DIAG_'+key+'='+str(value))
def sql(query):
 p=run(base+['exec','-T','db','psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-Atqc',query],timeout=25)
 return p.stdout.strip() if p and p.returncode==0 else None

for service in ['storage','rest','db','caddy']:
 p=run(base+['ps','-q',service])
 cid=p.stdout.strip() if p and p.returncode==0 else ''
 if not cid:
  echo('SERVICE_'+service.upper(),'ABSENT')
  continue
 stat=run(docker+['inspect','--format','{{.State.Running}}',cid])
 echo('SERVICE_'+service.upper(), 'RUNNING' if stat and stat.stdout.strip()=='true' else 'STOPPED')
 if service=='storage':
  insp=run(docker+['inspect',cid])
  if insp and insp.returncode==0:
   item=json.loads(insp.stdout)[0]
   env=dict(x.split('=',1) for x in item['Config'].get('Env',[]) if '=' in x)
   echo('STORAGE_BACKEND','FILE' if env.get('STORAGE_BACKEND')=='file' else 'OTHER')
   mount=[x for x in item.get('Mounts',[]) if x.get('Destination')=='/var/lib/storage']
   echo('STORAGE_RW_MOUNT',len(mount)==1 and mount[0].get('RW') is True)
   echo('STORAGE_FILE_ETAG_MODE',env.get('FILE_STORAGE_ETAG_ALGORITHM','UNSPECIFIED')
        if env.get('FILE_STORAGE_ETAG_ALGORITHM','') in ['mtime','md5'] else 'OTHER_OR_UNSET')

# Verify whether RLS actually enforces policies, plus the authenticated role's grants.
rls=sql("""SELECT c.relrowsecurity::text||','||c.relforcerowsecurity::text
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='storage' AND c.relname='objects' AND c.relkind IN ('r','p');""")
if rls:
 vals=rls.split(',')
 if len(vals)==2:
  echo('STORAGE_OBJECT_RLS_ENABLED',vals[0])
  echo('STORAGE_OBJECT_FORCE_RLS',vals[1])
for name,query in [
 ('AUTH_ROLE_EXISTS',"SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated')::text;"),
 ('AUTH_ROLE_TABLE_INSERT',"SELECT has_table_privilege('authenticated','storage.objects','INSERT')::text;"),
 ('AUTH_ROLE_TABLE_SELECT',"SELECT has_table_privilege('authenticated','storage.objects','SELECT')::text;"),
 ('AUTH_ROLE_TABLE_DELETE',"SELECT has_table_privilege('authenticated','storage.objects','DELETE')::text;"),
 ('AUTH_ROLE_SCHEMA_USAGE',"SELECT has_schema_privilege('authenticated','storage','USAGE')::text;"),
 ('AUTH_UID_FUNCTION_EXISTS',"SELECT to_regprocedure('auth.uid()') IS NOT NULL;")
]:
 value=sql(query)
 echo(name,value if value in ['t','f'] else 'UNKNOWN')

# No personal data or object names in these aggregates.
bucket=sql("""SELECT json_build_object('exists',EXISTS
   (SELECT 1 FROM storage.buckets WHERE id='community-media'),
   'public',(SELECT public FROM storage.buckets WHERE id='community-media'),
   'limit',(SELECT file_size_limit FROM storage.buckets WHERE id='community-media'),
   'mime',(SELECT allowed_mime_types FROM storage.buckets WHERE id='community-media')
   )::text;""")
if bucket:
 try:
  o=json.loads(bucket)
  echo('BUCKET_EXISTS',bool(o['exists']))
  echo('BUCKET_PUBLIC',o['public'])
  echo('BUCKET_SIZE_LIMIT_BYTES',o['limit'] if o['limit'] is not None else 'NO_BUCKET_LIMIT')
  allowed=o.get('mime')
  echo('BUCKET_ALLOW_JPEG',allowed is None or 'image/jpeg' in allowed)
  echo('BUCKET_ALLOW_WEBP',allowed is None or 'image/webp' in allowed)
 except Exception:echo('BUCKET_QUERY','INVALID')
else:echo('BUCKET_QUERY','FAILED')
policies=sql("""SELECT count(*)::text||','||count(*) FILTER (WHERE cmd IN ('INSERT','ALL'))::text||
 ','||count(*) FILTER (WHERE roles::text LIKE '%authenticated%')::text
 FROM pg_policies WHERE schemaname='storage' AND tablename='objects';""")
if policies:
 counts=policies.split(',')
 if len(counts)==3:
  echo('STORAGE_POLICIES_TOTAL',counts[0])
  echo('STORAGE_INSERT_POLICIES',counts[1])
  echo('STORAGE_AUTHENTICATED_ROLE_POLICIES',counts[2])
else:echo('STORAGE_POLICIES_QUERY','FAILED')

latest=sql("""SELECT count(*) FILTER (WHERE created_at > now()-interval '2 hours')::text||','||
 count(*) FILTER (WHERE created_at > now()-interval '1 day')::text
 FROM storage.objects WHERE bucket_id='community-media';""")
if latest:
 pairs=latest.split(',')
 if len(pairs)==2:
  echo('NEW_OBJECTS_LAST_2H',pairs[0])
  echo('NEW_OBJECTS_LAST_DAY',pairs[1])

# Only aggregate categorical log signals, never print entire logs.
p=run(base+['logs','--since','2h','--no-color','storage'],timeout=40)
if not p or p.returncode:
 echo('STORAGE_LOGS','UNAVAILABLE')
else:
 data=(p.stdout+'\n'+p.stderr).lower()
 patterns={
  'REQUEST_ERROR':r'\"level\"\s*:\s*\"error\"|\berror\b|statuscode\":(?:4|5)\d\d',
  'HTTP_400':r'\"statuscode\"\s*:\s*400|\"status\"\s*:\s*400',
  'HTTP_401':r'\"statuscode\"\s*:\s*401|unauthorized|invalid jwt|jwt expired',
  'HTTP_403':r'\"statuscode\"\s*:\s*403|forbidden|row.level.security|row-level security',
  'HTTP_413':r'\"statuscode\"\s*:\s*413|payload too large|file size limit',
  'HTTP_415':r'\"statuscode\"\s*:\s*415|mime type|unsupported media type',
  'HTTP_500':r'\"statuscode\"\s*:\s*50\d|internalservererror|internal server error',
  'FILESYSTEM_PERMISSION':r'eacces|permission denied|eperm|operation not permitted',
  'FILESYSTEM_NO_SPACE':r'enospc|no space left',
  'FILESYSTEM_NOT_FOUND':r'enoent|no such file or directory',
  'DATABASE_OR_POLICY':r'permission denied for (table|schema)|new row violates row-level|policy|postgrest|database error',
  'OBJECT_ALREADY_EXISTS':r'objectalreadyexists|resourcealreadyexists|already exists',
  'UPSTREAM_TIMEOUT':r'etimedout|timeout|econnrefused|socket hang up'
 }
 for name,pat in patterns.items():
  echo('LOG_'+name,bool(re.search(pat,data)))
 echo('STORAGE_LOG_LINES',min(len(data.splitlines()),999999))
for endpoint in ['https://supabase.neiscircle.site/storage/v1/status',
                 'https://supabase.neiscircle.site/storage/v1/health']:
 try:
  request=urllib.request.Request(endpoint,headers={'User-Agent':'NEIS-private-ReadOnly-Upload-Diagnostic'})
  with urllib.request.urlopen(request,timeout=9) as response: status=response.status
 except urllib.error.HTTPError as e:status=e.code
 except Exception:status=0
 echo('PUBLIC_'+('STATUS' if endpoint.endswith('status') else 'HEALTH'),status)
echo('COMPLETED','READ_ONLY_NO_PRIVATE_DATA')
