#!/usr/bin/env python3
"""Publish branding and public-copy changes only; preserve active OVH frontend."""
from pathlib import Path
import hashlib,json,os,re,shutil,subprocess,sys
ROOT=Path('/home/ubuntu/neis-supabase')
STAGE=Path('/home/ubuntu/neis-backups/seo-brand-refresh-20261119')
RELEASES=Path('/home/ubuntu/neis-frontend/releases')
OVERLAY=ROOT/'docker-compose.frontend-public.yml'
DOCKER=['sudo','-n','/usr/bin/docker']
COMPOSE=DOCKER+['compose']+[v for f in (
 'docker-compose.yml','docker-compose.security.yml','docker-compose.caddy.yml',
 'docker-compose.frontend-public.yml','docker-compose.auth-public-direct.yml'
) for v in ('-f',f)]
FAVICON='/assets/neis-circle-favicon.svg?v=20261119'
def need(ok,err):
 if not ok:raise RuntimeError(err)
def run(args,timeout=110):
 p=subprocess.run(args,cwd=ROOT,text=True,capture_output=True,timeout=timeout)
 if p.returncode:raise RuntimeError('COMMAND_FAILED_'+(p.stderr or '')[-190:])
 return p.stdout
def digest(text):return hashlib.sha256(text.encode()).hexdigest()
def main():
 need(STAGE.is_dir() and OVERLAY.is_file(),'STAGE_MISSING')
 staged={n:(STAGE/n).read_text() for n in ('about.html','neis-circle-favicon.svg')}
 need('Google sign-in' not in staged['about.html'] and
      'continue with Google' not in staged['about.html'] and
      'باستخدام Google' not in staged['about.html'],'PUBLIC_GOOGLE_COPY_REMAINS')
 need('<svg' in staged['neis-circle-favicon.svg'] and
      'viewBox="0 0 96 96"' in staged['neis-circle-favicon.svg'] and
      'NC</text>' in staged['neis-circle-favicon.svg'],'ICON_INVALID')
 run(COMPOSE+['config','--quiet'],timeout=50)
 info=json.loads(run(DOCKER+['inspect','supabase-caddy'],timeout=25))[0]
 mounts=[m['Source'] for m in info.get('Mounts',[]) if m.get('Type')=='bind' and m.get('Destination')=='/srv/neis-circle']
 need(len(mounts)==1,'CADDY_FRONTEND_MOUNT_MISSING')
 old=Path(mounts[0])
 need(old.parent==RELEASES and old.is_dir(),'UNEXPECTED_RELEASE')
 overlay=OVERLAY.read_text()
 need(overlay.count(str(old))==1,'OVERLAY_CHANGED')
 html=(old/'index.html').read_text()
 need('seo-v1' in html and 'scripts/user-activity-v1.js' in html and
      'last-active-ui-v2' in html and '<link rel="icon" type="image/png" href="/assets/email-logo.png">' in html,
      'UNEXPECTED_LIVE_HTML')
 need('scripts/03-auth-i18n.js' in html and (old/'about.html').is_file(),'AUTH_OR_PUBLIC_PAGE_MISSING')
 need(FAVICON not in html,'BRANDING_ALREADY_DEPLOYED')
 count=sum(p.is_file() for p in old.rglob('*'))
 need(count>100,'RELEASE_INCOMPLETE')
 rev=os.environ.get('GITHUB_SHA','')[:12]
 need(bool(re.fullmatch('[a-f0-9]{12}',rev)),'INVALID_COMMIT')
 target=RELEASES/('seo-brand-refresh-'+rev)
 tmp=Path(str(target)+'.building')
 need(not target.exists() and not tmp.exists(),'RELEASE_ALREADY_EXISTS')
 shutil.copytree(old,tmp)
 shutil.copy2(STAGE/'about.html',tmp/'about.html')
 shutil.copy2(STAGE/'neis-circle-favicon.svg',tmp/'assets/neis-circle-favicon.svg')
 new_html=html.replace(
  '<link rel="icon" type="image/png" href="/assets/email-logo.png">',
  '<link rel="icon" type="image/svg+xml" href="'+FAVICON+'">',1)
 need(new_html!=html,'FAVICON_PATCH_FAILED')
 (tmp/'index.html').write_text(new_html)
 need(sum(p.is_file() for p in tmp.rglob('*'))==count+1,'COPY_COUNT_WRONG')
 need(digest((tmp/'scripts/03-auth-i18n.js').read_text())==
      digest((old/'scripts/03-auth-i18n.js').read_text()),'LOGIN_CODE_CHANGED')
 need(digest((tmp/'scripts/user-activity-v1.js').read_text())==
      digest((old/'scripts/user-activity-v1.js').read_text()),'LAST_ACTIVE_CHANGED')
 tmp.rename(target)
 changed=False
 try:
  OVERLAY.write_text(overlay.replace(str(old),str(target),1));changed=True
  run(COMPOSE+['config','--quiet'],timeout=55)
  run(COMPOSE+['up','-d','--no-deps','caddy'],timeout=160)
  cid=run(COMPOSE+['ps','-q','caddy'],timeout=25).strip()
  need(bool(cid),'CADDY_DOWN')
  live=run(DOCKER+['exec',cid,'cat','/srv/neis-circle/index.html'],timeout=25)
  live_about=run(DOCKER+['exec',cid,'cat','/srv/neis-circle/about.html'],timeout=25)
  live_icon=run(DOCKER+['exec',cid,'cat','/srv/neis-circle/assets/neis-circle-favicon.svg'],timeout=25)
  need(digest(live)==digest(new_html) and
       digest(live_about)==digest(staged['about.html']) and
       digest(live_icon)==digest(staged['neis-circle-favicon.svg']),'LIVE_ASSET_MISMATCH')
  caddy=run(DOCKER+['exec',cid,'cat','/etc/caddy/Caddyfile'],timeout=25)
  need(all(x in caddy for x in ('reverse_proxy rest:3000','reverse_proxy auth:9999','basic_auth')),'AUTH_ROUTES_CHANGED')
 except Exception:
  if changed:
   OVERLAY.write_text(overlay)
   try:run(COMPOSE+['up','-d','--no-deps','caddy'],timeout=150)
   except Exception:print('SEO_BRANDING_ROLLBACK=UNVERIFIED')
   else:print('SEO_BRANDING_ROLLBACK=COMPLETE')
  raise
 print('SEO_BRAND_REFRESH=DEPLOYED_VERIFIED')
 print('AUTH_AND_STUDENT_DATA=UNCHANGED')
 print('PREVIOUS_RELEASE_PRESERVED=YES')
if __name__=='__main__':
 try:main()
 except Exception as e:
  print('SEO_BRAND_REFRESH=FAILED_'+str(e)[:160],file=sys.stderr)
  sys.exit(1)
