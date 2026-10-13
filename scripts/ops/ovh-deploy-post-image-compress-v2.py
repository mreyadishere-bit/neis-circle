#!/usr/bin/env python3
"""Safely add post/circle image compression over the CURRENT OVH frontend.
Adds exactly one JS file and script tag; does not overwrite server/core scripts.
"""
from pathlib import Path
import json,shutil,subprocess,sys
ROOT=Path('/home/ubuntu/neis-supabase')
STAGE=Path('/home/ubuntu/neis-backups/post-image-auto-compression-20261013-v2')
TARGET=Path('/home/ubuntu/neis-frontend/releases/post-image-auto-compression-20261013-v2')
OVERLAY=ROOT/'docker-compose.frontend-public.yml'
NEW='scripts/media-auto-compression-v2.js'
TAG='<script defer src="'+NEW+'?postcompress=20261013v2"></script>'
DOCKER=['sudo','-n','/usr/bin/docker']
COMPOSE=DOCKER+['compose']+[part for name in
 ('docker-compose.yml','docker-compose.security.yml','docker-compose.caddy.yml',
  'docker-compose.frontend-public.yml','docker-compose.auth-public-direct.yml')
 for part in ('-f',name)]
phase='preflight'
def call(command,timeout=75,check=True):
    proc=subprocess.run(command,cwd=ROOT,capture_output=True,text=True,timeout=timeout)
    if check and proc.returncode:raise RuntimeError('COMMAND_FAILED')
    return proc.stdout
def ensure(ok,reason):
    if not ok:raise RuntimeError(reason)
def main():
    global phase
    ensure((STAGE/'post-compress.js').is_file() and OVERLAY.is_file(),'MISSING_SOURCE')
    content=(STAGE/'post-compress.js').read_text()
    ensure(all(t in content for t in ('window.uploadMedia=optimizedUploadMedia',
      'NEISImageOptimizer.prepare','Image optimized:','8*1024*1024',
      'await saved.call(this,result.file,folder)')),'INVALID_UPLOADER')
    call(['node','--check',str(STAGE/'post-compress.js')],timeout=15)
    call(COMPOSE+['config','--quiet'],timeout=38)
    mounts=[m['Source'] for m in json.loads(
      call(DOCKER+['inspect','supabase-caddy'],timeout=20))[0].get('Mounts',[])
      if m.get('Type')=='bind' and m.get('Destination')=='/srv/neis-circle']
    ensure(len(mounts)==1,'FRONTEND_MOUNT_UNKNOWN')
    live=Path(mounts[0])
    ensure(live.is_dir() and
      str(live).startswith('/home/ubuntu/neis-frontend/releases/'),'LIVE_PATH_INVALID')
    html=(live/'index.html').read_text()
    required=(
      'scripts/home-polls-v170.js','scripts/02-content-admin.js',
      'scripts/article-image-optimizer-v1.js','scripts/articles-v27.js',
      'scripts/timetable-export-png-v1.js','main-admin-auth-studio-v5.js')
    ensure(all(s in html for s in required) and
      NEW not in html and html.count('</body>')==1,
      'CURRENT_FRONTEND_UNEXPECTED')
    original_uploader=(live/'scripts/02-content-admin.js').read_text()
    ensure('async function uploadMedia(file,folder)' in original_uploader
       and 'Image must be smaller than 8 MB' in original_uploader,
      'LEGACY_UPLOAD_HANDLER_CHANGED')
    original_optimizer=(live/'scripts/article-image-optimizer-v1.js').read_text()
    ensure('window.NEISImageOptimizer=' in original_optimizer,'OPTIMIZER_NOT_ACTIVE')
    overlay=OVERLAY.read_text()
    ensure(overlay.count(str(live))==1,'MOUNT_REPLACEMENT_UNSAFE')
    ensure(not TARGET.exists() and not Path(str(TARGET)+'.building').exists(),
      'TARGET_EXISTS')
    source_count=sum(p.is_file() for p in live.rglob('*'))
    ensure(source_count>100,'INCOMPLETE_LIVE_RELEASE')
    phase='prepare'
    build=Path(str(TARGET)+'.building')
    shutil.copytree(live,build)
    shutil.copy2(STAGE/'post-compress.js',build/NEW)
    index=html.replace('</body>',TAG+'\n</body>')
    (build/'index.html').write_text(index)
    ensure(sum(p.is_file() for p in build.rglob('*'))==source_count+1
      and index.count(TAG)==1,'COPY_FAILED')
    build.rename(TARGET)
    (STAGE/'overlay.before-post-compress.yml').write_text(overlay)
    phase='activate'
    swapped=False
    try:
      OVERLAY.write_text(overlay.replace(str(live),str(TARGET)))
      swapped=True
      call(COMPOSE+['config','--quiet'],timeout=38)
      call(COMPOSE+['up','-d','--no-deps','caddy'],timeout=120)
      cid=call(COMPOSE+['ps','-q','caddy'],timeout=23).strip()
      ensure(bool(cid),'CADDY_NOT_RUNNING')
      served=call(DOCKER+['exec',cid,'cat','/srv/neis-circle/index.html'],timeout=23)
      js=call(DOCKER+['exec',cid,'cat','/srv/neis-circle/'+NEW],timeout=23)
      ensure(TAG in served and
        all(s in served for s in required) and
        'window.uploadMedia=optimizedUploadMedia' in js,'LIVE_FILES_UNVERIFIED')
      caddy=call(DOCKER+['exec',cid,'cat','/etc/caddy/Caddyfile'],timeout=23)
      ensure(all(t in caddy for t in ('reverse_proxy rest:3000',
        'reverse_proxy auth:9999','basic_auth')),'REVERSE_PROXY_CHANGED')
    except Exception:
      if swapped:
        OVERLAY.write_text(overlay)
        call(COMPOSE+['up','-d','--no-deps','caddy'],timeout=95,check=False)
        print('POST_IMAGE_COMPRESS_FRONTEND=ROLLED_BACK')
      raise
    print('POST_IMAGE_COMPRESS_DEPLOY=SUCCESS')
    print('POST_IMAGE_COMPRESS_ALL_POSTS_AND_CIRCLES=ENABLED')
    print('POST_IMAGE_COMPRESS_25MB_JPEG=SUPPORTED')
    print('POST_IMAGE_COMPRESS_LIMIT=7.5_MIB')
    print('POST_IMAGE_COMPRESS_EXISTING_DATA=UNCHANGED')
    print('POST_IMAGE_COMPRESS_NO_SERVER_SIDE_COST=YES')
if __name__=='__main__':
    try:main()
    except Exception as ex:
      permitted={'MISSING_SOURCE','INVALID_UPLOADER','FRONTEND_MOUNT_UNKNOWN',
        'LIVE_PATH_INVALID','CURRENT_FRONTEND_UNEXPECTED','LEGACY_UPLOAD_HANDLER_CHANGED',
        'OPTIMIZER_NOT_ACTIVE','MOUNT_REPLACEMENT_UNSAFE','TARGET_EXISTS',
        'INCOMPLETE_LIVE_RELEASE','COPY_FAILED','CADDY_NOT_RUNNING',
        'LIVE_FILES_UNVERIFIED','REVERSE_PROXY_CHANGED','COMMAND_FAILED'}
      code=str(ex) if str(ex) in permitted else 'UNEXPECTED'
      print('POST_IMAGE_COMPRESS_DEPLOY=FAILED_'+phase.upper()+'_'+code,file=sys.stderr)
      raise SystemExit(1)
