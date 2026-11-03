#!/usr/bin/env python3
"""Safely activate only the LiveKit screen sharing DOM stability patch on OVH."""
import hashlib,json,os,pathlib,re,shutil,subprocess,sys

ROOT=pathlib.Path('/home/ubuntu/neis-supabase')
STAGE=pathlib.Path('/home/ubuntu/neis-backups/meeting-screen-stability-20261103')
RELEASES=pathlib.Path('/home/ubuntu/neis-frontend/releases')
OVERLAY=ROOT/'docker-compose.frontend-public.yml'
ASSET='scripts/05-social.js'
VERSION='20261103-stable-screenshare'
DOCKER=['sudo','-n','/usr/bin/docker']
COMPOSE=DOCKER+['compose']+[x for f in ('docker-compose.yml','docker-compose.security.yml','docker-compose.caddy.yml','docker-compose.frontend-public.yml','docker-compose.auth-public-direct.yml') for x in ('-f',f)]
def check(value,code):
 if not value: raise RuntimeError(code)
def cmd(args,timeout=90,required=True):
 r=subprocess.run(args,cwd=ROOT,capture_output=True,text=True,timeout=timeout)
 if required and r.returncode: raise RuntimeError('COMMAND_FAILED')
 return r.stdout
def sha(s):return hashlib.sha256(s.encode('utf-8')).hexdigest()
def main():
 check(STAGE.is_dir() and OVERLAY.is_file() and RELEASES.is_dir(),'STAGE_MISSING')
 source_file=STAGE/'05-social.js'
 check(source_file.is_file(),'SOURCE_MISSING')
 source=source_file.read_text()
 check('tile._neisMeetingTrack!==nextTrack' in source and
       "tile.dataset.meetingIdentity=identity" in source and
       "if(active.has(tile.dataset?.meetingIdentity))return" in source and
       "room.on(lk.RoomEvent.ParticipantConnected" in source,'INVALID_SOURCE')
 cmd(['node','--check',str(source_file)],timeout=20)
 cmd(COMPOSE+['config','--quiet'],timeout=50)
 inspect=json.loads(cmd(DOCKER+['inspect','supabase-caddy'],timeout=30))[0]
 mounts=[x['Source'] for x in inspect.get('Mounts',[]) if x.get('Type')=='bind' and x.get('Destination')=='/srv/neis-circle']
 check(len(mounts)==1,'BIND_MISSING')
 old=pathlib.Path(mounts[0])
 check(old.is_dir() and old.parent==RELEASES,'UNEXPECTED_RELEASE')
 original=OVERLAY.read_text()
 check(original.count(str(old))==1,'OVERLAY_CHANGED')
 html=(old/'index.html').read_text()
 check(html.count('scripts/05-social.js')==1 and (old/ASSET).is_file() and html.count('</body>')==1,'INVALID_LIVE_INDEX')
 count=sum(f.is_file() for f in old.rglob('*'))
 check(count>100,'INCOMPLETE_RELEASE')
 rev=os.environ.get('GITHUB_SHA','')[:12]
 check(bool(re.fullmatch('[0-9a-f]{12}',rev)),'INVALID_REVISION')
 release=RELEASES/('meeting-screen-stability-'+rev)
 building=pathlib.Path(str(release)+'.building')
 check(not release.exists() and not building.exists(),'RELEASE_EXISTS')
 shutil.copytree(old,building)
 shutil.copy2(source_file,building/ASSET)
 changed_html,n=re.subn(r'(scripts/05-social\.js)(?:\?[^"\s]*)?',lambda m:m.group(1)+'?v='+VERSION,html,count=1)
 check(n==1,'CACHE_BUST_FAILED')
 (building/'index.html').write_text(changed_html)
 check(sum(f.is_file() for f in building.rglob('*'))==count and sha((building/ASSET).read_text())==sha(source),'COPY_INVALID')
 building.rename(release)
 switched=False
 try:
  OVERLAY.write_text(original.replace(str(old),str(release),1));switched=True
  cmd(COMPOSE+['config','--quiet'],timeout=50)
  cmd(COMPOSE+['up','-d','--no-deps','caddy'],timeout=150)
  cid=cmd(COMPOSE+['ps','-q','caddy'],timeout=30).strip()
  check(bool(cid),'CADDY_DOWN')
  live_html=cmd(DOCKER+['exec',cid,'cat','/srv/neis-circle/index.html'],timeout=30)
  live_js=cmd(DOCKER+['exec',cid,'cat','/srv/neis-circle/'+ASSET],timeout=30)
  check('scripts/05-social.js?v='+VERSION in live_html and sha(live_js)==sha(source),'LIVE_MISMATCH')
  config=cmd(DOCKER+['exec',cid,'cat','/etc/caddy/Caddyfile'],timeout=30)
  check(all(s in config for s in ('reverse_proxy rest:3000','reverse_proxy auth:9999','basic_auth')),'AUTH_PROXY_CHANGED')
 except Exception:
  if switched:
   OVERLAY.write_text(original)
   cmd(COMPOSE+['up','-d','--no-deps','caddy'],timeout=120,required=False)
   print('LIVEKIT_SCREEN_STABILITY=ROLLED_BACK')
  raise
 print('LIVEKIT_SCREEN_STABILITY=DEPLOYED_AND_VERIFIED')
 print('FRONTEND_REVISION='+rev)
 print('BACKEND_AND_DATABASE=UNCHANGED')
if __name__=='__main__':
 try:main()
 except Exception as exc:
  print('LIVEKIT_SCREEN_STABILITY=FAILED_'+str(exc)[:75],file=sys.stderr)
  sys.exit(1)
