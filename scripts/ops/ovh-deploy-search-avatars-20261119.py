#!/usr/bin/env python3
"""Deploy ONLY enhanced search avatars to the immutable NEIS Circle OVH frontend.

Copies the currently active release and injects two isolated, versioned assets
after the existing profile illustration renderer. The auth flow, search RPC,
post data, user data, homepage, Caddy and all existing functionality are kept.
"""
from pathlib import Path
import hashlib,json,os,re,shutil,subprocess,sys
ROOT=Path('/home/ubuntu/neis-supabase')
RELEASES=Path('/home/ubuntu/neis-frontend/releases')
OVERLAY=ROOT/'docker-compose.frontend-public.yml'
STAGE=Path('/home/ubuntu/neis-backups/search-portraits-20261119')
DOCKER=['sudo','-n','/usr/bin/docker']
COMPOSE=DOCKER+['compose']+[item for name in (
 'docker-compose.yml','docker-compose.security.yml','docker-compose.caddy.yml',
 'docker-compose.frontend-public.yml','docker-compose.auth-public-direct.yml'
) for item in ('-f',name)]
ANCHOR='<script src="scripts/profile-illustrations-v1.js?v=1.9-self-avatar-fallback" defer></script>'
ADDITION='''<link rel="stylesheet" href="styles/search-result-avatars-v1.css?v=20261119-1">
  <script src="scripts/search-result-avatars-v1.js?v=20261119-1" defer></script>'''
def need(ok,label):
 if not ok:raise RuntimeError(label)
def run(args,timeout=100):
 p=subprocess.run(args,cwd=ROOT,capture_output=True,text=True,timeout=timeout)
 if p.returncode:raise RuntimeError('COMMAND_FAILED_'+(p.stderr or '')[-230:])
 return p.stdout
def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def main():
 rev=os.environ.get('GITHUB_SHA','')[:12]
 need(bool(re.fullmatch('[0-9a-f]{12}',rev)),'INVALID_DEPLOY_SHA')
 need(STAGE.is_dir() and OVERLAY.is_file() and RELEASES.is_dir(),'FRONTEND_DEPLOY_INFRA_UNAVAILABLE')
 js=STAGE/'search-result-avatars-v1.js'
 css=STAGE/'search-result-avatars-v1.css'
 need(js.is_file() and css.is_file(),'STAGED_FILES_MISSING')
 need('profileAvatar(person)' in js.read_text() and
      'sb.from(\'posts\')' in js.read_text() and
      'sb.from(\'profiles\')' in js.read_text(),'AVATAR_SOURCE_INCOMPLETE')
 need('search-result-avatar' in css.read_text(),'AVATAR_STYLES_INCOMPLETE')
 run(['node','--check',str(js)],timeout=20)
 run(COMPOSE+['config','--quiet'],timeout=55)
 inspected=json.loads(run(DOCKER+['inspect','supabase-caddy'],timeout=28))[0]
 source_list=[Path(m['Source']) for m in inspected.get('Mounts',[])
              if m.get('Destination')=='/srv/neis-circle' and m.get('Type')=='bind']
 need(len(source_list)==1,'LIVE_FRONTEND_BIND_UNKNOWN')
 source=source_list[0];overlay=OVERLAY.read_text()
 need(source.parent==RELEASES and source.is_dir() and overlay.count(str(source))==1,'LIVE_RELEASE_UNEXPECTED')
 html=(source/'index.html').read_text()
 need(html.count(ANCHOR)==1 and ADDITION not in html,
      'AVATAR_SCRIPT_ALREADY_ACTIVE_OR_PREVIOUS_ANCHOR_CHANGED')
 for marker in ('scripts/05-social.js','scripts/03-auth-i18n.js','scripts/user-activity-v1.js',
                'assets/share/home-main.webp','scripts/hash-route-open-v1.js'):
  need(marker in html,'LIVE_FEATURE_MISSING_'+marker)
 need(not (source/'scripts/search-result-avatars-v1.js').exists(),'PORTRAIT_SCRIPT_PATH_COLLISION')
 need(not (source/'styles/search-result-avatars-v1.css').exists(),'PORTRAIT_STYLE_PATH_COLLISION')
 before_count=sum(p.is_file() for p in source.rglob('*'))
 need(before_count>130,'LIVE_RELEASE_UNEXPECTEDLY_SMALL')
 target=RELEASES/('search-portraits-'+rev)
 building=Path(str(target)+'.building')
 need(not target.exists() and not building.exists(),'RELEASE_EXISTS')
 shutil.copytree(source,building)
 shutil.copy2(js,building/'scripts/search-result-avatars-v1.js')
 shutil.copy2(css,building/'styles/search-result-avatars-v1.css')
 patched=html.replace(ANCHOR,ANCHOR+'\n  '+ADDITION,1)
 (building/'index.html').write_text(patched)
 need(patched.replace(ANCHOR+'\n  '+ADDITION,ANCHOR,1)==html,
      'MORE_THAN_ONE_HTML_CHANGE')
 need(sum(p.is_file() for p in building.rglob('*'))==before_count+2,
      'UNEXPECTED_FILES_ADDED')
 for path in ('scripts/05-social.js','scripts/03-auth-i18n.js',
              'scripts/profile-illustrations-v1.js','scripts/user-activity-v1.js',
              'scripts/hash-route-open-v1.js','favicon.ico','assets/share/home-main.webp',
              'styles/app.css','styles/profile-illustrations-v1.css'):
  need(digest(source/path)==digest(building/path),'UNRELATED_APP_FILE_CHANGED_'+path)
 need(digest(js)==digest(building/'scripts/search-result-avatars-v1.js'),
      'PORTRAIT_SCRIPT_COPY_INVALID')
 building.rename(target)
 backup=STAGE/('previous-release-'+rev+'.txt')
 backup.write_text(str(source));backup.chmod(0o600)
 changed=False
 try:
  OVERLAY.write_text(overlay.replace(str(source),str(target),1))
  changed=True
  run(COMPOSE+['config','--quiet'],timeout=55)
  run(COMPOSE+['up','-d','--no-deps','caddy'],timeout=175)
  cid=run(COMPOSE+['ps','-q','caddy'],timeout=30).strip()
  need(cid,'CADDY_NOT_RUNNING')
  active=run(DOCKER+['exec',cid,'cat','/srv/neis-circle/index.html'],timeout=30)
  need(ADDITION in active and 'scripts/05-social.js' in active
       and 'scripts/hash-route-open-v1.js' in active,
       'LIVE_FRONTEND_ASSETS_NOT_ACTIVE')
  live_sha=run(DOCKER+['exec',cid,'sha256sum',
                      '/srv/neis-circle/scripts/search-result-avatars-v1.js'],timeout=25).split()[0]
  need(live_sha==digest(js),'LIVE_PORTRAIT_SCRIPT_HASH_MISMATCH')
 except Exception:
  if changed:
   OVERLAY.write_text(overlay)
   try:run(COMPOSE+['up','-d','--no-deps','caddy'],timeout=175)
   except Exception:print('SEARCH_PORTRAIT_ROLLBACK=UNVERIFIED')
   else:print('SEARCH_PORTRAIT_ROLLBACK=COMPLETE')
  raise
 print('SEARCH_PORTRAIT_RELEASE=DEPLOYED_TO_OVH')
 print('SEARCH_PROFILE_AVATARS=SUPPORTED')
 print('SEARCH_POST_AUTHOR_IMAGES=SUPPORTED')
 print('EXISTING_APP_AND_CADDY=UNCHANGED')
 print('AUTH_AND_PRIVATE_DATA=UNCHANGED')
if __name__=='__main__':
 try:main()
 except Exception as e:
  print('SEARCH_PORTRAIT_RELEASE=FAILED_'+str(e)[:220],file=sys.stderr)
  sys.exit(1)
