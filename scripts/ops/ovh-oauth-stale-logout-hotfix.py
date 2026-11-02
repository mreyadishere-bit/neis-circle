#!/usr/bin/env python3
"""Patch stale OAuth banner on live OVH frontend only; immutable copy and rollback.
No Auth/Supabase config or code verifier change; no user sessions or data touched.
"""
from pathlib import Path
import subprocess,shutil,json,re,sys
ROOT=Path('/home/ubuntu/neis-supabase')
RELEASE=Path('/home/ubuntu/neis-frontend/releases/oauth-logout-stale-error-20261102-v1')
OVERLAY=ROOT/'docker-compose.frontend-public.yml'
STAGE=Path('/home/ubuntu/neis-backups/oauth-logout-stale-error-20261102-v1')
DOCKER=['sudo','-n','/usr/bin/docker']
FILES=['docker-compose.yml','docker-compose.security.yml','docker-compose.caddy.yml',
  'docker-compose.edge-integrations.yml','docker-compose.frontend-public.yml',
  'docker-compose.auth-public-direct.yml','docker-compose.timetable-ai.yml']
COMPOSE=DOCKER+['compose']+[q for f in FILES for q in ('-f',f)]
phase='preflight'
activated=False
prior=''
def cmd(args,timeout=90):
  r=subprocess.run(args,cwd=ROOT,capture_output=True,text=True,timeout=timeout)
  if r.returncode:raise RuntimeError('COMMAND_FAILED')
  return r.stdout
def require(test,reason):
  if not test:raise RuntimeError(reason)
def mount():
  info=json.loads(cmd(DOCKER+['inspect','supabase-caddy'],30))[0]
  require(info.get('State',{}).get('Running') is True,'CADDY_NOT_RUNNING')
  paths=[m.get('Source') for m in info.get('Mounts',[])
         if m.get('Type')=='bind' and m.get('Destination')=='/srv/neis-circle']
  require(len(paths)==1,'MOUNT_MISSING')
  return Path(paths[0])
def rollback():
  if not activated:return
  try:
    OVERLAY.write_text(prior)
    cmd(COMPOSE+['up','-d','--no-deps','caddy'],110)
    print('OAUTH_LOGOUT_HOTFIX_ROLLBACK=SUCCESS')
  except Exception:
    print('OAUTH_LOGOUT_HOTFIX_ROLLBACK=FAILED_NEEDS_REVIEW')
def main():
  global phase,activated,prior
  require(OVERLAY.is_file() and not OVERLAY.is_symlink(),'OVERLAY_MISSING')
  require(STAGE.is_dir() and not RELEASE.exists() and
          not Path(str(RELEASE)+'.building').exists(),'RELEASE_EXISTS_OR_STAGE_MISSING')
  require(all((ROOT/f).is_file() for f in FILES),'COMPOSE_FILE_MISSING')
  cmd(COMPOSE+['config','--quiet'],45)
  source=mount()
  require(str(source).startswith('/home/ubuntu/neis-frontend/releases/'),
          'CURRENT_RELEASE_UNRECOGNIZED')
  identity=source/'scripts/identity-v15.js'
  html=source/'index.html'
  require(identity.is_file() and html.is_file(),'FRONTEND_INCOMPLETE')
  original_js=identity.read_text()
  original_html=html.read_text()
  require('scripts/timetable-ai-v1.js' in original_html and
          'scripts/timetable-v147.js' in original_html and
          'timetable-export-png-v1.js' in original_html,
          'CURRENT_RELEASE_FEATURES_MISSING')
  prior=OVERLAY.read_text()
  require(prior.count(str(source))==1,'RELEASE_POINTER_MISMATCH')
  condition='if(!failed&&/^oauth_[a-z_]{1,48}(?:_[45][0-9]{2})?$/.test(safeReason)){'
  safer='if(!failed&&window.__NEISOAuthRecoveryFailed===true&&/^oauth_[a-z_]{1,48}(?:_[45][0-9]{2})?$/.test(safeReason)){'
  legacy="signOut=async function(){state.identityVerification={};await previousSignOut();authScreen()};"
  fixed=("signOut=async function(){"
    "window.__NEISOAuthRecoveryReason='';"
    "window.__NEISOAuthRecoveryFailed=false;"
    "state.identityVerification={};"
    "await previousSignOut();authScreen()};")
  require(original_js.count(condition)==1 and original_js.count(legacy)==1,
          'UNEXPECTED_AUTH_SOURCE_ABORT')
  code=original_js.replace(condition,safer).replace(legacy,fixed)
  require(code.count(safer)==1 and code.count(fixed)==1,'PATCH_FAILED')
  # Query-string bump prevents stale scripts in active PWA/browser HTTP cache.
  pattern=r'(src=["\x27])scripts/identity-v15[.]js(?:[?][^"\x27]*)?(["\x27])'
  hits=list(re.finditer(pattern,original_html))
  require(len(hits)==1,'AUTH_SCRIPT_TAG_UNEXPECTED')
  replacement=r'\1scripts/identity-v15.js?oauthlogout=20261102v1\2'
  new_html=re.sub(pattern,replacement,original_html,count=1)
  require(new_html.count('oauthlogout=20261102v1')==1,'HTML_PATCH_FAILED')
  phase='build'
  tmp=Path(str(RELEASE)+'.building')
  shutil.copytree(source,tmp)
  (tmp/'scripts/identity-v15.js').write_text(code)
  (tmp/'index.html').write_text(new_html)
  require(sum(p.is_file() for p in source.rglob('*')) ==
          sum(p.is_file() for p in tmp.rglob('*')),'FILE_COUNT_CHANGED')
  require((tmp/'scripts/timetable-ai-v1.js').read_bytes() ==
          (source/'scripts/timetable-ai-v1.js').read_bytes(),'AI_CODE_CHANGED')
  require((tmp/'scripts/01-core.js').read_bytes() ==
          (source/'scripts/01-core.js').read_bytes(),'AUTH_CORE_CHANGED')
  cmd(['node','--check',str(tmp/'scripts/identity-v15.js')],20)
  tmp.rename(RELEASE)
  (STAGE/'frontend-overlay.before-auth-logout.yml').write_text(prior)
  print('OAUTH_LOGOUT_PATCH=VERIFIED_IMMUTABLE_FRONTEND')
  phase='activate'
  OVERLAY.write_text(prior.replace(str(source),str(RELEASE)))
  activated=True
  cmd(COMPOSE+['config','--quiet'],45)
  cmd(COMPOSE+['up','-d','--no-deps','caddy'],110)
  require(mount()==RELEASE,'CADDY_ACTIVE_RELEASE_MISMATCH')
  live_index=cmd(DOCKER+['exec','supabase-caddy','cat','/srv/neis-circle/index.html'],25)
  live_js=cmd(DOCKER+['exec','supabase-caddy','cat',
                '/srv/neis-circle/scripts/identity-v15.js'],25)
  require('oauthlogout=20261102v1' in live_index and
          'scripts/timetable-ai-v1.js' in live_index and
          safer in live_js and fixed in live_js,'LIVE_ASSETS_UNVERIFIED')
  print('OAUTH_LOGOUT_HOTFIX=SUCCESS')
  print('OAUTH_FAILURE_BANNER=SHOW_ONLY_ON_REAL_FAILURE')
  print('LOGOUT_CLEARS_STALE_ERROR=YES')
  print('TIMETABLE_AI_AND_OTHER_FEATURES=PRESERVED')
  print('SUPABASE_AND_AUTH_CONFIG=UNCHANGED')
if __name__=='__main__':
  try:main()
  except Exception as e:
    label=str(e)
    if not re.fullmatch(r'[A-Z_]{4,70}',label):label='UNEXPECTED'
    print('OAUTH_LOGOUT_HOTFIX=FAILED_'+phase.upper()+'_'+label,file=sys.stderr)
    rollback()
    raise SystemExit(1)
