#!/usr/bin/env python3
"""Atomic OVH frontend release for Last active; existing student records stay untouched."""
from pathlib import Path
import hashlib,json,os,re,shutil,subprocess,sys
ROOT=Path('/home/ubuntu/neis-supabase')
STAGE=Path('/home/ubuntu/neis-backups/last-active-20261118')
RELEASES=Path('/home/ubuntu/neis-frontend/releases')
OVERLAY=ROOT/'docker-compose.frontend-public.yml'
DOCKER=['sudo','-n','/usr/bin/docker']
COMPOSE=DOCKER+['compose']+[part for f in (
 'docker-compose.yml','docker-compose.security.yml','docker-compose.caddy.yml',
 'docker-compose.frontend-public.yml','docker-compose.auth-public-direct.yml'
) for part in ('-f',f)]
MARKER='20261118-last-active'
ASSETS=['scripts/main-admin-auth-studio-v5.js','scripts/user-activity-v1.js']
phase='preflight'
def require(ok,msg):
 if not ok:raise RuntimeError(msg)
def run(cmd,stdin=None,timeout=85):
 p=subprocess.run(cmd,cwd=ROOT,input=stdin,capture_output=True,text=True,timeout=timeout)
 if p.returncode:raise RuntimeError('COMMAND_FAILED_'+str(p.returncode)+':'+(p.stderr or '')[-280:])
 return p.stdout
def digest(value):return hashlib.sha256(value.encode()).hexdigest()
def main():
 global phase
 require(STAGE.is_dir() and OVERLAY.is_file() and RELEASES.is_dir(),'STAGE_MISSING')
 for name in ['migration.sql','main-admin-auth-studio-v5.js','user-activity-v1.js']:
  require((STAGE/name).is_file(),'STAGED_ASSET_MISSING_'+name)
 admin=(STAGE/'main-admin-auth-studio-v5.js').read_text()
 activity=(STAGE/'user-activity-v1.js').read_text()
 migration=(STAGE/'migration.sql').read_text()
 require("['last_active_at','Last active']" in admin and
         "last_active_desc" in admin and "last_active_asc" in admin,'ADMIN_ASSET_INVALID')
 require("sb.rpc('neis_mark_active')" in activity and "5*60*1000" in activity,'ACTIVITY_ASSET_INVALID')
 require('create table if not exists public.neis_user_activity' in migration and
         'create or replace function public.main_admin_auth_users' in migration and
         'auth.uid()' in migration,'MIGRATION_INVALID')
 for f in ('main-admin-auth-studio-v5.js','user-activity-v1.js'):
  run(['node','--check',str(STAGE/f)],timeout=20)
 run(COMPOSE+['config','--quiet'],timeout=50)
 c=json.loads(run(DOCKER+['inspect','supabase-caddy'],timeout=25))[0]
 mounts=[m.get('Source') for m in c.get('Mounts',[]) if m.get('Type')=='bind' and m.get('Destination')=='/srv/neis-circle']
 require(len(mounts)==1,'FRONTEND_BIND_UNKNOWN')
 old=Path(mounts[0])
 require(old.parent==RELEASES and old.is_dir(),'UNEXPECTED_RELEASE')
 original=OVERLAY.read_text()
 require(original.count(str(old))==1,'OVERLAY_CHANGED')
 oldhtml=(old/'index.html').read_text()
 require(oldhtml.count('scripts/main-admin-auth-studio-v5.js')==1 and
         oldhtml.count('</body>')==1 and
         (old/ASSETS[0]).exists(),'UNEXPECTED_LIVE_FRONTEND')
 require('scripts/user-activity-v1.js' not in oldhtml,'ALREADY_DEPLOYED')
 count=sum(x.is_file() for x in old.rglob('*'))
 require(count>100,'INCOMPLETE_LIVE_RELEASE')
 revision=os.getenv('GITHUB_SHA','')[:12]
 require(bool(re.fullmatch('[a-f0-9]{12}',revision)),'INVALID_REVISION')
 target=RELEASES/('last-active-'+revision)
 temp=Path(str(target)+'.building')
 require(not target.exists() and not temp.exists(),'RELEASE_ALREADY_EXISTS')
 phase='prepare_release'
 shutil.copytree(old,temp)
 for a in ASSETS:shutil.copy2(STAGE/Path(a).name,temp/a)
 html,n=re.subn(r'scripts/main-admin-auth-studio-v5\\.js(?:\\?[^"\\s]*)?',
  'scripts/main-admin-auth-studio-v5.js?v='+MARKER,oldhtml,count=1)
 require(n==1,'ADMIN_SCRIPT_TAG_UNEXPECTED')
 new_script='<script src="scripts/user-activity-v1.js?v='+MARKER+'" defer></script>'
 require(new_script not in html and '</body>' in html,'ACTIVITY_SCRIPT_TAG_INVALID')
 html=html.replace('</body>','  '+new_script+'\\n</body>',1)
 (temp/'index.html').write_text(html)
 require(sum(x.is_file() for x in temp.rglob('*'))==count+1,'COPY_COUNT_INVALID')
 for a in ASSETS:
  require(digest((temp/a).read_text())==digest((STAGE/Path(a).name).read_text()),'ASSET_COPY_MISMATCH')
 temp.rename(target)
 phase='apply_database_migration'
 run(COMPOSE+['exec','-T','db','psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],
  stdin=migration,timeout=85)
 security=run(COMPOSE+['exec','-T','db','psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-Atqc'],
   stdin=None,timeout=10) if False else None
 checks=run(COMPOSE+['exec','-T','db','psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-At'],
  stdin="""select case when to_regclass('public.neis_user_activity') is not null and
     (select relrowsecurity from pg_class where oid='public.neis_user_activity'::regclass) and
     has_function_privilege('authenticated','public.neis_mark_active()','EXECUTE') and
     not has_function_privilege('anon','public.neis_mark_active()','EXECUTE')
     then 'SECURE' else 'INSECURE' end;
select case when pg_get_functiondef('public.main_admin_auth_users(text,text,text,integer,integer,text,text)'::regprocedure)
like '%last_active_desc%' then 'SORT_OK' else 'SORT_MISSING' end;
""",timeout=25)
 require('SECURE' in checks and 'SORT_OK' in checks,'POST_MIGRATION_SECURITY_FAILED')
 phase='activate_frontend'
 changed=False
 try:
  OVERLAY.write_text(original.replace(str(old),str(target),1));changed=True
  run(COMPOSE+['config','--quiet'],timeout=35)
  run(COMPOSE+['up','-d','--no-deps','caddy'],timeout=130)
  cid=run(COMPOSE+['ps','-q','caddy'],timeout=25).strip()
  require(bool(cid),'CADDY_DOWN')
  live=run(DOCKER+['exec',cid,'cat','/srv/neis-circle/index.html'],timeout=25)
  require('main-admin-auth-studio-v5.js?v='+MARKER in live and
          'user-activity-v1.js?v='+MARKER in live,'LIVE_SCRIPT_TAG_MISMATCH')
  for a in ASSETS:
   code=run(DOCKER+['exec',cid,'cat','/srv/neis-circle/'+a],timeout=25)
   require(digest(code)==digest((STAGE/Path(a).name).read_text()),'LIVE_ASSET_MISMATCH')
  caddy=run(DOCKER+['exec',cid,'cat','/etc/caddy/Caddyfile'],timeout=25)
  require(all(s in caddy for s in ('reverse_proxy rest:3000','reverse_proxy auth:9999','basic_auth')),
          'AUTH_ROUTE_CHANGED')
 except Exception:
  if changed:
   OVERLAY.write_text(original)
   try:run(COMPOSE+['up','-d','--no-deps','caddy'],timeout=130)
   except Exception:print('FRONTEND_ROLLBACK_UNVERIFIED')
   else:print('FRONTEND_ROLLBACK=SUCCESS')
  raise
 print('LAST_ACTIVE_OVH=DEPLOYED_AND_VERIFIED')
 print('DATABASE=ADDITIVE_ACTIVITY_ONLY')
 print('OLD_FRONTEND_RELEASE_PRESERVED=YES')
 print('LAST_ACTIVE_EXISTING_USERS=NOT_BACKFILLED')
if __name__=='__main__':
 try:main()
 except Exception as exc:
  print('LAST_ACTIVE_OVH=FAILED_'+phase+'_'+str(exc)[:180],file=sys.stderr)
  sys.exit(1)
