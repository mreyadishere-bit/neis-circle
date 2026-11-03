#!/usr/bin/env python3
"""Patch only the live Saved renderer on OVH; retain all other frontend assets."""
import hashlib,json,os,pathlib,re,shutil,subprocess,sys
ROOT=pathlib.Path('/home/ubuntu/neis-supabase')
STAGE=pathlib.Path('/home/ubuntu/neis-backups/saved-renderer-fix-20261103')
RELEASES=pathlib.Path('/home/ubuntu/neis-frontend/releases')
OVERLAY=ROOT/'docker-compose.frontend-public.yml'
ASSET='scripts/04-permissions-ux.js'
OLD='library=function()'
CLASS='feed saved-home-width-feed'
DOCKER=['sudo','-n','/usr/bin/docker']
COMPOSE=DOCKER+['compose']+[x for f in ('docker-compose.yml','docker-compose.security.yml','docker-compose.caddy.yml','docker-compose.frontend-public.yml','docker-compose.auth-public-direct.yml') for x in ('-f',f)]
def check(ok,why):
 if not ok:raise RuntimeError(why)
def run(args,timeout=90,required=True):
 result=subprocess.run(args,cwd=ROOT,capture_output=True,text=True,timeout=timeout)
 if result.returncode and required:raise RuntimeError('COMMAND_FAILED')
 return result.stdout
def sha(s):return hashlib.sha256(s.encode()).hexdigest()
def main():
 check(STAGE.is_dir() and RELEASES.is_dir() and OVERLAY.is_file(),'STAGE_MISSING')
 staged=(STAGE/'04-permissions-ux.js').read_text()
 check(staged.count(OLD)==1 and CLASS in staged[staged.index(OLD):],'STAGED_RENDERER_INVALID')
 run(['node','--check',str(STAGE/'04-permissions-ux.js')],timeout=20)
 run(COMPOSE+['config','--quiet'],timeout=40)
 obj=json.loads(run(DOCKER+['inspect','supabase-caddy'],timeout=30))[0]
 mounts=[m['Source'] for m in obj.get('Mounts',[]) if m.get('Type')=='bind' and m.get('Destination')=='/srv/neis-circle']
 check(len(mounts)==1,'MOUNT_INVALID')
 old=pathlib.Path(mounts[0])
 check(old.is_dir() and old.parent==RELEASES,'LIVE_RELEASE_INVALID')
 overlay=OVERLAY.read_text()
 check(overlay.count(str(old))==1,'OVERLAY_MISMATCH')
 html=(old/'index.html').read_text()
 check(html.count(ASSET)==1,'INDEX_MISSING_SCRIPT')
 previous=(old/ASSET).read_text()
 check(previous.count(OLD)==1,'LIVE_RENDERER_CHANGED')
 before=previous[previous.index(OLD):]
 check('<div class="feed">' in before or CLASS in before,'LIVE_FEED_MARKUP_CHANGED')
 changed=previous[:previous.index(OLD)]+before.replace('<div class="feed">','<div class="'+CLASS+'">',1)
 check(CLASS in changed[changed.index(OLD):],'PATCH_FAILED')
 # Retain the live server's script, changing only Saved markup.
 rev=os.environ.get('GITHUB_SHA','')[:12]
 check(bool(re.fullmatch('[a-f0-9]{12}',rev)),'REVISION_INVALID')
 target=RELEASES/('saved-renderer-width-'+rev)
 temp=pathlib.Path(str(target)+'.building')
 check(not target.exists() and not temp.exists(),'RELEASE_EXISTS')
 count=sum(f.is_file() for f in old.rglob('*'))
 check(count>100,'INCOMPLETE_FRONTEND')
 shutil.copytree(old,temp)
 (temp/ASSET).write_text(changed)
 updated,n=re.subn(r'(scripts/04-permissions-ux\.js)(?:\?[^"\s]*)?',lambda m:m.group(1)+'?v=20261103-saved-width-actual',html,count=1)
 check(n==1,'CACHE_BUST_FAILED')
 (temp/'index.html').write_text(updated)
 check(sum(f.is_file() for f in temp.rglob('*'))==count,'COPY_FAILED')
 run(['node','--check',str(temp/ASSET)],timeout=20)
 temp.rename(target)
 switched=False
 try:
  OVERLAY.write_text(overlay.replace(str(old),str(target),1));switched=True
  run(COMPOSE+['config','--quiet'],timeout=40)
  run(COMPOSE+['up','-d','--no-deps','caddy'],timeout=150)
  cid=run(COMPOSE+['ps','-q','caddy'],timeout=30).strip()
  check(bool(cid),'CADDY_DOWN')
  live=run(DOCKER+['exec',cid,'cat','/srv/neis-circle/'+ASSET],timeout=30)
  livehtml=run(DOCKER+['exec',cid,'cat','/srv/neis-circle/index.html'],timeout=30)
  livecss=run(DOCKER+['exec',cid,'cat','/srv/neis-circle/styles/app.css'],timeout=30)
  check(sha(live)==sha(changed),'LIVE_FILE_MISMATCH')
  check('04-permissions-ux.js?v=20261103-saved-width-actual' in livehtml,'LIVE_INDEX_MISMATCH')
  check('#view .saved-home-width-feed' in livecss,'LIVE_WIDTH_CSS_MISSING')
  check(live.replace(CLASS,'feed',1)==previous,'UNRELATED_SCRIPT_CHANGE')
  conf=run(DOCKER+['exec',cid,'cat','/etc/caddy/Caddyfile'],timeout=30)
  check(all(v in conf for v in ('reverse_proxy rest:3000','reverse_proxy auth:9999','basic_auth')),'PROXY_CHANGED')
 except Exception:
  if switched:
   OVERLAY.write_text(overlay)
   run(COMPOSE+['up','-d','--no-deps','caddy'],timeout=120,required=False)
   print('SAVED_RENDERER_WIDTH=ROLLED_BACK')
  raise
 print('SAVED_RENDERER_WIDTH=DEPLOYED_AND_VERIFIED')
 print('POSTS_AND_DATABASE=UNCHANGED')
if __name__=='__main__':
 try:main()
 except Exception as error:
  print('SAVED_RENDERER_WIDTH=FAILED_'+str(error)[:75],file=sys.stderr)
  sys.exit(1)
