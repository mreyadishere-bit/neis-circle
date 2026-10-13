#!/usr/bin/env python3
"""Add image downsampling v2 to the live OVH frontend without altering uploads or data."""
from pathlib import Path
import json,shutil,subprocess,sys
ROOT=Path('/home/ubuntu/neis-supabase')
STAGE=Path('/home/ubuntu/neis-backups/large-image-downsample-20261013-v2')
DEST=Path('/home/ubuntu/neis-frontend/releases/large-image-downsample-20261013-v2')
OVERLAY=ROOT/'docker-compose.frontend-public.yml'
JS='scripts/article-image-optimizer-v2.js'
TAG='<script defer src="'+JS+'?bigpixels=20261013v2"></script>'
DOCKER=['sudo','-n','/usr/bin/docker']
COMPOSE=DOCKER+['compose']+[item for f in (
 'docker-compose.yml','docker-compose.security.yml','docker-compose.caddy.yml',
 'docker-compose.frontend-public.yml','docker-compose.auth-public-direct.yml')
 for item in ('-f',f)]
phase='preflight'
def call(args,timeout=80,check=True):
 p=subprocess.run(args,text=True,capture_output=True,cwd=ROOT,timeout=timeout)
 if check and p.returncode:raise RuntimeError('COMMAND_FAILED')
 return p.stdout
def require(ok,reason):
 if not ok:raise RuntimeError(reason)
def main():
 global phase
 require(OVERLAY.is_file() and (STAGE/'optimizer.js').is_file(),'STAGING_MISSING')
 js=(STAGE/'optimizer.js').read_text()
 for token in ("NEISImageOptimizer=Object.freeze","createImageBitmap(file,",
               "resizeWidth:rw","resizeHeight:rh",
               "MAX_SOURCE=100*MIB","Math.floor(7.5*MIB)"):
  require(token in js,'OPTIMIZER_CODE_INVALID')
 require('>180000000' not in js and 'exceed the safe processing limit' not in js,
   'OLD_PIXEL_REJECTION_FOUND')
 call(['node','--check',str(STAGE/'optimizer.js')],timeout=15)
 call(COMPOSE+['config','--quiet'],timeout=40)
 caddy=json.loads(call(DOCKER+['inspect','supabase-caddy'],timeout=20))[0]
 mounts=[m['Source'] for m in caddy.get('Mounts',[]) if
   m.get('Type')=='bind' and m.get('Destination')=='/srv/neis-circle']
 require(len(mounts)==1,'LIVE_FRONTEND_NOT_FOUND')
 live=Path(mounts[0])
 require(live.is_dir() and
   str(live).startswith('/home/ubuntu/neis-frontend/releases/'),'LIVE_PATH_CHANGED')
 html=(live/'index.html').read_text()
 required=['scripts/article-image-optimizer-v1.js',
   'scripts/media-auto-compression-v2.js',
   'scripts/home-polls-v170.js',
   'scripts/articles-v27.js',
   'main-admin-auth-studio-v5.js',
   'scripts/timetable-export-png-v1.js']
 require(all(x in html for x in required) and JS not in html and
   html.count('</body>')==1,'UNEXPECTED_LIVE_HTML')
 old=(live/'scripts/article-image-optimizer-v1.js').read_text()
 require('Image dimensions exceed the safe processing limit.' in old,
   'OLD_OPTIMIZER_ALREADY_CHANGED')
 original=OVERLAY.read_text()
 require(original.count(str(live))==1,'FRONTEND_OVERLAY_CHANGED')
 require(not DEST.exists() and not Path(str(DEST)+'.building').exists(),
   'DESTINATION_EXISTS')
 count=sum(p.is_file() for p in live.rglob('*'))
 require(count>100,'SOURCE_INCOMPLETE')
 phase='copy'
 temp=Path(str(DEST)+'.building')
 shutil.copytree(live,temp)
 shutil.copy2(STAGE/'optimizer.js',temp/JS)
 updated=html.replace('</body>',TAG+'\n</body>')
 (temp/'index.html').write_text(updated)
 require(sum(p.is_file() for p in temp.rglob('*'))==count+1 and
   updated.count(TAG)==1,'RELEASE_NOT_COMPLETE')
 temp.rename(DEST)
 (STAGE/'overlay.before-downsample-v2.yml').write_text(original)
 phase='activate'
 switched=False
 try:
  OVERLAY.write_text(original.replace(str(live),str(DEST)))
  switched=True
  call(COMPOSE+['config','--quiet'],timeout=40)
  call(COMPOSE+['up','-d','--no-deps','caddy'],timeout=125)
  cid=call(COMPOSE+['ps','-q','caddy'],timeout=24).strip()
  require(bool(cid),'CADDY_NOT_RUNNING')
  served=call(DOCKER+['exec',cid,'cat','/srv/neis-circle/index.html'],timeout=24)
  deployed=call(DOCKER+['exec',cid,'cat','/srv/neis-circle/'+JS],timeout=24)
  require(TAG in served and
    all(s in served for s in required) and
    'resizeWidth:rw' in deployed and
    'version:2' in deployed,'NEW_IMAGE_OPTIMIZER_NOT_LIVE')
  conf=call(DOCKER+['exec',cid,'cat','/etc/caddy/Caddyfile'],timeout=24)
  require(all(x in conf for x in
    ('reverse_proxy rest:3000','reverse_proxy auth:9999','basic_auth')),
    'AUTH_PROXY_CHANGED')
 except Exception:
  if switched:
   OVERLAY.write_text(original)
   call(COMPOSE+['up','-d','--no-deps','caddy'],timeout=100,check=False)
   print('IMAGE_DOWNSAMPLE_FRONTEND=ROLLED_BACK')
  raise
 print('IMAGE_DOWNSAMPLE_DEPLOY=SUCCESS')
 print('IMAGE_DOWNSAMPLE_LARGE_DIMENSIONS=BOUNDED_RESIZE')
 print('IMAGE_DOWNSAMPLE_POSTS_AND_ARTICLES=ENABLED')
 print('IMAGE_DOWNSAMPLE_EXISTING_DATA=UNCHANGED')
 print('IMAGE_DOWNSAMPLE_AUTH_AND_DB=UNCHANGED')
if __name__=='__main__':
 try:main()
 except Exception as ex:
  allowed={'STAGING_MISSING','OPTIMIZER_CODE_INVALID','OLD_PIXEL_REJECTION_FOUND',
    'LIVE_FRONTEND_NOT_FOUND','LIVE_PATH_CHANGED','UNEXPECTED_LIVE_HTML',
    'OLD_OPTIMIZER_ALREADY_CHANGED','FRONTEND_OVERLAY_CHANGED',
    'DESTINATION_EXISTS','SOURCE_INCOMPLETE','RELEASE_NOT_COMPLETE',
    'CADDY_NOT_RUNNING','NEW_IMAGE_OPTIMIZER_NOT_LIVE','AUTH_PROXY_CHANGED',
    'COMMAND_FAILED'}
  print('IMAGE_DOWNSAMPLE_DEPLOY=FAILED_'+phase.upper()+'_'+
    (str(ex) if str(ex) in allowed else 'UNEXPECTED'),file=sys.stderr)
  raise SystemExit(1)
