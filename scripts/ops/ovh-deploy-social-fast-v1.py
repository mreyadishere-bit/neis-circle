#!/usr/bin/env python3
"""OVH frontend-only NEIS Play design rollout; never touch DB or Edge."""
import hashlib,json,os,pathlib,re,shutil,subprocess,sys
ROOT=pathlib.Path('/home/ubuntu/neis-supabase')
STAGE=pathlib.Path('/home/ubuntu/neis-backups/neis-social-fast-20261103')
REL=pathlib.Path('/home/ubuntu/neis-frontend/releases')
OVERLAY=ROOT/'docker-compose.frontend-public.yml'
FILES={'neis-play-v1.js':'scripts/neis-play-v1.js','neis-play-v1.css':'styles/neis-play-v1.css'}
SOCIAL='scripts/05-social.js'
DOCKER=['sudo','-n','/usr/bin/docker']
COMPOSE=DOCKER+['compose']+[x for file in ('docker-compose.yml','docker-compose.security.yml','docker-compose.caddy.yml','docker-compose.frontend-public.yml','docker-compose.auth-public-direct.yml') for x in ('-f',file)]
def check(ok,msg):
 if not ok:raise RuntimeError(msg)
def call(args,timeout=100,require=True):
 p=subprocess.run(args,cwd=ROOT,capture_output=True,text=True,timeout=timeout)
 if p.returncode and require:raise RuntimeError('COMMAND_FAILED_'+str(p.returncode)+':'+p.stderr[-160:])
 return p.stdout
def sha(s):return hashlib.sha256(s.encode()).hexdigest()
def active():
 obj=json.loads(call(DOCKER+['inspect','supabase-caddy'],timeout=30))[0]
 check(obj.get('State',{}).get('Running'),'CADDY_DOWN')
 binds=[pathlib.Path(m['Source']) for m in obj.get('Mounts',[]) if m.get('Destination')=='/srv/neis-circle' and m.get('Type')=='bind']
 check(len(binds)==1 and binds[0].is_dir(),'CADDY_MOUNT_MISSING')
 return binds[0]
def main():
 check(OVERLAY.is_file() and REL.is_dir() and STAGE.is_dir(),'STAGE_MISSING')
 js=(STAGE/'neis-play-v1.js').read_text()
 css=(STAGE/'neis-play-v1.css').read_text()
 social=(STAGE/'05-social.js').read_text()
 check('neis-hub-intro' in js and 'neis-game-grid' in js and 'sendInvitation(kind,id)' in js,'HUB_SOURCE_INCOMPLETE')
 check('.neis-game-card' in css and '.neis-hub-discover-grid' in css and '#view .neis-invite-list{max-height:' in css,'HUB_CSS_INCOMPLETE')
 check('async function loadCirclesFast(force=false)' in social and 'circlesFastLoadedAt' in social,'CIRCLE_FAST_LOADER_MISSING')
 check('if(S.open&&!root()){S.open=false' in js,'PLAY_NAVIGATION_GUARD_MISSING')
 call(['node','--check',str(STAGE/'neis-play-v1.js')],timeout=25)
 call(['node','--check',str(STAGE/'05-social.js')],timeout=25)
 call(COMPOSE+['config','--quiet'],timeout=55)
 old=active()
 check(old.parent==REL,'UNEXPECTED_LIVE_RELEASE')
 overlay=OVERLAY.read_text()
 check(overlay.count(str(old))==1,'FRONT_OVERLAY_CHANGED')
 html=(old/'index.html').read_text()
 check(html.count('scripts/neis-play-v1.js')==1 and html.count('styles/neis-play-v1.css')==1 and html.count(SOCIAL)==1,'LIVE_INDEX_MISSING')
 check('data-coordinator-v171.js' in html,'DATA_COORDINATOR_MISSING')
 count=sum(p.is_file() for p in old.rglob('*'))
 check(count>100,'FRONTEND_INCOMPLETE')
 if '--dry-run' in sys.argv:
  running=(old/SOCIAL).read_text()
  required=[
   'const coreLoad=loadLiveData;',
   'loadLiveData=async function(){',
   '  const notificationSetupPromise=setupNotificationRealtime(uid).catch(error=>{',
   'circles=function(){',
   'function circleCard(c){',
   'circle-discovery-grid'
  ]
  missing=[str(index+1) for index,item in enumerate(required) if item not in running]
  if missing:print('NEIS_SOCIAL_LIVE_MISSING_ANCHORS='+','.join(missing))
  check(not missing,'LIVE_SOCIAL_PREVIEW_ANCHOR_CHANGED')
  print('NEIS_SOCIAL_FAST_PREFLIGHT=PASS')
  return
 rev=os.environ.get('GITHUB_SHA','')[:12]
 check(bool(re.fullmatch('[a-f0-9]{12}',rev)),'REVISION_INVALID')
 dest=REL/('neis-social-fast-'+rev)
 tmp=pathlib.Path(str(dest)+'.building')
 check(not dest.exists() and not tmp.exists(),'RELEASE_EXISTS')
 shutil.copytree(old,tmp)
 # Apply only the reviewed Circles bootstrap and view changes to the running
 # social bundle. Do not overwrite OVH-only chat and notification hotfixes.
 live_social=(old/SOCIAL).read_text()
 marker='const coreLoad=loadLiveData;'
 loader='loadLiveData=async function(){'
 check(live_social.count(marker)==1 and live_social.count(loader)==1,'SOCIAL_BOOTSTRAP_ANCHOR_MISSING')
 if 'async function loadCirclesFast(force=false)' not in live_social:
  helper=social[social.index(marker)+len(marker):social.index(loader,social.index(marker))]
  check('async function loadCirclesFast(force=false)' in helper,'CIRCLE_HELPER_INVALID')
  live_social=live_social.replace(marker,marker+helper,1)
 else:
  print('NEIS_SOCIAL_FAST_LOADER=ALREADY_PRESENT')
 insert_before='  const notificationSetupPromise=setupNotificationRealtime(uid).catch(error=>{'
 check(live_social.count(insert_before)==1,'NOTIFICATION_BOOTSTRAP_MISSING')
 if 'const circlesEarly=loadCirclesFast();' not in live_social:
  live_social=live_social.replace(insert_before,'  const circlesEarly=loadCirclesFast();\\n'.replace('\\n','\n')+insert_before,1)
 else:
  print('NEIS_SOCIAL_EARLY_FETCH=ALREADY_PRESENT')
 view_start='circles=function(){'
 view_end='function circleCard(c){'
 check(social.count(view_start)==1 and social.count(view_end)==1 and live_social.count(view_start)==1 and live_social.count(view_end)==1,'CIRCLES_VIEW_ANCHORS_CHANGED')
 original_view=live_social[live_social.index(view_start):live_social.index(view_end)]
 revised_view=social[social.index(view_start):social.index(view_end)]
 check('data-circle-retry' in revised_view and 'state.circlesLoading?' in revised_view,'CIRCLES_VIEW_INVALID')
 live_social=live_social.replace(original_view,revised_view,1)
 check(live_social.count('async function loadCirclesFast(force=false)')==1,'DUPLICATE_CIRCLES_LOADER')
 check(live_social.count('const circlesEarly=loadCirclesFast();')==1,'CIRCLES_EARLY_LAUNCH_MISSING')
 check('circle-discovery-grid' in live_social and 'data-circle-retry' in live_social,'CIRCLES_VIEW_MISSING')
 (tmp/SOCIAL).write_text(live_social)
 call(['node','--check',str(tmp/SOCIAL)],timeout=25)
 for src,target in FILES.items():shutil.copy2(STAGE/src,tmp/target)
 for target in [*FILES.values(),SOCIAL]:
  html,n=re.subn('('+re.escape(target)+r')(?:\?[^"\s]*)?',lambda m:m.group(1)+'?v=hub-'+rev,html,count=1)
  check(n==1,'CACHE_BUST_FAILED_'+target)
 (tmp/'index.html').write_text(html)
 check(sum(p.is_file() for p in tmp.rglob('*'))==count,'FRONT_FILE_COUNT_CHANGED')
 check(sha((tmp/'scripts/neis-play-v1.js').read_text())==sha(js),'SCRIPT_COPY_FAILED')
 check(sha((tmp/'styles/neis-play-v1.css').read_text())==sha(css),'CSS_COPY_FAILED')
 # Preserve core runtime ordering and every existing script outside NEIS Play.
 check(html.index('scripts/neis-play-v1.js')<html.index('scripts/data-coordinator-v171.js'),'SCRIPT_LOAD_ORDER_CHANGED')
 tmp.rename(dest)
 changed=False
 try:
  OVERLAY.write_text(overlay.replace(str(old),str(dest),1));changed=True
  call(COMPOSE+['config','--quiet'],timeout=55)
  call(COMPOSE+['up','-d','--no-deps','caddy'],timeout=140)
  check(active()==dest,'NEW_RELEASE_NOT_ACTIVE')
  cid=call(COMPOSE+['ps','-q','caddy'],timeout=25).strip()
  check(bool(cid),'CADDY_CONTAINER_MISSING')
  index=call(DOCKER+['exec',cid,'cat','/srv/neis-circle/index.html'],timeout=25)
  livejs=call(DOCKER+['exec',cid,'cat','/srv/neis-circle/scripts/neis-play-v1.js'],timeout=25)
  livecss=call(DOCKER+['exec',cid,'cat','/srv/neis-circle/styles/neis-play-v1.css'],timeout=25)
  livesocial=call(DOCKER+['exec',cid,'cat','/srv/neis-circle/'+SOCIAL],timeout=40)
  check('neis-play-v1.js?v=hub-'+rev in index and 'neis-play-v1.css?v=hub-'+rev in index and SOCIAL+'?v=hub-'+rev in index,'LIVE_CACHE_MISMATCH')
  check(sha(livejs)==sha(js) and sha(livecss)==sha(css) and sha(livesocial)==sha(live_social),'LIVE_CONTENT_MISMATCH')
  conf=call(DOCKER+['exec',cid,'cat','/etc/caddy/Caddyfile'],timeout=25)
  check(all(x in conf for x in ('reverse_proxy rest:3000','reverse_proxy auth:9999','basic_auth')),'AUTH_PROXY_CHANGED')
 except Exception:
  if changed:
   OVERLAY.write_text(overlay)
   call(COMPOSE+['up','-d','--no-deps','caddy'],timeout=120,require=False)
   print('NEIS_SOCIAL_FAST=ROLLED_BACK')
  raise
 print('NEIS_SOCIAL_FAST=DEPLOYED_AND_VERIFIED')
 print('NEIS_SOCIAL_FAST_DATABASE_EDGE=UNTOUCHED')
 print('NEIS_SOCIAL_FAST_RELEASE='+rev)
if __name__=='__main__':
 try:main()
 except Exception as error:
  print('NEIS_SOCIAL_FAST=FAILED_'+str(error)[:80],file=sys.stderr)
  sys.exit(1)
