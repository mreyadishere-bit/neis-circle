#!/usr/bin/env python3
"""Narrow OVH icon-only release. Keep exact original green NC artwork."""
from pathlib import Path
import hashlib,json,os,re,shutil,subprocess,sys
ROOT=Path('/home/ubuntu/neis-supabase')
STAGE=Path('/home/ubuntu/neis-backups/original-rounded-favicon-20261119')
RELEASES=Path('/home/ubuntu/neis-frontend/releases')
OVERLAY=ROOT/'docker-compose.frontend-public.yml'
DOCKER=['sudo','-n','/usr/bin/docker']
COMPOSE=DOCKER+['compose']+[v for f in (
 'docker-compose.yml','docker-compose.security.yml','docker-compose.caddy.yml',
 'docker-compose.frontend-public.yml','docker-compose.auth-public-direct.yml'
) for v in ('-f',f)]
OLD_ICON='<link rel="icon" type="image/svg+xml" href="/assets/neis-circle-favicon.svg?v=20261119">'
NEW_ICON='<link rel="icon" type="image/png" sizes="48x48" href="/assets/favicon-rounded-48.png?v=20261119-original-rounded">'
NEW_ICON_192='<link rel="icon" type="image/png" sizes="192x192" href="/assets/favicon-rounded-192.png?v=20261119-original-rounded">'
def check(ok,err):
 if not ok:raise RuntimeError(err)
def sh(cmd,timeout=120):
 r=subprocess.run(cmd,cwd=ROOT,text=True,capture_output=True,timeout=timeout)
 if r.returncode:raise RuntimeError('COMMAND_FAILED_'+(r.stderr or '')[-200:])
 return r.stdout
def hash_bytes(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
 check(STAGE.is_dir() and OVERLAY.is_file(),'STAGE_MISSING')
 names=['favicon-rounded.png','favicon-rounded-192.png','favicon-rounded-64.png','favicon-rounded-48.png','favicon.ico']
 for n in names:check((STAGE/n).is_file() and (STAGE/n).stat().st_size>250,'INVALID_ICON_'+n)
 sh(COMPOSE+['config','--quiet'],timeout=60)
 info=json.loads(sh(DOCKER+['inspect','supabase-caddy'],timeout=30))[0]
 mounts=[m['Source'] for m in info.get('Mounts',[]) if m.get('Type')=='bind' and m.get('Destination')=='/srv/neis-circle']
 check(len(mounts)==1,'BIND_MISSING')
 old=Path(mounts[0])
 check(old.parent==RELEASES and old.is_dir(),'WRONG_RELEASE')
 overlay=OVERLAY.read_text()
 check(overlay.count(str(old))==1,'OVERLAY_CHANGED')
 index=(old/'index.html').read_text()
 about=(old/'about.html').read_text()
 check(index.count(OLD_ICON)==1 and about.count(OLD_ICON)==1,'ICON_VERSION_UNEXPECTED')
 check('seo-v1' in index and 'scripts/user-activity-v1.js' in index and
       'last-active-ui-v2' in index,'PRODUCTION_SITE_UNEXPECTED')
 for p in ('scripts/03-auth-i18n.js','scripts/user-activity-v1.js','scripts/main-admin-auth-studio-v5.js'):
  check((old/p).is_file(),'LIVE_FEATURE_MISSING_'+p)
 count=sum(x.is_file() for x in old.rglob('*'))
 check(count>100,'INCOMPLETE_RELEASE')
 sha=os.environ.get('GITHUB_SHA','')[:12]
 check(bool(re.fullmatch('[a-f0-9]{12}',sha)),'BAD_COMMIT_SHA')
 dest=RELEASES/('original-rounded-favicon-'+sha)
 tmp=Path(str(dest)+'.building')
 check(not dest.exists() and not tmp.exists(),'RELEASE_ALREADY_EXISTS')
 shutil.copytree(old,tmp)
 for n in names:
  target=(tmp/n) if n=='favicon.ico' else (tmp/'assets'/n)
  target.parent.mkdir(parents=True,exist_ok=True)
  shutil.copy2(STAGE/n,target)
 new_index=index.replace(OLD_ICON,NEW_ICON+'\n  '+NEW_ICON_192,1)
 new_about=about.replace(OLD_ICON,NEW_ICON+'\n'+NEW_ICON_192,1)
 (tmp/'index.html').write_text(new_index)
 (tmp/'about.html').write_text(new_about)
 check(sum(x.is_file() for x in tmp.rglob('*'))==count+len(names),'FILES_COUNT_CHANGED')
 for n in names:
  desticon=(tmp/n) if n=='favicon.ico' else (tmp/'assets'/n)
  check(hash_bytes(desticon)==hash_bytes(STAGE/n),'FILE_COPY_ERROR')
 for f in ('scripts/03-auth-i18n.js','scripts/user-activity-v1.js','scripts/main-admin-auth-studio-v5.js'):
  check(hash_bytes(tmp/f)==hash_bytes(old/f),'APPLICATION_CODE_CHANGED_'+f)
 tmp.rename(dest)
 changed=False
 try:
  OVERLAY.write_text(overlay.replace(str(old),str(dest),1));changed=True
  sh(COMPOSE+['config','--quiet'],timeout=60)
  sh(COMPOSE+['up','-d','--no-deps','caddy'],timeout=180)
  cid=sh(COMPOSE+['ps','-q','caddy'],timeout=30).strip()
  check(bool(cid),'CADDY_STOPPED')
  live_index=sh(DOCKER+['exec',cid,'cat','/srv/neis-circle/index.html'],timeout=30)
  live_about=sh(DOCKER+['exec',cid,'cat','/srv/neis-circle/about.html'],timeout=30)
  check(NEW_ICON in live_index and NEW_ICON in live_about and
        OLD_ICON not in live_index and OLD_ICON not in live_about,'LIVE_ICON_NOT_UPDATED')
  for n in names:
   path=('/srv/neis-circle/'+n) if n=='favicon.ico' else ('/srv/neis-circle/assets/'+n)
   output=sh(DOCKER+['exec',cid,'sha256sum',path],timeout=30)
   check(output.split()[0]==hash_bytes(STAGE/n),'LIVE_ICON_HASH_FAILED_'+n)
  caddy=sh(DOCKER+['exec',cid,'cat','/etc/caddy/Caddyfile'],timeout=30)
  check(all(x in caddy for x in ('reverse_proxy rest:3000','reverse_proxy auth:9999','basic_auth')),
       'AUTH_PROXY_CHANGED')
 except Exception:
  if changed:
   OVERLAY.write_text(overlay)
   try:sh(COMPOSE+['up','-d','--no-deps','caddy'],timeout=150)
   except Exception:print('ROUND_ICON_ROLLBACK=UNVERIFIED')
   else:print('ROUND_ICON_ROLLBACK=COMPLETE')
  raise
 print('ORIGINAL_ROUND_ICON=DEPLOYED_VERIFIED')
 print('IDENTICAL_LOGO_CONTENT=YES')
 print('APP_AUTH_AND_LAST_ACTIVE=UNCHANGED')
 print('PREVIOUS_RELEASE=RETAINED')
if __name__=='__main__':
 try:main()
 except Exception as e:
  print('ORIGINAL_ROUND_ICON=FAILED_'+str(e)[:190],file=sys.stderr)
  sys.exit(1)
