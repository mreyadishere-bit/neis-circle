#!/usr/bin/env python3
"""Release approved NEIS Circle share art to OVH without touching private app content.

Stage files on VPS in /home/ubuntu/neis-backups/branded-share-20261119.
Only main landing page social image, public share landing HTML, site map and
new share images are changed. Existing /home art and entire app remain intact.
"""
from pathlib import Path
import hashlib,json,os,re,shutil,subprocess,sys
ROOT=Path('/home/ubuntu/neis-supabase')
STAGE=Path('/home/ubuntu/neis-backups/branded-share-20261119')
RELEASES=Path('/home/ubuntu/neis-frontend/releases')
OVERLAY=ROOT/'docker-compose.frontend-public.yml'
DOCKER=['sudo','-n','/usr/bin/docker']
COMPOSE=DOCKER+['compose']+[part for file in (
'docker-compose.yml','docker-compose.security.yml','docker-compose.caddy.yml',
'docker-compose.frontend-public.yml','docker-compose.auth-public-direct.yml')
 for part in ('-f',file)]
SLUGS=('feed','discover','study','messages','connections','saved',
       'opportunities','gallery','articles','circles')
MAIN='https://neiscircle.site/assets/share/home-main.webp?v=20261119-art'
def need(condition,message):
 if not condition:raise RuntimeError(message)
def run(args,timeout=100):
 p=subprocess.run(args,cwd=ROOT,text=True,capture_output=True,timeout=timeout)
 if p.returncode:raise RuntimeError('COMMAND_FAILED_'+(p.stderr or '')[-220:])
 return p.stdout
def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def replace_meta(html,property,value):
 pattern=r'(<meta (?:property|name)="'+re.escape(property)+r'" content=")[^"]*(")'
 out,count=re.subn(pattern,lambda m:m.group(1)+value+m.group(2),html,count=1)
 need(count==1,'META_TAG_MISSING_'+property)
 return out
def main():
 need(STAGE.is_dir() and OVERLAY.is_file() and RELEASES.is_dir(),'STAGE_NOT_READY')
 for slug in SLUGS:
  need((STAGE/'assets'/ (slug+'.webp')).is_file(),'IMAGE_NOT_STAGED_'+slug)
  page=STAGE/'pages'/(slug+'.html')
  need(page.is_file() and
       'https://neiscircle.site/'+slug+'.html' in page.read_text() and
       'og:image' in page.read_text(),'PREVIEW_PAGE_MISSING_'+slug)
 need((STAGE/'assets/home-main.webp').is_file(),'MAIN_IMAGE_NOT_STAGED')
 need((STAGE/'pages/timetable.html').is_file(),'TIMETABLE_PAGE_NOT_GENERATED')
 need((STAGE/'pages/sitemap.xml').is_file(),'SITEMAP_NOT_GENERATED')
 run(COMPOSE+['config','--quiet'],timeout=65)
 instance=json.loads(run(DOCKER+['inspect','supabase-caddy'],timeout=30))[0]
 mounted=[Path(item['Source']) for item in instance.get('Mounts',[])
          if item.get('Destination')=='/srv/neis-circle' and item.get('Type')=='bind']
 need(len(mounted)==1,'CADDY_FRONTEND_BIND_MISSING')
 original=mounted[0]
 old_overlay=OVERLAY.read_text()
 need(original.parent==RELEASES and original.is_dir() and
      old_overlay.count(str(original))==1,'UNEXPECTED_OVH_RELEASE')
 html=(original/'index.html').read_text()
 need('section-share-router-v1.js' in html and
      'scripts/user-activity-v1.js' in html and
      '20261119-mobile-install-only' in html and
      'original-tab-20261119' in html,'MISSING_CURRENT_APP_FEATURES')
 need(html.count('<meta property="og:image"')==1,'ORIGINAL_OG_IMAGE_TAG_UNEXPECTED')
 before_home={}
 for candidate in (original/'home',original/'home.html'):
  if candidate.is_file():before_home[str(candidate.relative_to(original))]=digest(candidate)
 if (original/'home').is_dir():
  for candidate in (original/'home').rglob('*'):
   if candidate.is_file():before_home[str(candidate.relative_to(original))]=digest(candidate)
 old_count=sum(item.is_file() for item in original.rglob('*'))
 need(old_count>100,'LIVE_RELEASE_INCOMPLETE')
 rev=os.getenv('GITHUB_SHA','')[:12]
 need(bool(re.fullmatch('[a-f0-9]{12}',rev)),'INVALID_SHA')
 new=RELEASES/('branded-share-'+rev)
 tmp=Path(str(new)+'.building')
 need(not new.exists() and not tmp.exists(),'RELEASE_EXISTS')
 shutil.copytree(original,tmp)
 for slug in SLUGS:
  shutil.copy2(STAGE/'pages'/(slug+'.html'),tmp/(slug+'.html'))
 # Keep the previously deployed public timetable page but rebuild if supplied.
 shutil.copy2(STAGE/'pages/timetable.html',tmp/'timetable.html')
 shutil.copy2(STAGE/'pages/sitemap.xml',tmp/'sitemap.xml')
 folder=tmp/'assets/share'
 folder.mkdir(parents=True,exist_ok=True)
 for slug in SLUGS:
  shutil.copy2(STAGE/'assets'/(slug+'.webp'),folder/(slug+'.webp'))
 shutil.copy2(STAGE/'assets/home-main.webp',folder/'home-main.webp')
 revised=replace_meta(html,'og:image',MAIN)
 revised=replace_meta(revised,'og:image:secure_url',MAIN)
 revised=replace_meta(revised,'og:image:type','image/webp')
 revised=replace_meta(revised,'og:image:alt',
                      'NEIS Circle independent student community – students learning together')
 revised=replace_meta(revised,'twitter:image',MAIN)
 (tmp/'index.html').write_text(revised)
 need('original-tab-20261119' in revised and
      'section-share-router-v1.js' in revised and
      'scripts/user-activity-v1.js' in revised,'APP_HTML_CHANGED_UNEXPECTEDLY')
 for name,hashval in before_home.items():
  need(digest(tmp/name)==hashval,'ORIGINAL_HOME_IMAGE_CHANGED_'+name)
 for p in ('scripts/03-auth-i18n.js','scripts/pwa-install-v117.js',
           'scripts/user-activity-v1.js','scripts/section-share-router-v1.js',
           'scripts/main-admin-auth-studio-v5.js','favicon.ico',
           'assets/email-logo.png','styles/ui-v14.css'):
  need(digest(tmp/p)==digest(original/p),'UNRELATED_APP_FILE_CHANGED_'+p)
 for slug in SLUGS:
  need(digest(tmp/'assets/share'/(slug+'.webp'))==
       digest(STAGE/'assets'/(slug+'.webp')),'IMAGE_COPY_MISMATCH_'+slug)
 need(digest(tmp/'assets/share/home-main.webp')==
      digest(STAGE/'assets/home-main.webp'),'HOME_MAIN_IMAGE_MISMATCH')
 tmp.rename(new)
 backup=STAGE/'previous-release-path.txt'
 backup.write_text(str(original));backup.chmod(0o600)
 changed=False
 try:
  OVERLAY.write_text(old_overlay.replace(str(original),str(new),1));changed=True
  run(COMPOSE+['config','--quiet'],timeout=65)
  run(COMPOSE+['up','-d','--no-deps','caddy'],timeout=180)
  caddy_id=run(COMPOSE+['ps','-q','caddy'],timeout=30).strip()
  need(caddy_id,'CADDY_DOWN')
  active=run(DOCKER+['exec',caddy_id,'cat','/srv/neis-circle/index.html'],timeout=30)
  need(MAIN in active and 'section-share-router-v1.js' in active,
       'LIVE_MAIN_SOCIAL_PREVIEW_INVALID')
  for slug in SLUGS:
   server_path='/srv/neis-circle/assets/share/'+slug+'.webp'
   live_hash=run(DOCKER+['exec',caddy_id,'sha256sum',server_path],timeout=30).split()[0]
   need(live_hash==digest(STAGE/'assets'/(slug+'.webp')),'LIVE_IMAGE_MISMATCH_'+slug)
  conf=run(DOCKER+['exec',caddy_id,'cat','/etc/caddy/Caddyfile'],timeout=30)
  need('neiscircle.site' in conf and 'try_files {path} /index.html' in conf,
       'CADDY_CONFIG_CHANGED')
 except Exception:
  if changed:
   OVERLAY.write_text(old_overlay)
   try:run(COMPOSE+['up','-d','--no-deps','caddy'],timeout=160)
   except Exception:print('BRANDED_SHARE_ROLLBACK=UNVERIFIED')
   else:print('BRANDED_SHARE_ROLLBACK=COMPLETE')
  raise
 print('BRANDED_SHARE_ASSETS=DEPLOYED_VERIFIED_ON_OVH')
 print('MAIN_SITE_IMAGE=NATURAL_TONE_STUDENTS')
 print('APP_HOME_ORIGINAL_IMAGES=RETAINED')
 print('PUBLIC_SECTION_IMAGES=10')
 print('AUTH_AND_STUDENT_DATA=UNCHANGED')
if __name__=='__main__':
 try:main()
 except Exception as error:
  print('BRANDED_SHARE_ASSETS=FAILED_'+str(error)[:230],file=sys.stderr)
  sys.exit(1)
