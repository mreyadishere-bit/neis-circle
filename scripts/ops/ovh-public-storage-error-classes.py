#!/usr/bin/env python3
"""Read-only public Storage probe. Outputs only HTTP statuses and sanitized categories."""
import urllib.request,urllib.error,urllib.parse,json,subprocess,re
root='/home/ubuntu/neis-supabase'
cmd=['sudo','-n','/usr/bin/docker','compose','-f','docker-compose.yml','-f','docker-compose.security.yml','-f','docker-compose.caddy.yml','exec','-T','db','psql','-X','-U','postgres','-d','postgres','-Atqc']
sql="""SELECT name FROM storage.objects WHERE bucket_id='community-media' ORDER BY name LIMIT 1;"""
p=subprocess.run(cmd+[sql],cwd=root,capture_output=True,text=True,timeout=25)
if p.returncode or not p.stdout.strip() or '\n' in p.stdout.strip():
 raise SystemExit('PUBLIC_STORAGE_PROBE=NO_SAFE_SAMPLE')
name=p.stdout.strip()
url='https://supabase.neiscircle.site/storage/v1/object/public/community-media/'+urllib.parse.quote(name,safe='/')
q=subprocess.run(cmd+["SELECT CASE WHEN EXISTS(SELECT 1 FROM storage.buckets WHERE id='community-media' AND public=true) THEN 'YES' ELSE 'NO' END;"],cwd=root,capture_output=True,text=True)
print('STORAGE_COMMUNITY_BUCKET_PUBLIC='+('YES' if q.stdout.strip()=='YES' else 'NO_OR_UNKNOWN'))
def classify(data):
 try:
  obj=json.loads(data.decode('utf-8','replace'))
 except Exception:return 'NON_JSON'
 if not isinstance(obj,dict):return 'NON_OBJECT'
 fields=' '.join(str(obj.get(k,'')).lower() for k in ('code','error','message','statusCode'))
 cases={
   'EISDIR':r'eisdir|is a directory',
   'ENOENT':r'enoent|no such file',
   'EACCES':r'eacces|permission denied',
   'NOT_FOUND':r'not.found|no.such.key',
   'DATABASE':r'postgres|database|sqlstate|connection',
   'AUTH':r'invalid.*jwt|authorization|unauthorized|apikey',
   'INTERNAL':r'internalservererror|internal server error',
   'CONTENT_METADATA':r'xattr|attribute|metadata',
 }
 return next((key for key,pat in cases.items() if re.search(pat,fields)),'OTHER_JSON_ERROR')
for method,headers in [('GET_RANGE',{'Range':'bytes=0-15'}),('GET_NORMAL',{}),('HEAD',{})]:
 req=urllib.request.Request(url,headers={'User-Agent':'NEIS-Private-Storage-Read-Diag',**headers},method='HEAD' if method=='HEAD' else 'GET')
 try:res=urllib.request.urlopen(req,timeout=15)
 except urllib.error.HTTPError as e:res=e
 except Exception as e:
  print('STORAGE_'+method+'_NETWORK='+type(e).__name__);continue
 with res:
  body=res.read(4096)
  print('STORAGE_'+method+'_HTTP='+str(res.status))
  if res.status>=400:print('STORAGE_'+method+'_ERROR_CLASS='+classify(body))
print('PUBLIC_STORAGE_PROBE=READ_ONLY_NO_CONTENT_OR_PATHS_LOGGED')
