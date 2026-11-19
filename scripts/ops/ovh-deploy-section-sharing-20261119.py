#!/usr/bin/env python3
"""Deploy public OG section landing pages, unchanged app, reversible Caddy release."""
from pathlib import Path
import hashlib,json,os,re,shutil,subprocess,sys,urllib.request
ROOT=Path('/home/ubuntu/neis-supabase')
STAGE=Path('/home/ubuntu/neis-backups/section-sharing-20261119')
RELEASES=Path('/home/ubuntu/neis-frontend/releases')
OVERLAY=ROOT/'docker-compose.frontend-public.yml'
DOCKER=['sudo','-n','/usr/bin/docker']
COMPOSE=DOCKER+['compose']+[x for f in (
 'docker-compose.yml','docker-compose.security.yml','docker-compose.caddy.yml',
 'docker-compose.frontend-public.yml','docker-compose.auth-public-direct.yml'
) for x in ('-f',f)]
SECTIONS=['articles','study','circles','opportunities','gallery','timetable']
MARKER='20261119-sharing'
BRIDGE='scripts/section-share-router-v1.js'
BANNER='<script src="scripts/section-share-router-v1.js?v='+MARKER+'" defer></script>'
def require(ok,why):
 if not ok:raise RuntimeError(why)
def run(cmd,timeout=90):
 proc=subprocess.run(cmd,cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=timeout)
 if proc.returncode:raise RuntimeError('COMMAND_FAILED_'+(proc.stderr or '')[-260:])
 return proc.stdout
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def verify_pages():
 for slug in SECTIONS:
  path=STAGE/'share-pages'/slug/'index.html'
  require(path.is_file(),'MISSING_SHARE_PAGE_'+slug)
  html=path.read_text()
  require('<link rel="canonical" href="https://neiscircle.site/'+slug+'/"' in html,
          'CANONICAL_MISMATCH_'+slug)
  require('property="og:image"' in html and
          'property="og:title"' in html and
          'href="/#/'+slug+'"' in html,'SOCIAL_OR_CTA_MISSING_'+slug)
 require((STAGE/'sitemap.xml').is_file(),'SITEMAP_MISSING')
 xml=(STAGE/'sitemap.xml').read_text()
 for slug in SECTIONS:
  require('https://neiscircle.site/'+slug+'/' in xml,'SITEMAP_MISSING_'+slug)
 require((STAGE/'section-share-router-v1.js').is_file(),'SHARE_ROUTER_MISSING')
 router=(STAGE/'section-share-router-v1.js').read_text()
 require('section-share-route-pending' not in router and
         "pendingKey='neis-share-route-pending'" in router and
         "body.classList.contains('app-ready')" in router and
         "nav(section)" in router,'SHARE_ROUTER_MISMATCH')
 run(['node','--check',str(STAGE/'section-share-router-v1.js')],timeout=18)
def check_public_urls():
 # These requests check the actual Caddy HTTP routing, not merely files on disk.
 for slug in SECTIONS:
  url='https://neiscircle.site/'+slug+'/'
  request=urllib.request.Request(url,headers={'User-Agent':'NEIS-Share-Release/1','Cache-Control':'no-cache'})
  with urllib.request.urlopen(request,timeout=17) as response:
   require(response.status==200,'SHARE_HTTP_NOT_200_'+slug)
   data=response.read().decode('utf-8','replace')
  require('property="og:title"' in data and
          'https://neiscircle.site/'+slug+'/' in data and
          'href="/#/'+slug+'"' in data,
          'SHARE_HTTP_NOT_CORRECT_'+slug)
def main():
 verify_pages()
 require(OVERLAY.is_file() and RELEASES.is_dir(),'OVH_FRONTEND_INFRA_MISSING')
 run(COMPOSE+['config','--quiet'],timeout=55)
 info=json.loads(run(DOCKER+['inspect','supabase-caddy'],timeout=30))[0]
 mounts=[m['Source'] for m in info.get('Mounts',[]) if m.get('Destination')=='/srv/neis-circle' and m.get('Type')=='bind']
 require(len(mounts)==1,'CADDY_FRONTEND_MOUNT_UNKNOWN')
 old=Path(mounts[0]);overlay=OVERLAY.read_text()
 require(old.is_dir() and old.parent==RELEASES and overlay.count(str(old))==1,'UNEXPECTED_LIVE_FRONTEND')
 html=(old/'index.html').read_text()
 require('scripts/user-activity-v1.js' in html and
         '20261119-compact-theme-icon' in html and
         '20261119-mobile-install-only' in html and
         'original-tab-20261119' in html and
         'independent, student-built online community' in html,
         'PREVIOUS_FRONTEND_FEATURES_MISSING')
 require(BANNER not in html,'SHARE_ROUTER_ALREADY_DEPLOYED')
 for slug in SECTIONS:
  require(not (old/slug).exists(),'EXISTING_SECTION_FILE_CONFLICT_'+slug)
 count=sum(x.is_file() for x in old.rglob('*'))
 require(count>100,'LIVE_FRONTEND_INCOMPLETE')
 rev=os.getenv('GITHUB_SHA','')[:12]
 require(bool(re.fullmatch('[0-9a-f]{12}',rev)),'BAD_REVISION')
 target=RELEASES/('section-sharing-'+rev)
 temp=Path(str(target)+'.building')
 require(not target.exists() and not temp.exists(),'RELEASE_ALREADY_EXISTS')
 shutil.copytree(old,temp)
 for slug in SECTIONS:
  shutil.copytree(STAGE/'share-pages'/slug,temp/slug)
 shutil.copy2(STAGE/'sitemap.xml',temp/'sitemap.xml')
 shutil.copy2(STAGE/'section-share-router-v1.js',temp/BRIDGE)
 require(html.count('</body>')==1,'APP_HTML_UNEXPECTED')
 new_html=html.replace('</body>','  '+BANNER+'\n</body>',1)
 (temp/'index.html').write_text(new_html)
 require(sum(x.is_file() for x in temp.rglob('*'))==count+len(SECTIONS)+1,'INVALID_RELEASE_FILE_COUNT')
 for a in ('scripts/03-auth-i18n.js','scripts/user-activity-v1.js',
           'scripts/pwa-install-v117.js','styles/ui-v14.css','favicon.ico',
           'assets/email-logo.png','scripts/main-admin-auth-studio-v5.js'):
  require(digest(temp/a)==digest(old/a),'EXISTING_FEATURE_MODIFIED_'+a)
 require('neis-share-route-pending' in (temp/BRIDGE).read_text(),
         'SECTION_SHARE_OAUTH_ROUTING_MISSING')
 temp.rename(target)
 changed=False
 try:
  backup=STAGE/'previous-release-path.txt'
  backup.write_text(str(old))
  backup.chmod(0o600)
  OVERLAY.write_text(overlay.replace(str(old),str(target),1));changed=True
  run(COMPOSE+['config','--quiet'],timeout=55)
  run(COMPOSE+['up','-d','--no-deps','caddy'],timeout=165)
  cid=run(COMPOSE+['ps','-q','caddy'],timeout=25).strip()
  require(bool(cid),'CADDY_NOT_RUNNING')
  live=run(DOCKER+['exec',cid,'cat','/srv/neis-circle/index.html'],timeout=25)
  require(BANNER in live and 'scripts/user-activity-v1.js' in live,'LIVE_APP_SCRIPT_MISSING')
  for slug in SECTIONS:
   page=run(DOCKER+['exec',cid,'cat','/srv/neis-circle/'+slug+'/index.html'],timeout=25)
   require('https://neiscircle.site/'+slug+'/' in page and 'og:image' in page,
           'LIVE_SHARE_FILE_INVALID_'+slug)
  rules=run(DOCKER+['exec',cid,'cat','/etc/caddy/Caddyfile'],timeout=25)
  require(all(x in rules for x in ('reverse_proxy rest:3000','reverse_proxy auth:9999','basic_auth')),'AUTH_ROUTES_CHANGED')
  # Public HTTPS is checked by GitHub's external runner after this release.
  # The VPS cannot connect to its own public address in this network topology.
 except Exception:
  if changed:
   OVERLAY.write_text(overlay)
   try:run(COMPOSE+['up','-d','--no-deps','caddy'],timeout=155)
   except Exception:print('SECTION_SHARING_ROLLBACK=UNVERIFIED')
   else:print('SECTION_SHARING_ROLLBACK=COMPLETE')
  raise
 print('SECTION_SHARE_RELEASE=DEPLOYED_VERIFIED')
 print('PUBLIC_SECTION_COUNT='+str(len(SECTIONS)))
 print('STUDENT_AUTH_AND_DATA=UNCHANGED')
 print('SHARE_IMAGES=EXISTING_BRAND_POSTER_UNTIL_OWNER_UPLOADS')
 print('OLD_FRONTEND_RELEASE=RETAINED')
if __name__=='__main__':
 try:main()
 except Exception as e:
  print('SECTION_SHARE_RELEASE=FAILED_'+str(e)[:260],file=sys.stderr)
  sys.exit(1)
