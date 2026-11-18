#!/usr/bin/env python3
"""Safe narrow OVH Auth Studio UX update: activity filters and presentation only."""
from pathlib import Path
import hashlib,json,os,re,shutil,subprocess,sys
ROOT=Path('/home/ubuntu/neis-supabase')
STAGE=Path('/home/ubuntu/neis-backups/last-active-ui-20261118')
RELEASES=Path('/home/ubuntu/neis-frontend/releases')
OVERLAY=ROOT/'docker-compose.frontend-public.yml'
DOCKER=['sudo','-n','/usr/bin/docker']
COMPOSE=DOCKER+['compose']+[p for f in (
 'docker-compose.yml','docker-compose.security.yml','docker-compose.caddy.yml',
 'docker-compose.frontend-public.yml','docker-compose.auth-public-direct.yml'
) for p in ('-f',f)]
MARKER='20261118-last-active-ui-v2'
ASSET='scripts/main-admin-auth-studio-v5.js'
phase='preflight'
def require(ok,reason):
 if not ok:raise RuntimeError(reason)
def run(cmd,stdin=None,timeout=100):
 p=subprocess.run(cmd,cwd=ROOT,input=stdin,capture_output=True,text=True,timeout=timeout)
 if p.returncode:raise RuntimeError('COMMAND_FAILED_'+str(p.returncode)+':'+(p.stderr or '')[-220:])
 return p.stdout
def sha(text):return hashlib.sha256(text.encode()).hexdigest()
def main():
 global phase
 require(STAGE.is_dir() and OVERLAY.exists(),'STAGE_MISSING')
 incoming=STAGE/'main-admin-auth-studio-v5.js'
 migration=STAGE/'migration.sql'
 require(incoming.is_file() and migration.is_file(),'STAGED_FILE_MISSING')
 source=incoming.read_text()
 sql=migration.read_text()
 require(all(x in source for x in (
  "['last_active_at','Last active']","active_30d","last_active_desc",
  'Last active tracking started 18 Nov 2026','Not recorded yet'
 )),'INVALID_ADMIN_SOURCE')
 require("f='active_30d'" in sql and "act.last_active_at" in sql and
         "public.neis_admin_is_super()" in sql,'INVALID_SQL_SOURCE')
 run(['node','--check',str(incoming)],timeout=15)
 run(COMPOSE+['config','--quiet'],timeout=55)
 obj=json.loads(run(DOCKER+['inspect','supabase-caddy'],timeout=25))[0]
 mounts=[m['Source'] for m in obj.get('Mounts',[]) if m.get('Type')=='bind' and m.get('Destination')=='/srv/neis-circle']
 require(len(mounts)==1,'CADDY_MOUNT_MISSING')
 old=Path(mounts[0])
 require(old.parent==RELEASES and old.is_dir(),'UNEXPECTED_LIVE_RELEASE')
 original=OVERLAY.read_text()
 require(original.count(str(old))==1,'MOUNT_SOURCE_CHANGED')
 html=(old/'index.html').read_text()
 require(html.count('scripts/main-admin-auth-studio-v5.js')==1 and
         html.count('scripts/user-activity-v1.js')==1 and
         (old/ASSET).is_file(),'LIVE_ASSETS_CHANGED')
 count=sum(f.is_file() for f in old.rglob('*'))
 require(count>100,'SOURCE_RELEASE_INCOMPLETE')
 revision=os.getenv('GITHUB_SHA','')[:12]
 require(bool(re.fullmatch('[a-f0-9]{12}',revision)),'INVALID_REVISION')
 target=RELEASES/('last-active-ui-v2-'+revision)
 temp=Path(str(target)+'.building')
 require(not target.exists() and not temp.exists(),'RELEASE_ALREADY_EXISTS')
 phase='prepare_release'
 shutil.copytree(old,temp)
 shutil.copy2(incoming,temp/ASSET)
 patched,n=re.subn(r'scripts/main-admin-auth-studio-v5\.js(?:\?[^"\s]*)?',
  'scripts/main-admin-auth-studio-v5.js?v='+MARKER,html,count=1)
 require(n==1 and 'scripts/user-activity-v1.js' in patched,'HTML_PATCH_INVALID')
 (temp/'index.html').write_text(patched)
 require(sum(f.is_file() for f in temp.rglob('*'))==count,'RELEASE_FILE_COUNT_CHANGED')
 require(sha((temp/ASSET).read_text())==sha(source),'RELEASE_CONTENT_MISMATCH')
 temp.rename(target)
 phase='install_admin_filter'
 run(COMPOSE+['exec','-T','db','psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],
  stdin=sql,timeout=85)
 check=run(COMPOSE+['exec','-T','db','psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-At'],
  stdin="""select case when pg_get_functiondef(
 'public.main_admin_auth_users(text,text,text,integer,integer,text,text)'::regprocedure)
 like '%active_30d%' then 'FILTER_OK' else 'FILTER_MISSING' end;
select count(*) from public.neis_user_activity;
""",timeout=30)
 require('FILTER_OK' in check,'FILTER_NOT_INSTALLED')
 phase='activate_frontend'
 changed=False
 try:
  OVERLAY.write_text(original.replace(str(old),str(target),1));changed=True
  run(COMPOSE+['config','--quiet'],timeout=55)
  run(COMPOSE+['up','-d','--no-deps','caddy'],timeout=160)
  cid=run(COMPOSE+['ps','-q','caddy'],timeout=30).strip()
  require(bool(cid),'CADDY_UNAVAILABLE')
  live=run(DOCKER+['exec',cid,'cat','/srv/neis-circle/index.html'],timeout=35)
  panel=run(DOCKER+['exec',cid,'cat','/srv/neis-circle/'+ASSET],timeout=35)
  require('main-admin-auth-studio-v5.js?v='+MARKER in live and
          'scripts/user-activity-v1.js' in live and sha(panel)==sha(source),'LIVE_ASSET_MISMATCH')
  conf=run(DOCKER+['exec',cid,'cat','/etc/caddy/Caddyfile'],timeout=35)
  require(all(x in conf for x in ('reverse_proxy rest:3000','reverse_proxy auth:9999','basic_auth')),
          'ROUTING_CHANGED')
 except Exception:
  if changed:
   OVERLAY.write_text(original)
   try:run(COMPOSE+['up','-d','--no-deps','caddy'],timeout=150)
   except Exception:print('FRONTEND_ROLLBACK=UNVERIFIED')
   else:print('FRONTEND_ROLLBACK=OK')
  raise
 print('LAST_ACTIVE_ADMIN_V2=DEPLOYED_VERIFIED')
 print('STUDENT_ACCOUNTS=UNCHANGED')
 print('ORIGINAL_FRONTEND=RETAINED')
if __name__=='__main__':
 try:main()
 except Exception as exc:
  print('LAST_ACTIVE_ADMIN_V2=FAILED_'+phase+'_'+str(exc)[:180],file=sys.stderr)
  sys.exit(1)
