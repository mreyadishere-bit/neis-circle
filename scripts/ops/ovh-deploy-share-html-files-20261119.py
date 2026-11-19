#!/usr/bin/env python3
"""OVH: serve /articles and /study as real static HTML files before SPA fallback.

The source release already contains share router and directory-based draft
pages. This release replaces only those six public draft paths with regular
files, so the original Caddy try_files {path} matches them first.
"""
from pathlib import Path
import json,os,re,shutil,subprocess,sys,hashlib
ROOT=Path('/home/ubuntu/neis-supabase')
STAGE=Path('/home/ubuntu/neis-backups/section-sharing-html-20261119')
RELEASES=Path('/home/ubuntu/neis-frontend/releases')
OVERLAY=ROOT/'docker-compose.frontend-public.yml'
DOCKER=['sudo','-n','/usr/bin/docker']
COMPOSE=DOCKER+['compose']+[t for f in (
'docker-compose.yml','docker-compose.security.yml','docker-compose.caddy.yml',
'docker-compose.frontend-public.yml','docker-compose.auth-public-direct.yml') for t in ('-f',f)]
SLUGS=('articles','study','circles','opportunities','gallery','timetable')
def require(v,msg):
 if not v:raise RuntimeError(msg)
def run(cmd,timeout=90):
 p=subprocess.run(cmd,text=True,capture_output=True,cwd=ROOT,timeout=timeout)
 if p.returncode:raise RuntimeError('COMMAND_FAILED_'+(p.stderr or '')[-240:])
 return p.stdout
def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def main():
 require(STAGE.is_dir() and OVERLAY.is_file() and RELEASES.is_dir(),'STAGING_OR_RELEASES_MISSING')
 for slug in SLUGS:
  p=STAGE/'share-files'/slug
  require(p.is_file() and
          '<link rel="canonical" href="https://neiscircle.site/'+slug+'"' in p.read_text() and
          'property="og:title"' in p.read_text(),'BAD_STATIC_SHARE_FILE_'+slug)
 sitemap=STAGE/'sitemap.xml'
 require(sitemap.is_file(),'SITEMAP_NOT_STAGED')
 run(COMPOSE+['config','--quiet'],timeout=55)
 inspect=json.loads(run(DOCKER+['inspect','supabase-caddy'],timeout=28))[0]
 mounts=[Path(m['Source']) for m in inspect.get('Mounts',[]) if m.get('Destination')=='/srv/neis-circle' and m.get('Type')=='bind']
 require(len(mounts)==1,'LIVE_FRONTEND_MOUNT_MISSING')
 current=mounts[0];overlay=OVERLAY.read_text()
 require(current.parent==RELEASES and current.is_dir() and overlay.count(str(current))==1,'UNEXPECTED_RELEASE')
 html=(current/'index.html').read_text()
 require('section-share-router-v1.js?v=20261119-sharing' in html and
         'original-tab-20261119' in html and
         'scripts/user-activity-v1.js' in html and
         '20261119-mobile-install-only' in html,'CURRENT_SITE_FEATURES_CHANGED')
 for slug in SLUGS:
  require((current/slug/'index.html').is_file(),'PREVIOUS_SHARE_PAGE_NOT_PRESENT_'+slug)
 configs=[Path(m['Source'])/'Caddyfile' for m in inspect.get('Mounts',[]) if m.get('Destination')=='/etc/caddy']
 require(len(configs)==1 and configs[0].is_file(),'CADDY_CONFIG_MISSING')
 caddy=configs[0].read_text()
 require('try_files {path} /index.html' in caddy and '@neisShareSection' not in caddy,
         'CADDY_NOT_IN_ORIGINAL_STATE')
 count=sum(x.is_file() for x in current.rglob('*'))
 require(count>100,'SOURCE_RELEASE_INCOMPLETE')
 rev=os.environ.get('GITHUB_SHA','')[:12]
 require(bool(re.fullmatch('[0-9a-f]{12}',rev)),'INVALID_SHA')
 dest=RELEASES/('section-sharing-html-'+rev)
 temp=Path(str(dest)+'.building')
 require(not dest.exists() and not temp.exists(),'RELEASE_ALREADY_EXISTS')
 shutil.copytree(current,temp)
 for slug in SLUGS:
  shutil.rmtree(temp/slug)
  shutil.copy2(STAGE/'share-files'/slug,temp/(slug+'.html'))
 shutil.copy2(sitemap,temp/'sitemap.xml')
 require(sum(p.is_file() for p in temp.rglob('*'))==count,'COPY_COUNT_INVALID')
 for p in ('index.html','scripts/03-auth-i18n.js','scripts/section-share-router-v1.js',
           'scripts/user-activity-v1.js','scripts/pwa-install-v117.js','styles/ui-v14.css',
           'assets/email-logo.png','favicon.ico'):
  require(digest(temp/p)==digest(current/p),'UNRELATED_ASSET_CHANGED_'+p)
 temp.rename(dest)
 rollback=STAGE/'previous-release-path.txt'
 rollback.write_text(str(current));rollback.chmod(0o600)
 changed=False
 try:
  OVERLAY.write_text(overlay.replace(str(current),str(dest),1));changed=True
  run(COMPOSE+['config','--quiet'],timeout=55)
  run(COMPOSE+['up','-d','--no-deps','caddy'],timeout=175)
  cid=run(COMPOSE+['ps','-q','caddy'],timeout=25).strip()
  require(bool(cid),'CADDY_NOT_RUNNING')
  for slug in SLUGS:
   h=run(DOCKER+['exec',cid,'sha256sum','/srv/neis-circle/'+slug+'.html'],timeout=25).split()[0]
   require(h==digest(STAGE/'share-files'/slug),'LIVE_SHARE_FILE_MISMATCH_'+slug)
  live=run(DOCKER+['exec',cid,'cat','/srv/neis-circle/index.html'],timeout=25)
  require('scripts/section-share-router-v1.js' in live and
          'scripts/user-activity-v1.js' in live,'APP_CHANGED')
 except Exception:
  if changed:
   OVERLAY.write_text(overlay)
   try:run(COMPOSE+['up','-d','--no-deps','caddy'],timeout=165)
   except Exception:print('STATIC_SHARE_ROLLBACK=UNVERIFIED')
   else:print('STATIC_SHARE_ROLLBACK=COMPLETE')
  raise
 print('HTML_SECTION_SHARE_FILES=DEPLOYED')
 print('CADDY_ORIGINAL_CONFIG=UNCHANGED')
 print('PRIVATE_STUDENT_DATA=UNCHANGED')
 print('PREVIOUS_RELEASE=RETAINED')
if __name__=='__main__':
 try:main()
 except Exception as exc:
  print('HTML_SECTION_SHARE_FILES=FAILED_'+str(exc)[:230],file=sys.stderr)
  sys.exit(1)
