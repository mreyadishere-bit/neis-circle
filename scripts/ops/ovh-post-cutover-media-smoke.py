#!/usr/bin/env python3
"""Read-only audit of every migrated media object and live frontend/Google Auth."""
import json,concurrent.futures,subprocess,urllib.request,urllib.error,urllib.parse,re
from collections import Counter
from pathlib import Path
root='/home/ubuntu/neis-supabase'
cmd=['sudo','-n','/usr/bin/docker','compose','-f','docker-compose.yml','-f','docker-compose.security.yml','-f','docker-compose.caddy.yml','exec','-T','db','psql','-X','-U','postgres','-d','postgres','-Atqc']
q="""SELECT coalesce(json_agg(json_build_object('bucket',o.bucket_id,'name',o.name,'public',b.public) ORDER BY o.bucket_id,o.name),'[]'::json)::text FROM storage.objects o JOIN storage.buckets b ON b.id=o.bucket_id;"""
p=subprocess.run(cmd+[q],cwd=root,capture_output=True,text=True,timeout=30)
if p.returncode:raise SystemExit('MEDIA_AUDIT=DB_QUERY_FAILED')
try:objects=json.loads(p.stdout)
except Exception:raise SystemExit('MEDIA_AUDIT=DB_RESULT_BAD')
if len(objects)!=104:raise SystemExit('MEDIA_AUDIT=OBJECT_COUNT_CHANGED')
env={}
for line in Path('/home/ubuntu/neis-supabase/.env').read_text().splitlines():
 if '=' in line and not line.lstrip().startswith('#'):
  k,v=line.split('=',1);env[k]=v.strip().strip('"').strip("'")
key=env.get('SERVICE_ROLE_KEY','')
anon=env.get('ANON_KEY','')
if not key or not anon:raise SystemExit('MEDIA_AUDIT=LOCAL_KEYS_MISSING')
def probe(obj):
 visibility='PUBLIC' if obj['public'] else 'PRIVATE'
 bucket=urllib.parse.quote(obj['bucket'],safe='')
 name=urllib.parse.quote(obj['name'],safe='/')
 endpoint='object/public/'+bucket+'/'+name if obj['public'] else 'object/'+bucket+'/'+name
 request=urllib.request.Request('https://supabase.neiscircle.site/storage/v1/'+endpoint,headers={
 'User-Agent':'NEIS-OVH-Private-ReadOnly-Media-Smoke','Range':'bytes=0-15',
 'apikey':anon,'authorization':'Bearer '+key})
 try:
  with urllib.request.urlopen(request,timeout=15) as response:
   response.read(16)
   return (visibility,response.status)
 except urllib.error.HTTPError as ex:return (visibility,ex.code)
 except Exception:return (visibility,0)
with concurrent.futures.ThreadPoolExecutor(max_workers=7) as pool:
 results=list(pool.map(probe,objects))
bytype=Counter(t for t,_ in results)
statuses=Counter((t,s) for t,s in results)
print('MEDIA_TOTAL_OBJECTS='+str(len(objects)))
print('MEDIA_PUBLIC_COUNT='+str(bytype['PUBLIC']))
print('MEDIA_PRIVATE_COUNT='+str(bytype['PRIVATE']))
for (visibility,status),count in sorted(statuses.items()):
 print('MEDIA_'+visibility+'_HTTP_'+str(status)+'='+str(count))
passed=all(code in (200,206) for _,code in results)
print('MEDIA_ALL_OBJECTS_READABLE='+('YES' if passed else 'NO'))
for host in ('neiscircle.site','www.neiscircle.site'):
 try:
  req=urllib.request.Request('https://'+host+'/',headers={'User-Agent':'NEIS-OVH-Post-Cutover','Cache-Control':'no-cache'})
  with urllib.request.urlopen(req,timeout=12) as response:
   page=response.read(400000).decode('utf-8','replace')
   valid=response.status==200 and "We'll be back soon" not in page and 'scripts/01-core.js' in page
   print('FRONTEND_'+host.replace('.','_')+'_APP='+('PASS' if valid else 'FAIL'))
   passed=passed and valid
 except Exception:
  print('FRONTEND_'+host.replace('.','_')+'_APP=FAIL')
  passed=False
try:
 req=urllib.request.Request('https://neiscircle.site/scripts/01-core.js?health=pkce',headers={'Cache-Control':'no-cache'})
 with urllib.request.urlopen(req,timeout=12) as response:
  code=response.read(1100000).decode('utf-8','replace')
  good="flowType:'pkce'" in code and 'https://supabase.neiscircle.site' in code
  print('GOOGLE_OAUTH_PKCE_PRODUCTION='+('YES' if good else 'NO'))
  passed=passed and good
except Exception:
 print('GOOGLE_OAUTH_PKCE_PRODUCTION=UNAVAILABLE')
 passed=False
print('POST_CUTOVER_SMOKE='+('PASS' if passed else 'FAIL'))
if not passed:raise SystemExit(1)
