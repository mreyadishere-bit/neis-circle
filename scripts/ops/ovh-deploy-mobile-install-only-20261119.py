#!/usr/bin/env python3
"""OVH: mobile/tablet-only install card, green NC Google icon without white fringe."""
from pathlib import Path
import hashlib,json,os,re,shutil,subprocess,sys
ROOT=Path('/home/ubuntu/neis-supabase')
STAGE=Path('/home/ubuntu/neis-backups/mobile-install-google-icon-20261119')
RELEASES=Path('/home/ubuntu/neis-frontend/releases')
OVERLAY=ROOT/'docker-compose.frontend-public.yml'
DOCKER=['sudo','-n','/usr/bin/docker']
COMPOSE=DOCKER+['compose']+[v for f in (
 'docker-compose.yml','docker-compose.security.yml','docker-compose.caddy.yml',
 'docker-compose.frontend-public.yml','docker-compose.auth-public-direct.yml') for v in ('-f',f)]
MARKER='20261119-mobile-install-only'
PWA_JS='scripts/pwa-install-v117.js'
PWA_CSS='styles/pwa-v117.css'
ICON_NAMES=['favicon.ico','favicon-rounded-48.png','favicon-rounded-64.png',
 'favicon-rounded-192.png','favicon-rounded.png']
TAB='<link rel="icon" type="image/png" href="/assets/email-logo.png?v=original-tab-20261119">'
def require(ok,msg):
 if not ok:raise RuntimeError(msg)
def run(cmd,timeout=90):
 p=subprocess.run(cmd,cwd=ROOT,capture_output=True,text=True,timeout=timeout)
 if p.returncode:raise RuntimeError('COMMAND_FAILED_'+(p.stderr or '')[-220:])
 return p.stdout
def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def main():
 require(STAGE.is_dir() and OVERLAY.is_file() and RELEASES.is_dir(),'PRECONDITIONS_MISSING')
 for n in ['pwa-install-v117.js','pwa-v117.css']+ICON_NAMES:
  require((STAGE/n).is_file(),'STAGED_FILE_MISSING_'+n)
 js=(STAGE/'pwa-install-v117.js').read_text()
 css=(STAGE/'pwa-v117.css').read_text()
 require('isMobileOrTabletBrowser()' in js and
         "classList.toggle('hidden',hideInstallCard)" in js and
         'neis-desktop-browser' in css,'PWA_DEVICE_GUARD_MISSING')
 run(['node','--check',str(STAGE/'pwa-install-v117.js')],timeout=20)
 run(COMPOSE+['config','--quiet'],timeout=40)
 info=json.loads(run(DOCKER+['inspect','supabase-caddy'],timeout=30))[0]
 mounts=[m['Source'] for m in info.get('Mounts',[]) if m.get('Type')=='bind' and m.get('Destination')=='/srv/neis-circle']
 require(len(mounts)==1,'FRONTEND_MOUNT_MISSING')
 old=Path(mounts[0]); before=OVERLAY.read_text()
 require(old.is_dir() and old.parent==RELEASES and before.count(str(old))==1,'UNEXPECTED_RELEASE')
 html=(old/'index.html').read_text();about=(old/'about.html').read_text()
 require(TAB in html and TAB in about,'ORIGINAL_BROWSER_TAB_ICON_MISSING')
 require(html.count(PWA_JS)==1 and html.count(PWA_CSS)==2,'PWA_REFS_UNEXPECTED')
 require('scripts/user-activity-v1.js' in html and 'last-active-ui-v2' in html and
         (old/'favicon.ico').exists(),'LIVE_FEATURES_MISSING')
 count=sum(f.is_file() for f in old.rglob('*'))
 require(count>100,'CURRENT_RELEASE_INCOMPLETE')
 revision=os.getenv('GITHUB_SHA','')[:12]
 require(bool(re.fullmatch('[a-f0-9]{12}',revision)),'REVISION_INVALID')
 target=RELEASES/('mobile-install-google-icon-'+revision);tmp=Path(str(target)+'.building')
 require(not target.exists() and not tmp.exists(),'RELEASE_ALREADY_EXISTS')
 shutil.copytree(old,tmp)
 shutil.copy2(STAGE/'pwa-install-v117.js',tmp/PWA_JS)
 shutil.copy2(STAGE/'pwa-v117.css',tmp/PWA_CSS)
 for name in ICON_NAMES:
  dest=(tmp/name) if name=='favicon.ico' else (tmp/'assets'/name)
  shutil.copy2(STAGE/name,dest)
 patched,n=re.subn(r'(scripts/pwa-install-v117\.js)(?:\?[^"\s]*)?',lambda m:m.group(1)+'?v='+MARKER,html,count=1)
 require(n==1,'PWA_SCRIPT_QUERY_FAILED')
 patched,n=re.subn(r'(styles/pwa-v117\.css)(?:\?[^"\s]*)?',lambda m:m.group(1)+'?v='+MARKER,patched)
 require(n==2,'PWA_STYLES_QUERY_FAILED')
 (tmp/'index.html').write_text(patched)
 require(TAB in patched and TAB in (tmp/'about.html').read_text(),'BROWSER_TAB_CHANGED')
 require(sum(f.is_file() for f in tmp.rglob('*'))==count,'ASSET_SET_CHANGED')
 for n in ICON_NAMES:
  path=(tmp/n) if n=='favicon.ico' else (tmp/'assets'/n)
  require(digest(path)==digest(STAGE/n),'ICON_MISMATCH_'+n)
 for p in ('scripts/03-auth-i18n.js','scripts/user-activity-v1.js','scripts/main-admin-auth-studio-v5.js','assets/email-logo.png'):
  require(digest(tmp/p)==digest(old/p),'UNRELATED_ASSET_CHANGED_'+p)
 tmp.rename(target)
 changed=False
 try:
  OVERLAY.write_text(before.replace(str(old),str(target),1));changed=True
  run(COMPOSE+['config','--quiet'],timeout=45)
  run(COMPOSE+['up','-d','--no-deps','caddy'],timeout=170)
  cid=run(COMPOSE+['ps','-q','caddy'],timeout=25).strip()
  require(bool(cid),'CADDY_UNAVAILABLE')
  live=run(DOCKER+['exec',cid,'cat','/srv/neis-circle/index.html'],timeout=30)
  live_js=run(DOCKER+['exec',cid,'cat','/srv/neis-circle/'+PWA_JS],timeout=30)
  live_css=run(DOCKER+['exec',cid,'cat','/srv/neis-circle/'+PWA_CSS],timeout=30)
  require('scripts/pwa-install-v117.js?v='+MARKER in live and
          'styles/pwa-v117.css?v='+MARKER in live and
          TAB in live,'LIVE_HTML_MISMATCH')
  require(hashlib.sha256(live_js.encode()).hexdigest()==digest(STAGE/'pwa-install-v117.js') and
          hashlib.sha256(live_css.encode()).hexdigest()==digest(STAGE/'pwa-v117.css'),'LIVE_PWA_MISMATCH')
  for name in ICON_NAMES:
   p='/srv/neis-circle/'+(name if name=='favicon.ico' else 'assets/'+name)
   h=run(DOCKER+['exec',cid,'sha256sum',p],timeout=30).split()[0]
   require(h==digest(STAGE/name),'LIVE_ICON_MISMATCH_'+name)
  caddy=run(DOCKER+['exec',cid,'cat','/etc/caddy/Caddyfile'],timeout=30)
  require(all(v in caddy for v in ('reverse_proxy rest:3000','reverse_proxy auth:9999','basic_auth')),'PROXY_RULES_CHANGED')
 except Exception:
  if changed:
   OVERLAY.write_text(before)
   try:run(COMPOSE+['up','-d','--no-deps','caddy'],timeout=170)
   except Exception:print('PWA_RELEASE_ROLLBACK=UNVERIFIED')
   else:print('PWA_RELEASE_ROLLBACK=COMPLETE')
  raise
 print('PWA_DESKTOP_BANNER_REMOVAL=DEPLOYED_VERIFIED')
 print('MOBILE_TABLET_INSTALL_BANNER=RETAINED')
 print('GOOGLE_CIRCULAR_ICON_WHITES=REMOVED')
 print('BROWSER_TAB_ORIGINAL_ICON=RETAINED')
 print('AUTH_AND_STUDENT_DATA=UNCHANGED')
if __name__=='__main__':
 try:main()
 except Exception as e:
  print('PWA_DESKTOP_BANNER_REMOVAL=FAILED_'+str(e)[:195],file=sys.stderr)
  sys.exit(1)
