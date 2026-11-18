#!/usr/bin/env python3
"""Atomic OVH: 14px theme glyph and centered Google favicon; preserve app and tab icon."""
from pathlib import Path
import hashlib,json,os,re,shutil,subprocess,sys
ROOT=Path('/home/ubuntu/neis-supabase')
STAGE=Path('/home/ubuntu/neis-backups/theme-and-search-icon-20261119')
RELEASES=Path('/home/ubuntu/neis-frontend/releases')
OVERLAY=ROOT/'docker-compose.frontend-public.yml'
DOCKER=['sudo','-n','/usr/bin/docker']
COMPOSE=DOCKER+['compose']+[v for f in ('docker-compose.yml','docker-compose.security.yml',
 'docker-compose.caddy.yml','docker-compose.frontend-public.yml',
 'docker-compose.auth-public-direct.yml') for v in ('-f',f)]
ICON_NAMES=['favicon.ico','favicon-rounded-48.png','favicon-rounded-64.png',
 'favicon-rounded-192.png','favicon-rounded.png']
CSS='styles/ui-v14.css'
THEME_MARKER='20261119-compact-theme-icon'
TAB='<link rel="icon" type="image/png" href="/assets/email-logo.png?v=original-tab-20261119">'
def check(ok,msg):
 if not ok:raise RuntimeError(msg)
def run(cmd,timeout=90):
 p=subprocess.run(cmd,cwd=ROOT,capture_output=True,text=True,timeout=timeout)
 if p.returncode:raise RuntimeError('COMMAND_FAILED_'+(p.stderr or '')[-210:])
 return p.stdout
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def main():
 check(STAGE.is_dir() and OVERLAY.is_file() and RELEASES.is_dir(),'STAGE_MISSING')
 check((STAGE/'ui-v14.css').exists(),'CSS_STAGE_MISSING')
 for n in ICON_NAMES:check((STAGE/n).is_file() and (STAGE/n).stat().st_size>250,'ICON_STAGE_MISSING_'+n)
 style=(STAGE/'ui-v14.css').read_text()
 check('20261119-compact-theme-icon' in style and
       '.round-btn.theme-control > span' in style and 'width:14px' in style,'STYLE_VALIDATION_FAILED')
 run(COMPOSE+['config','--quiet'],timeout=45)
 info=json.loads(run(DOCKER+['inspect','supabase-caddy'],timeout=30))[0]
 mounts=[m['Source'] for m in info.get('Mounts',[]) if m.get('Destination')=='/srv/neis-circle' and m.get('Type')=='bind']
 check(len(mounts)==1,'CADDY_FRONTEND_MISSING')
 old=Path(mounts[0]);old_overlay=OVERLAY.read_text()
 check(old.is_dir() and old.parent==RELEASES and old_overlay.count(str(old))==1,'UNEXPECTED_FRONTEND_RELEASE')
 html=(old/'index.html').read_text()
 about=(old/'about.html').read_text()
 check(html.count(TAB)==1 and about.count(TAB)==1,'ORIGINAL_TAB_ICON_MISSING')
 check(html.count('styles/ui-v14.css')==1 and html.count('scripts/pwa-install-v117.js')==1,'ASSET_LINKS_UNEXPECTED')
 check('20261119-mobile-install-only' in html and 'last-active-ui-v2' in html and
       'scripts/user-activity-v1.js' in html,'LIVE_FEATURES_UNEXPECTED')
 count=sum(x.is_file() for x in old.rglob('*'))
 check(count>100,'FRONTEND_RELEASE_INCOMPLETE')
 revision=os.getenv('GITHUB_SHA','')[:12]
 check(bool(re.fullmatch('[0-9a-f]{12}',revision)),'INVALID_REVISION')
 new=RELEASES/('compact-theme-centered-google-icon-'+revision)
 tmp=Path(str(new)+'.building')
 check(not new.exists() and not tmp.exists(),'RELEASE_ALREADY_EXISTS')
 shutil.copytree(old,tmp)
 shutil.copy2(STAGE/'ui-v14.css',tmp/CSS)
 for n in ICON_NAMES:
  path=(tmp/n) if n=='favicon.ico' else (tmp/'assets'/n)
  shutil.copy2(STAGE/n,path)
 updated,n=re.subn(r'(styles/ui-v14\.css)(?:\?[^"\s]*)?',
                   lambda m:m.group(1)+'?v='+THEME_MARKER,html,count=1)
 check(n==1,'CSS_CACHE_MARKER_FAILED')
 (tmp/'index.html').write_text(updated)
 check(TAB in updated and TAB in (tmp/'about.html').read_text(),'TAB_ICON_CHANGED')
 check(sum(x.is_file() for x in tmp.rglob('*'))==count,'FILE_COUNT_CHANGED')
 for p in ['assets/email-logo.png','scripts/03-auth-i18n.js','scripts/user-activity-v1.js',
           'scripts/main-admin-auth-studio-v5.js','scripts/pwa-install-v117.js','styles/pwa-v117.css']:
  check(sha(tmp/p)==sha(old/p),'UNRELATED_ASSET_MODIFIED_'+p)
 for n in ICON_NAMES:
  p=(tmp/n) if n=='favicon.ico' else (tmp/'assets'/n)
  check(sha(p)==sha(STAGE/n),'STAGED_ICON_MISMATCH_'+n)
 tmp.rename(new)
 changed=False
 try:
  OVERLAY.write_text(old_overlay.replace(str(old),str(new),1));changed=True
  run(COMPOSE+['config','--quiet'],timeout=55)
  run(COMPOSE+['up','-d','--no-deps','caddy'],timeout=160)
  cid=run(COMPOSE+['ps','-q','caddy'],timeout=25).strip()
  check(bool(cid),'CADDY_NOT_RUNNING')
  live=run(DOCKER+['exec',cid,'cat','/srv/neis-circle/index.html'],timeout=25)
  css=run(DOCKER+['exec',cid,'cat','/srv/neis-circle/'+CSS],timeout=25)
  check('styles/ui-v14.css?v='+THEME_MARKER in live and TAB in live,'LIVE_INDEX_MISMATCH')
  check(hashlib.sha256(css.encode()).hexdigest()==sha(STAGE/'ui-v14.css'),'LIVE_STYLE_MISMATCH')
  for n in ICON_NAMES:
   p='/srv/neis-circle/'+(n if n=='favicon.ico' else 'assets/'+n)
   live_sha=run(DOCKER+['exec',cid,'sha256sum',p],timeout=25).split()[0]
   check(live_sha==sha(STAGE/n),'LIVE_ICON_MISMATCH_'+n)
  caddy=run(DOCKER+['exec',cid,'cat','/etc/caddy/Caddyfile'],timeout=25)
  check(all(k in caddy for k in ('reverse_proxy rest:3000','reverse_proxy auth:9999','basic_auth')),'AUTH_PROXY_CHANGED')
 except Exception:
  if changed:
   OVERLAY.write_text(old_overlay)
   try:run(COMPOSE+['up','-d','--no-deps','caddy'],timeout=150)
   except Exception:print('THEME_ICON_ROLLBACK=UNVERIFIED')
   else:print('THEME_ICON_ROLLBACK=COMPLETE')
  raise
 print('THEME_GLYPH_14PX=DEPLOYED')
 print('CENTERED_CIRCULAR_GOOGLE_ICON=DEPLOYED')
 print('BROWSER_TAB_ORIGINAL=UNCHANGED')
 print('STUDENT_DATA_AND_OTHER_FEATURES=UNCHANGED')
 print('PREVIOUS_RELEASE=RETAINED')
if __name__=='__main__':
 try:main()
 except Exception as e:
  print('ICON_ALIGNMENT_DEPLOY=FAILED_'+str(e)[:170],file=sys.stderr)
  sys.exit(1)
