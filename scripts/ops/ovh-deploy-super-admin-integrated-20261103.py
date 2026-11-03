#!/usr/bin/env python3
"""Deploy only the redesigned admin UI to OVH, preserving all app data and other services."""
import json, os, pathlib, re, shutil, subprocess, sys
BASE=pathlib.Path('/home/ubuntu/neis-supabase')
STAGE=pathlib.Path('/home/ubuntu/neis-backups/super-admin-access-ui-20261103')
RELEASES=pathlib.Path('/home/ubuntu/neis-frontend/releases')
OVERLAY=BASE/'docker-compose.frontend-public.yml'
VERSION='20261103-integrated'
ASSETS={
 'scripts/main-admin-roles-v1.js':'roles.js',
 'scripts/super-admin-management-v1.js':'super-admin.js',
 'scripts/main-admin-auth-studio-v5.js':'auth-studio.js',
}
COMPOSE=['sudo','-n','/usr/bin/docker','compose']
for file in ('docker-compose.yml','docker-compose.security.yml','docker-compose.caddy.yml',
             'docker-compose.frontend-public.yml','docker-compose.auth-public-direct.yml'):
 COMPOSE.extend(['-f',file])
def cmd(command,timeout=90,check=True):
 r=subprocess.run(command,cwd=BASE,capture_output=True,text=True,timeout=timeout)
 if check and r.returncode: raise RuntimeError('COMMAND_FAILED')
 return r
def require(ok,message):
 if not ok:raise RuntimeError(message)
def main():
 require(STAGE.is_dir() and RELEASES.is_dir() and OVERLAY.is_file(),'STAGING_NOT_READY')
 for relative,staged in ASSETS.items():
  f=STAGE/staged
  require(f.is_file() and f.stat().st_size>100,'ASSET_NOT_STAGED')
  cmd(['node','--check',str(f)])
 cmd(COMPOSE+['config','--quiet'])
 inspect=json.loads(cmd(['sudo','-n','/usr/bin/docker','inspect','supabase-caddy']).stdout)[0]
 mount=[x['Source'] for x in inspect['Mounts']
        if x.get('Type')=='bind' and x.get('Destination')=='/srv/neis-circle']
 require(len(mount)==1,'ACTIVE_FRONTEND_MOUNT_NOT_FOUND')
 source=pathlib.Path(mount[0])
 require(source.is_dir() and source.parent==RELEASES,'UNEXPECTED_FRONTEND_RELEASE')
 original=OVERLAY.read_text()
 require(original.count(str(source))==1,'OVH_FRONTEND_MOUNT_MISMATCH')
 html=(source/'index.html').read_text()
 require('main-admin-roles-v1.js' in html and 'main-admin-auth-studio-v5.js' in html,
         'EXISTING_ADMIN_UI_NOT_FOUND')
 release=RELEASES/('super-admin-access-'+os.environ.get('DEPLOY_REV','integrated-ui-v2'))
 temp=pathlib.Path(str(release)+'.building')
 require(not release.exists() and not temp.exists(),'RELEASE_ID_ALREADY_USED')
 shutil.copytree(source,temp)
 for relative,staged in ASSETS.items():
  target=temp/relative
  target.parent.mkdir(parents=True,exist_ok=True)
  shutil.copy2(STAGE/staged,target)
 for name in ('main-admin-roles-v1.js','super-admin-management-v1.js','main-admin-auth-studio-v5.js'):
  expr=r'(scripts/'+re.escape(name)+r')(?:\?[^"\s]*)?'
  html,count=re.subn(expr,lambda m:m.group(1)+'?v='+VERSION,html,count=1)
  require(count==1,'MISSING_SCRIPT_REFERENCE_'+name)
 (temp/'index.html').write_text(html)
 temp.rename(release)
 updated=original.replace(str(source),str(release),1)
 backup=STAGE/('frontend-overlay.before-'+os.environ.get('DEPLOY_REV','integrated-ui-v2')+'.yml')
 backup.write_text(original)
 changed=False
 try:
  OVERLAY.write_text(updated);changed=True
  cmd(COMPOSE+['config','--quiet'])
  cmd(COMPOSE+['up','-d','--no-deps','caddy'],timeout=120)
  cid=cmd(COMPOSE+['ps','-q','caddy']).stdout.strip()
  require(bool(cid),'CADDY_NOT_RUNNING')
  live=cmd(['sudo','-n','/usr/bin/docker','exec',cid,'cat','/srv/neis-circle/index.html']).stdout
  require(all(name+'?v='+VERSION in live for name in
    ('main-admin-roles-v1.js','super-admin-management-v1.js','main-admin-auth-studio-v5.js')),
    'ASSETS_NOT_ACTIVE')
 except Exception:
  if changed:
   OVERLAY.write_text(original)
   cmd(COMPOSE+['up','-d','--no-deps','caddy'],check=False,timeout=120)
  raise
 print('ACCESS_CONTROL_ADMIN_UI=DEPLOYED')
 print('DUPLICATE_SUPER_ADMIN_PANEL=REMOVED')
 print('PERMANENT_DELETE_IN_AUTH_USERS_TABLE=YES')
if __name__=='__main__':
 try:main()
 except Exception as exc:
  print('ACCESS_CONTROL_ADMIN_UI=FAILED_'+str(exc)[:65],file=sys.stderr)
  raise SystemExit(1)
