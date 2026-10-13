#!/usr/bin/env python3
"""Deploy fast image preparation overlay onto the CURRENT live OVH frontend.

No core JS, auth, DB or storage migration. Only adds a CSS file and one script
to an immutable copy of the currently served release, with automatic rollback.
"""
from pathlib import Path
import subprocess,shutil,json,sys
ROOT=Path('/home/ubuntu/neis-supabase')
STAGE=Path('/home/ubuntu/neis-backups/fast-image-publish-20261013-v3')
RELEASE=Path('/home/ubuntu/neis-frontend/releases/fast-image-publish-20261013-v3')
OVERLAY=ROOT/'docker-compose.frontend-public.yml'
JS='scripts/media-fast-publish-v3.js'
CSS='styles/media-fast-publish-v3.css'
JSTAG='<script defer src="'+JS+'?fastpublish=20261013v3"></script>'
CSSTAG='<link rel="stylesheet" href="'+CSS+'?fastpublish=20261013v3">'
DOCKER=['sudo','-n','/usr/bin/docker']
COMPOSE=DOCKER+['compose']+[part for name in (
 'docker-compose.yml','docker-compose.security.yml','docker-compose.caddy.yml',
 'docker-compose.frontend-public.yml','docker-compose.auth-public-direct.yml')
 for part in ('-f',name)]
stage='preflight'

def run(args,timeout=100,check=True):
  result=subprocess.run(args,text=True,capture_output=True,cwd=ROOT,timeout=timeout)
  if check and result.returncode:raise RuntimeError('COMMAND_FAILED')
  return result.stdout

def need(ok,code):
  if not ok:raise RuntimeError(code)

def main():
 global stage
 need(OVERLAY.is_file() and (STAGE/'fast.js').is_file() and
   (STAGE/'fast.css').is_file(),'STAGE_MISSING')
 code=(STAGE/'fast.js').read_text()
 for k in ("window.uploadMedia=publish","window.NEISImageOptimizer=",
           "image/jpeg","jpegDimensions","resizeWidth:width",
           "FAST" if False else "neis-image-processing-status"):
  need(k in code,'INVALID_JS')
 need('for(const quality of [.92,.86,.80,.72])' not in code,
   'SLOW_ENCODER_REINTRODUCED')
 run(['node','--check',str(STAGE/'fast.js')],timeout=15)
 run(COMPOSE+['config','--quiet'],timeout=40)
 container=json.loads(run(DOCKER+['inspect','supabase-caddy'],timeout=25))[0]
 mounts=[m['Source'] for m in container.get('Mounts',[])
   if m.get('Type')=='bind' and m.get('Destination')=='/srv/neis-circle']
 need(len(mounts)==1,'BIND_MISSING')
 old=Path(mounts[0])
 need(old.is_dir() and str(old).startswith('/home/ubuntu/neis-frontend/releases/'),
   'UNEXPECTED_RELEASE')
 index=(old/'index.html').read_text()
 required=[
  'scripts/article-image-optimizer-v1.js',
  'scripts/article-image-optimizer-v2.js',
  'scripts/media-auto-compression-v2.js',
  'scripts/articles-v27.js',
  'scripts/home-polls-v170.js',
  'scripts/timetable-export-png-v1.js',
  'main-admin-auth-studio-v5.js'
 ]
 need(all(x in index for x in required) and
      JS not in index and CSS not in index and
      index.count('</head>')==1 and index.count('</body>')==1,
      'UNEXPECTED_LIVE_INDEX')
 overlay=OVERLAY.read_text()
 need(overlay.count(str(old))==1,'OVERLAY_CHANGED')
 need(not RELEASE.exists() and not Path(str(RELEASE)+'.building').exists(),
   'TARGET_ALREADY_EXISTS')
 count=sum(p.is_file() for p in old.rglob('*'))
 need(count>100,'LIVE_RELEASE_INCOMPLETE')
 stage='copy'
 tmp=Path(str(RELEASE)+'.building')
 shutil.copytree(old,tmp)
 shutil.copy2(STAGE/'fast.js',tmp/JS)
 shutil.copy2(STAGE/'fast.css',tmp/CSS)
 changed=index.replace('</head>',CSSTAG+'\n</head>').replace(
   '</body>',JSTAG+'\n</body>')
 (tmp/'index.html').write_text(changed)
 need(sum(p.is_file() for p in tmp.rglob('*'))==count+2 and
   changed.count(JSTAG)==1 and changed.count(CSSTAG)==1,'COPY_INVALID')
 tmp.rename(RELEASE)
 (STAGE/'overlay.before-fast-v3.yml').write_text(overlay)
 stage='deploy'
 switched=False
 try:
   OVERLAY.write_text(overlay.replace(str(old),str(RELEASE)))
   switched=True
   run(COMPOSE+['config','--quiet'],timeout=40)
   run(COMPOSE+['up','-d','--no-deps','caddy'],timeout=130)
   cid=run(COMPOSE+['ps','-q','caddy'],timeout=25).strip()
   need(bool(cid),'CADDY_DOWN')
   served=run(DOCKER+['exec',cid,'cat','/srv/neis-circle/index.html'],timeout=25)
   live_js=run(DOCKER+['exec',cid,'cat','/srv/neis-circle/'+JS],timeout=25)
   live_css=run(DOCKER+['exec',cid,'cat','/srv/neis-circle/'+CSS],timeout=25)
   need(JSTAG in served and CSSTAG in served and
     all(x in served for x in required) and
     'window.uploadMedia=publish' in live_js and
     'neis-image-processing-status' in live_css,'ASSET_VERIFICATION_FAILED')
   conf=run(DOCKER+['exec',cid,'cat','/etc/caddy/Caddyfile'],timeout=25)
   need(all(x in conf for x in
     ('reverse_proxy rest:3000','reverse_proxy auth:9999','basic_auth')),
     'AUTH_PROXY_CHANGED')
 except Exception:
   if switched:
     OVERLAY.write_text(overlay)
     run(COMPOSE+['up','-d','--no-deps','caddy'],timeout=110,check=False)
     print('FAST_IMAGE_PUBLISH_FRONTEND=ROLLED_BACK')
   raise
 print('FAST_IMAGE_PUBLISH_DEPLOY=SUCCESS')
 print('FAST_IMAGE_PUBLISH_BACKGROUND_PREPARATION=YES')
 print('FAST_IMAGE_PUBLISH_ENCODER=MAX_3_ATTEMPTS')
 print('FAST_IMAGE_PUBLISH_PROGRESS=VISIBLE')
 print('FAST_IMAGE_PUBLISH_SERVER_AUTH_DB=UNCHANGED')
 print('FAST_IMAGE_PUBLISH_NEW_INFRASTRUCTURE=NONE')

if __name__=='__main__':
 try:main()
 except Exception as e:
   known={'STAGE_MISSING','INVALID_JS','SLOW_ENCODER_REINTRODUCED',
     'BIND_MISSING','UNEXPECTED_RELEASE','UNEXPECTED_LIVE_INDEX',
     'OVERLAY_CHANGED','TARGET_ALREADY_EXISTS','LIVE_RELEASE_INCOMPLETE',
     'COPY_INVALID','CADDY_DOWN','ASSET_VERIFICATION_FAILED',
     'AUTH_PROXY_CHANGED','COMMAND_FAILED'}
   code=str(e) if str(e) in known else 'UNEXPECTED'
   print('FAST_IMAGE_PUBLISH_DEPLOY=FAILED_'+stage.upper()+'_'+code,file=sys.stderr)
   raise SystemExit(1)
