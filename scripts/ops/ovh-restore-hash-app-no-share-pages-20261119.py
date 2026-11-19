#!/usr/bin/env python3
"""Remove invented share landing pages from live NEIS Circle, preserving its SPA.

Scope: only the 15 generated share .html files and previous extensionless
share-page drafts, plus their sitemap entries and bridge script reference.
Preserves current root OG artwork, original layout/app, all student data.
"""
from pathlib import Path
import hashlib,os,re,json,shutil,subprocess,sys
ROOT=Path('/home/ubuntu/neis-supabase')
RELEASES=Path('/home/ubuntu/neis-frontend/releases')
OVERLAY=ROOT/'docker-compose.frontend-public.yml'
DOCKER=['sudo','-n','/usr/bin/docker']
COMPOSE=DOCKER+['compose']+[p for f in ('docker-compose.yml','docker-compose.security.yml','docker-compose.caddy.yml','docker-compose.frontend-public.yml','docker-compose.auth-public-direct.yml') for p in ('-f',f)]
SLUGS=('feed','discover','study','messages','connections','saved','opportunities','gallery','articles','circles','analytics','timetable','notifications','settings','games')
BRIDGE='<script src="scripts/section-share-router-v1.js?v=20261119-sharing" defer></script>'
def check(v,msg):
 if not v:raise RuntimeError(msg)
def run(cmd,timeout=90):
 p=subprocess.run(cmd,cwd=ROOT,text=True,capture_output=True,timeout=timeout)
 if p.returncode:raise RuntimeError('COMMAND_FAILED_'+(p.stderr or '')[-230:])
 return p.stdout
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def allowed_share_page(path):
 s=path.read_text()
 return ('<meta property="og:site_name" content="NEIS Circle">' in s
  and '<meta property="og:title"' in s
  and 'An independent community for students' in s
  and '<a class="button" href="/#/' in s)
def main():
 check(OVERLAY.is_file() and RELEASES.is_dir(),'FRONTEND_RELEASES_MISSING')
 run(COMPOSE+['config','--quiet'],timeout=50)
 instance=json.loads(run(DOCKER+['inspect','supabase-caddy'],timeout=27))[0]
 mounts=[Path(m['Source']) for m in instance.get('Mounts',[]) if m.get('Destination')=='/srv/neis-circle' and m.get('Type')=='bind']
 check(len(mounts)==1,'LIVE_FRONTEND_MOUNT_NOT_FOUND')
 source=mounts[0];old_overlay=OVERLAY.read_text()
 check(source.parent==RELEASES and source.is_dir() and old_overlay.count(str(source))==1,'LIVE_RELEASE_UNEXPECTED')
 index=(source/'index.html').read_text()
 check(index.count(BRIDGE)==1,'SHARE_ROUTER_UNEXPECTED')
 check(all(k in index for k in ('scripts/user-activity-v1.js','scripts/03-auth-i18n.js','original-tab-20261119')),'EXISTING_APP_MISSING')
 check('assets/share/home-main.webp' in index,'CURRENT_MAIN_SHARE_IMAGE_MISSING')
 existing=[]
 for slug in SLUGS:
  for name in (slug+'.html',slug):
   f=source/name
   if f.is_file():
    check(allowed_share_page(f),'SHARE_FILE_NOT_RECOGNIZED_'+name)
    existing.append(name)
   elif f.is_dir():
    check((f/'index.html').is_file() and allowed_share_page(f/'index.html'),'DIRECTORY_NOT_RECOGNIZED_'+name)
    existing.append(name)
 check(any(x.endswith('.html') for x in existing),'NO_SHARE_HTML_TO_REVERT')
 before_count=sum(p.is_file() for p in source.rglob('*'))
 rev=os.environ.get('GITHUB_SHA','')[:12]
 check(bool(re.fullmatch('[0-9a-f]{12}',rev)),'REVISION_INVALID')
 dest=RELEASES/('restore-original-hash-app-'+rev)
 building=Path(str(dest)+'.building')
 check(not dest.exists() and not building.exists(),'RELEASE_ALREADY_EXISTS')
 shutil.copytree(source,building)
 for name in existing:
  f=building/name
  if f.is_dir():shutil.rmtree(f)
  else:f.unlink()
 (building/'index.html').write_text(index.replace('  '+BRIDGE+'\n','').replace(BRIDGE,''))
 sitemap=building/'sitemap.xml'
 if sitemap.is_file():
  xml=sitemap.read_text()
  # Keep only root and the existing public About URL, no invented social landings.
  import xml.etree.ElementTree as ET
  tree=ET.parse(sitemap)
  root=tree.getroot()
  for elem in list(root):
   loc=next((child.text for child in elem if child.tag.endswith('loc')),None)
   if loc and loc.rstrip('/') not in ('https://neiscircle.site','https://neiscircle.site/about.html'):
    root.remove(elem)
  ET.indent(tree)
  tree.write(sitemap,encoding='utf-8',xml_declaration=True)
 for f in ('scripts/03-auth-i18n.js','scripts/user-activity-v1.js','scripts/pwa-install-v117.js','styles/ui-v14.css','assets/email-logo.png','favicon.ico','assets/share/home-main.webp'):
  check(sha(building/f)==sha(source/f),'UNRELATED_FILE_MODIFIED_'+f)
 check('section-share-router-v1.js?v=20261119-sharing' not in (building/'index.html').read_text(),'BRIDGE_NOT_REMOVED')
 check('assets/share/home-main.webp' in (building/'index.html').read_text(),'MAIN_PREVIEW_UNEXPECTEDLY_CHANGED')
 building.rename(dest)
 activated=False
 try:
  OVERLAY.write_text(old_overlay.replace(str(source),str(dest),1));activated=True
  run(COMPOSE+['config','--quiet'],timeout=55)
  run(COMPOSE+['up','-d','--no-deps','caddy'],timeout=165)
  cid=run(COMPOSE+['ps','-q','caddy'],timeout=25).strip()
  check(cid,'CADDY_DOWN')
  live=run(DOCKER+['exec',cid,'cat','/srv/neis-circle/index.html'],timeout=30)
  check('scripts/user-activity-v1.js' in live and BRIDGE not in live and 'assets/share/home-main.webp' in live,'LIVE_APP_NOT_RESTORED')
  for name in existing:
   output=subprocess.run(DOCKER+['exec',cid,'test','-e','/srv/neis-circle/'+name],capture_output=True,timeout=18)
   check(output.returncode!=0,'SHARE_PAGE_STILL_EXISTS_'+name)
 except Exception:
  if activated:
   OVERLAY.write_text(old_overlay)
   try:run(COMPOSE+['up','-d','--no-deps','caddy'],timeout=165)
   except Exception:print('ORIGINAL_HASH_APP_ROLLBACK=UNVERIFIED')
   else:print('ORIGINAL_HASH_APP_ROLLBACK=COMPLETE')
  raise
 print('ORIGINAL_HASH_APP=RESTORED')
 print('INVENTED_SHARE_PAGES_REMOVED='+str(len(existing)))
 print('CURRENT_MAIN_SOCIAL_IMAGE=RETAINED')
 print('ORIGINAL_LAYOUT_AND_STUDENT_DATA=UNCHANGED')
 print('PREVIOUS_RELEASE=RETAINED')
if __name__=='__main__':
 try:main()
 except Exception as e:
  print('ORIGINAL_HASH_APP=FAILED_'+str(e)[:220],file=sys.stderr);sys.exit(1)
