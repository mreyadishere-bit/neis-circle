#!/usr/bin/env python3
"""Publish a surgical search-portrait fix in the active immutable OVH frontend.

Only the two search JS files and three cache-buster strings in index.html may
change. Never touch database/auth, social data, the site's graphics or Caddy.
"""
from pathlib import Path
import hashlib,json,os,re,shutil,subprocess,sys
ROOT=Path('/home/ubuntu/neis-supabase')
RELEASES=Path('/home/ubuntu/neis-frontend/releases')
OVERLAY=ROOT/'docker-compose.frontend-public.yml'
STAGE=Path('/home/ubuntu/neis-backups/search-portrait-v2-20261119')
DOCKER=['sudo','-n','/usr/bin/docker']
COMPOSE=DOCKER+['compose']+[v for f in
 ('docker-compose.yml','docker-compose.security.yml','docker-compose.caddy.yml',
  'docker-compose.frontend-public.yml','docker-compose.auth-public-direct.yml')
 for v in ('-f',f)]
REPLACEMENTS=(
 ('scripts/search-result-avatars-v1.js?v=20261119-1',
  'scripts/search-result-avatars-v1.js?v=20261119-2'),
 ('styles/search-result-avatars-v1.css?v=20261119-1',
  'styles/search-result-avatars-v1.css?v=20261119-2'))
EXPECTED_ORIGINAL_GIT_BLOBS={
 'scripts/05-social.js':'f5e56d3f615136e175f05ac2ef0f25be960b0519',
 'scripts/search-result-avatars-v1.js':'ba20208bfe298d2d42c86db494d3d82fb38b6983',
}
def check(v,msg):
 if not v:raise RuntimeError(msg)
def run(cmd,timeout=100):
 p=subprocess.run(cmd,cwd=ROOT,text=True,capture_output=True,timeout=timeout)
 if p.returncode:raise RuntimeError('COMMAND_FAILED_'+(p.stderr or '')[-250:])
 return p.stdout
def git_blob(path):
 raw=path.read_bytes()
 return hashlib.sha1(b'blob '+str(len(raw)).encode()+bytes([0])+raw).hexdigest()
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def main():
 revision=os.environ.get('GITHUB_SHA','')[:12]
 check(bool(re.fullmatch('[0-9a-f]{12}',revision)),'INVALID_REVISION')
 check(STAGE.is_dir() and RELEASES.is_dir() and OVERLAY.is_file(),'OVH_PATH_MISSING')
 staged_social=STAGE/'05-social.js'
 staged_avatar=STAGE/'search-result-avatars-v1.js'
 check(staged_social.is_file() and staged_avatar.is_file(),'STAGED_SEARCH_JS_MISSING')
 target_js=staged_social.read_text()
 avatar_js=staged_avatar.read_text()
 check('window.NEISSearchAvatarUi?.hydrate(state.searchResults,requestId)' in target_js,
       'SEARCH_HYDRATION_NOT_CONNECTED')
 check(target_js.count('window.NEISSearchAvatarUi?.markup(x)')==2,
       'SEARCH_AVATAR_NOT_USED_ON_BOTH_RESULT_SURFACES')
 check('window.NEISSearchAvatarUi={markup:avatarMarkup,hydrate:scheduleHydration,refresh:refreshVisible}' in avatar_js,
       'SEARCH_BRIDGE_NOT_EXPOSED')
 check('select(\'id,author_id\')' in avatar_js
       and 'select(\'id,full_name,avatar_url\')' in avatar_js,'AUTHOR_LOOKUP_MISSING')
 run(COMPOSE+['config','--quiet'],timeout=55)
 inst=json.loads(run(DOCKER+['inspect','supabase-caddy'],timeout=30))[0]
 mounts=[Path(x['Source']) for x in inst.get('Mounts',[])
         if x.get('Type')=='bind' and x.get('Destination')=='/srv/neis-circle']
 check(len(mounts)==1,'FRONTEND_BIND_UNKNOWN')
 current=mounts[0];overlay=OVERLAY.read_text()
 check(current.is_dir() and current.parent==RELEASES
       and overlay.count(str(current))==1,'LIVE_FRONTEND_UNKNOWN')
 html=(current/'index.html').read_text()
 check(all(html.count(x[0])==1 for x in REPLACEMENTS),
       'LIVE_INDEX_CACHE_VERSIONS_UNEXPECTED')
 social_tag=re.search(r'scripts/05-social\\.js\\?[^"]+',html)
 check(social_tag is not None and html.count('scripts/05-social.js?')==1,
       'LIVE_SOCIAL_SCRIPT_LINK_UNEXPECTED')
 check('scripts/03-auth-i18n.js' in html
       and 'scripts/user-activity-v1.js' in html
       and 'assets/share/home-main.webp' in html,
       'LIVE_APP_CORE_MISSING')
 for name,expected in EXPECTED_ORIGINAL_GIT_BLOBS.items():
  check((current/name).is_file() and git_blob(current/name)==expected,
        'LIVE_SEARCH_CODE_DIFFERS_FROM_EXPECTED_'+name)
 check((current/'styles/search-result-avatars-v1.css').is_file(),
       'SEARCH_AVATAR_STYLE_MISSING')
 before_count=sum(p.is_file() for p in current.rglob('*'))
 check(before_count>125,'CURRENT_RELEASE_INCOMPLETE')
 target=RELEASES/('search-portrait-v2-'+revision)
 temp=Path(str(target)+'.building')
 check(not target.exists() and not temp.exists(),'RELEASE_ALREADY_EXISTS')
 shutil.copytree(current,temp)
 shutil.copy2(staged_social,temp/'scripts/05-social.js')
 shutil.copy2(staged_avatar,temp/'scripts/search-result-avatars-v1.js')
 updated=html
 for old,new in REPLACEMENTS:updated=updated.replace(old,new,1)
 updated=updated.replace(social_tag.group(0),
      'scripts/05-social.js?v=20261119-search-author-avatars-v2',1)
 (temp/'index.html').write_text(updated)
 for old,new in REPLACEMENTS:
  check(updated.count(new)==1,'CACHE_BUSTER_MISSING_'+new)
 check(updated.count('scripts/05-social.js?v=20261119-search-author-avatars-v2')==1,
       'SOCIAL_CACHE_BUSTER_MISSING')
 check(sum(p.is_file() for p in temp.rglob('*'))==before_count,'FILE_COUNT_CHANGED')
 for name in (
  'styles/app.css','styles/search-result-avatars-v1.css','scripts/03-auth-i18n.js',
  'scripts/user-activity-v1.js','scripts/hash-route-open-v1.js',
  'assets/share/home-main.webp','favicon.ico','assets/email-logo.png',
  'scripts/main-admin-auth-studio-v5.js'):
  check(sha(temp/name)==sha(current/name),'UNRELATED_ASSET_CHANGED_'+name)
 temp.rename(target)
 previous=STAGE/('previous-release-'+revision+'.txt')
 previous.write_text(str(current));previous.chmod(0o600)
 active=False
 try:
  OVERLAY.write_text(overlay.replace(str(current),str(target),1));active=True
  run(COMPOSE+['config','--quiet'],timeout=60)
  run(COMPOSE+['up','-d','--no-deps','caddy'],timeout=175)
  cid=run(COMPOSE+['ps','-q','caddy'],timeout=30).strip()
  check(cid,'CADDY_NOT_RUNNING')
  live=run(DOCKER+['exec',cid,'cat','/srv/neis-circle/index.html'],timeout=30)
  check(live==updated,'LIVE_INDEX_MISMATCH')
  for name,expected in (
   ('scripts/05-social.js',staged_social),
   ('scripts/search-result-avatars-v1.js',staged_avatar)):
   actual=run(DOCKER+['exec',cid,'sha256sum','/srv/neis-circle/'+name],
              timeout=25).split()[0]
   check(actual==sha(expected),'LIVE_JS_MISMATCH_'+name)
 except Exception:
  if active:
   OVERLAY.write_text(overlay)
   try:run(COMPOSE+['up','-d','--no-deps','caddy'],timeout=170)
   except Exception:print('SEARCH_AVATAR_ROLLBACK=UNVERIFIED')
   else:print('SEARCH_AVATAR_ROLLBACK=COMPLETE')
  raise
 print('SEARCH_AUTHOR_AVATARS=DEPLOYED_TO_OVH')
 print('SEARCH_RESULTS_AND_SUGGESTIONS=ENABLED')
 print('POST_ARTICLE_AUTHOR_PROFILE_QUERY=ENABLED')
 print('ORIGINAL_ROUTES_DB_AUTH_AND_VISUALS=UNCHANGED')
 print('ROLLBACK_RELEASE=AVAILABLE')
if __name__=='__main__':
 try:main()
 except Exception as e:
  print('SEARCH_AUTHOR_AVATARS=FAILED_'+str(e)[:240],file=sys.stderr)
  sys.exit(1)
