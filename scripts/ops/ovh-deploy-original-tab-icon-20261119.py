#!/usr/bin/env python3
"""Restore original NC browser-tab icon, preserve circular /favicon.ico for crawlers."""
from pathlib import Path
import hashlib,json,os,re,shutil,subprocess,sys
ROOT=Path('/home/ubuntu/neis-supabase')
RELEASES=Path('/home/ubuntu/neis-frontend/releases')
OVERLAY=ROOT/'docker-compose.frontend-public.yml'
DOCKER=['sudo','-n','/usr/bin/docker']
COMPOSE=DOCKER+['compose']+[x for f in (
'docker-compose.yml','docker-compose.security.yml','docker-compose.caddy.yml',
'docker-compose.frontend-public.yml','docker-compose.auth-public-direct.yml'
) for x in ('-f',f)]
ROUND48='<link rel="icon" type="image/png" sizes="48x48" href="/assets/favicon-rounded-48.png?v=20261119-original-rounded">'
ROUND192='<link rel="icon" type="image/png" sizes="192x192" href="/assets/favicon-rounded-192.png?v=20261119-original-rounded">'
ORIGINAL='<link rel="icon" type="image/png" href="/assets/email-logo.png?v=original-tab-20261119">'
def require(value,description):
 if not value:raise RuntimeError(description)
def run(cmd,timeout=100):
 out=subprocess.run(cmd,cwd=ROOT,capture_output=True,text=True,timeout=timeout)
 if out.returncode:raise RuntimeError('COMMAND_FAILED_'+(out.stderr or '')[-220:])
 return out.stdout
def checksum(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
 require(OVERLAY.is_file() and RELEASES.is_dir(),'RELEASE_INFRASTRUCTURE_MISSING')
 run(COMPOSE+['config','--quiet'],timeout=60)
 c=json.loads(run(DOCKER+['inspect','supabase-caddy'],timeout=30))[0]
 mounts=[m['Source'] for m in c.get('Mounts',[]) if m.get('Destination')=='/srv/neis-circle' and m.get('Type')=='bind']
 require(len(mounts)==1,'CADDY_MOUNT_MISSING')
 old=Path(mounts[0]); overlay=OVERLAY.read_text()
 require(old.is_dir() and old.parent==RELEASES and overlay.count(str(old))==1,'UNEXPECTED_FRONTEND_RELEASE')
 index=(old/'index.html').read_text(); about=(old/'about.html').read_text()
 for name,page in (('HOME',index),('ABOUT',about)):
  require(page.count(ROUND48)==1 and page.count(ROUND192)==1,'ROUNDED_TAB_TAGS_CHANGED_'+name)
 require((old/'assets/email-logo.png').is_file() and (old/'favicon.ico').is_file(),'FAVICON_ASSETS_MISSING')
 for file in ('scripts/03-auth-i18n.js','scripts/user-activity-v1.js','scripts/main-admin-auth-studio-v5.js'):
  require((old/file).is_file(),'EXISTING_FEATURE_MISSING_'+file)
 count=sum(x.is_file() for x in old.rglob('*'))
 sha=os.environ.get('GITHUB_SHA','')[:12]
 require(bool(re.fullmatch('[a-f0-9]{12}',sha)),'INVALID_REVISION')
 dest=RELEASES/('restore-original-browser-icon-'+sha)
 tmp=Path(str(dest)+'.building')
 require(not dest.exists() and not tmp.exists(),'RELEASE_ALREADY_EXISTS')
 shutil.copytree(old,tmp)
 for p,source in (('index.html',index),('about.html',about)):
  updated=source.replace(ROUND48,ORIGINAL,1)
  updated=updated.replace(ROUND192,'',1)
  (tmp/p).write_text(updated)
  require(updated.count(ORIGINAL)==1 and 'favicon-rounded-48.png' not in updated and 'favicon-rounded-192.png' not in updated,'TAB_ICON_PATCH_FAILED')
 require(sum(x.is_file() for x in tmp.rglob('*'))==count,'RELEASE_FILE_COUNT_CHANGED')
 for f in ('favicon.ico','assets/email-logo.png','scripts/03-auth-i18n.js','scripts/user-activity-v1.js','scripts/main-admin-auth-studio-v5.js'):
  require(checksum(tmp/f)==checksum(old/f),'UNEXPECTED_FILE_CHANGE_'+f)
 tmp.rename(dest)
 changed=False
 try:
  OVERLAY.write_text(overlay.replace(str(old),str(dest),1));changed=True
  run(COMPOSE+['config','--quiet'],timeout=60)
  run(COMPOSE+['up','-d','--no-deps','caddy'],timeout=160)
  cid=run(COMPOSE+['ps','-q','caddy'],timeout=30).strip()
  require(bool(cid),'CADDY_UNAVAILABLE')
  home=run(DOCKER+['exec',cid,'cat','/srv/neis-circle/index.html'],timeout=30)
  ab=run(DOCKER+['exec',cid,'cat','/srv/neis-circle/about.html'],timeout=30)
  require(ORIGINAL in home and ORIGINAL in ab and ROUND48 not in home and ROUND48 not in ab,'LIVE_HTML_WRONG')
  proxy=run(DOCKER+['exec',cid,'cat','/etc/caddy/Caddyfile'],timeout=30)
  require(all(k in proxy for k in ('reverse_proxy rest:3000','reverse_proxy auth:9999','basic_auth')),'PROXY_CONFIG_CHANGED')
 except Exception:
  if changed:
   OVERLAY.write_text(overlay)
   try:run(COMPOSE+['up','-d','--no-deps','caddy'],timeout=160)
   except Exception:print('BROWSER_ICON_ROLLBACK=UNVERIFIED')
   else:print('BROWSER_ICON_ROLLBACK=COMPLETE')
  raise
 print('ORIGINAL_BROWSER_ICON=DEPLOYED_VERIFIED')
 print('ROUND_FAVICON_ICO=UNCHANGED')
 print('AUTH_AND_ACTIVITY=UNCHANGED')
 print('OLD_RELEASE=RETAINED')
if __name__=='__main__':
 try:main()
 except Exception as e:
  print('ORIGINAL_BROWSER_ICON=FAILED_'+str(e)[:200],file=sys.stderr)
  sys.exit(1)
