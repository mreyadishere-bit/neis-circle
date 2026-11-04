#!/usr/bin/env python3
"""Safely deploy only Magnus Edge function. Preserve unrelated functions/OVH services."""
import copy,json,pathlib,shutil,subprocess,sys,uuid,urllib.request,urllib.error
ROOT=pathlib.Path('/home/ubuntu/neis-supabase')
STAGE=pathlib.Path('/home/ubuntu/neis-backups/magnus-speed-20261103')
# The active edge mount is currently controlled by the voice release overlay.
# Put that overlay LAST so parity compares with the running container.
OVERLAY=ROOT/'docker-compose.chat-voice-transcribe.yml'
DOCKER=['sudo','-n','/usr/bin/docker']
BASE=['docker-compose.yml','docker-compose.security.yml','docker-compose.caddy.yml',
      'docker-compose.frontend-public.yml','docker-compose.auth-public-direct.yml']
EXTRA=['docker-compose.edge-integrations.yml','docker-compose.timetable-ai.yml',
       'docker-compose.timetable-ai-gemini.yml','docker-compose.timetable-ai-cloudflare.yml',
       'docker-compose.timetable-fast-chat.yml','docker-compose.magnus-neis.yml']
REV=uuid.uuid4().hex[:12]
def require(value,code):
 if not value:raise RuntimeError(code)
def run(args,timeout=100,check=True):
 p=subprocess.run(args,cwd=ROOT,capture_output=True,text=True,timeout=timeout)
 if check and p.returncode:raise RuntimeError('COMMAND_FAILED_'+str(p.returncode))
 return p.stdout
def cmd():
 files=BASE+[x for x in EXTRA if (ROOT/x).is_file()]
 if OVERLAY.is_file():files.append(OVERLAY.name)
 return DOCKER+['compose']+[a for f in files for a in ('-f',f)]
def config():return json.loads(run(cmd()+['config','--format','json']))
def current():
 obj=json.loads(run(DOCKER+['inspect','supabase-edge-functions']))[0]
 require(obj['State']['Running'],'EDGE_NOT_RUNNING')
 mounts=[pathlib.Path(m['Source']) for m in obj['Mounts']
         if m.get('Destination')=='/home/deno/functions' and m.get('Type')=='bind']
 require(len(mounts)==1,'EDGE_MOUNT_UNEXPECTED')
 return mounts[0]
def mount(cfg):
 items=[m for m in cfg['services']['functions']['volumes']
        if m.get('target')=='/home/deno/functions']
 require(len(items)==1,'EDGE_MOUNT_CONFIG_INVALID')
 return items[0]
def assert_parity(before,after):
 require(set(before['services'])==set(after['services']),'SERVICE_LIST_CHANGED')
 for name,original in before['services'].items():
  later=after['services'][name]
  if name!='functions':
   require(original==later,'UNRELATED_SERVICE_CHANGED_'+name)
   continue
  x=copy.deepcopy(original);y=copy.deepcopy(later)
  x['volumes']=[m for m in x['volumes'] if m.get('target')!='/home/deno/functions']
  y['volumes']=[m for m in y['volumes'] if m.get('target')!='/home/deno/functions']
  require(x==y,'FUNCTION_SETTINGS_CHANGED')
def verify_route():
 url='https://supabase.neiscircle.site/functions/v1/magnus-chat'
 req=urllib.request.Request(url,method='OPTIONS',headers={
  'Origin':'https://neiscircle.site','Access-Control-Request-Method':'POST'})
 with urllib.request.urlopen(req,timeout=15) as resp:
  require(resp.status in (200,204),'MAGNUS_PREFLIGHT_UNAVAILABLE')
 req=urllib.request.Request(url,data=b'{}',method='POST',
  headers={'Authorization':'Bearer invalid','Content-Type':'application/json'})
 try:
  with urllib.request.urlopen(req,timeout=15):
   raise RuntimeError('UNAUTHENTICATED_REQUEST_ACCEPTED')
 except urllib.error.HTTPError as exc:
  require(exc.code in (401,403),'MAGNUS_AUTH_GATE_FAILED')
def main():
 require((STAGE/'index.ts').is_file(),'SOURCE_NOT_STAGED')
 source=(STAGE/'index.ts').read_text()
 require('gemini-3.1-flash-lite' in source and 'thinkingLevel' in source,
         'OPTIMIZATION_MISSING')
 run(cmd()+['config','--quiet'])
 before=config()
 active=current()
 require(active==pathlib.Path(mount(before)['source']),'ACTIVE_CONFIG_MISMATCH')
 require((active/'magnus-chat/index.ts').is_file(),'MAGNUS_FUNCTION_NOT_ACTIVE')
 new=pathlib.Path('/home/ubuntu/neis-backups/magnus-speed-release-'+REV)
 tmp=pathlib.Path(str(new)+'.building')
 require(not new.exists() and not tmp.exists(),'RELEASE_EXISTS')
 shutil.copytree(active,tmp)
 shutil.copy2(STAGE/'index.ts',tmp/'magnus-chat/index.ts')
 tmp.rename(new)
 new_mount=copy.deepcopy(mount(before))
 require(new_mount.get('type')=='bind' and new_mount.get('read_only') is True,
         'UNSAFE_MOUNT')
 new_mount['source']=str(new)
 old_overlay=OVERLAY.read_text() if OVERLAY.is_file() else None
 new_content='services:\n  functions:\n    volumes:\n      - '+json.dumps(new_mount,separators=(',',':'))+'\n'
 changed=False
 try:
  OVERLAY.write_text(new_content)
  changed=True
  assert_parity(before,config())
  run(cmd()+['up','-d','--no-deps','--force-recreate','functions'],timeout=140)
  require(current()==new,'ACTIVE_FUNCTION_MOUNT_MISMATCH')
  verify_route()
 except Exception:
  if changed:
   if old_overlay is None:OVERLAY.unlink(missing_ok=True)
   else:OVERLAY.write_text(old_overlay)
   run(cmd()+['up','-d','--no-deps','--force-recreate','functions'],
       timeout=120,check=False)
  raise
 print('MAGNUS_SPEED_BACKEND_DEPLOY=SUCCESS')
 print('MAGNUS_SPEED_UNRELATED_SERVICES=UNCHANGED')
 print('MAGNUS_SPEED_UNAUTHENTICATED_BLOCKED=PASS')
 print('MAGNUS_SPEED_RELEASE='+REV)
if __name__=='__main__':
 try:main()
 except Exception as err:
  print('MAGNUS_SPEED_BACKEND_DEPLOY=FAILED_'+str(err)[:70],file=sys.stderr)
  raise SystemExit(1)
