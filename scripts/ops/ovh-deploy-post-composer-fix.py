#!/usr/bin/env python3
"""Safely deploy the image preview/upload/publish hotfix to a new immutable OVH frontend release."""
from pathlib import Path
import subprocess, shutil, json, sys, re, hashlib

ROOT=Path('/home/ubuntu/neis-supabase')
STAGE=Path('/home/ubuntu/neis-backups/post-composer-fix-stage')
OVERLAY=ROOT/'docker-compose.frontend-public.yml'
DOCKER=['sudo','-n','/usr/bin/docker']
COMPOSE=DOCKER+['compose']+[part for name in (
 'docker-compose.yml','docker-compose.security.yml','docker-compose.caddy.yml',
 'docker-compose.frontend-public.yml','docker-compose.auth-public-direct.yml')
 for part in ('-f',name)]
FILES={
 'content-admin.js':('scripts/02-content-admin.js','[NEIS media upload network failure]'),
 'social.js':('scripts/05-social.js','post publish network failure'),
 'image-editor.js':('scripts/06-image-editor.js','reader.readAsDataURL(file)')
}
stage='preflight'

def run(args,timeout=100,check=True):
 result=subprocess.run(args,text=True,capture_output=True,cwd=ROOT,timeout=timeout)
 if check and result.returncode: raise RuntimeError('COMMAND_FAILED')
 return result.stdout

def need(ok,code):
 if not ok: raise RuntimeError(code)

def digest(value):
 return hashlib.sha256(value.encode('utf-8')).hexdigest()

def main():
 global stage
 need(OVERLAY.is_file() and (STAGE/'release-name.txt').is_file() and
      all((STAGE/name).is_file() for name in FILES),'STAGE_MISSING')
 release_name=(STAGE/'release-name.txt').read_text().strip()
 need(bool(re.fullmatch(r'post-composer-fix-[A-Za-z0-9-]{3,80}',release_name)),
      'INVALID_RELEASE_NAME')
 release=Path('/home/ubuntu/neis-frontend/releases')/release_name
 need(not release.exists() and not Path(str(release)+'.building').exists(),
      'TARGET_ALREADY_EXISTS')
 sources={name:(STAGE/name).read_text() for name in FILES}
 for name,code in sources.items():
  need(FILES[name][1] in code,'INVALID_SOURCE_'+name.upper().replace('.','_').replace('-','_'))
  run(['node','--check',str(STAGE/name)],timeout=15)
 run(COMPOSE+['config','--quiet'],timeout=40)
 container=json.loads(run(DOCKER+['inspect','supabase-caddy'],timeout=25))[0]
 mounts=[m['Source'] for m in container.get('Mounts',[])
         if m.get('Type')=='bind' and m.get('Destination')=='/srv/neis-circle']
 need(len(mounts)==1,'BIND_MISSING')
 old=Path(mounts[0])
 need(old.is_dir() and str(old).startswith('/home/ubuntu/neis-frontend/releases/'),
      'UNEXPECTED_RELEASE')
 index=(old/'index.html').read_text()
 required=[FILES[name][0] for name in FILES]
 need(all(path in index for path in required) and
      index.count('</head>')==1 and index.count('</body>')==1,
      'UNEXPECTED_LIVE_INDEX')
 overlay=OVERLAY.read_text()
 need(overlay.count(str(old))==1,'OVERLAY_CHANGED')
 count=sum(p.is_file() for p in old.rglob('*'))
 need(count>100,'LIVE_RELEASE_INCOMPLETE')
 stage='copy'
 tmp=Path(str(release)+'.building')
 shutil.copytree(old,tmp)
 for name,(path,_) in FILES.items():
  shutil.copy2(STAGE/name,tmp/path)
 need(sum(p.is_file() for p in tmp.rglob('*'))==count,'COPY_INVALID')
 for name,(path,_) in FILES.items():
  need(digest((tmp/path).read_text())==digest(sources[name]),'COPY_INVALID')
 tmp.rename(release)
 stage='deploy'
 switched=False
 try:
  OVERLAY.write_text(overlay.replace(str(old),str(release)))
  switched=True
  run(COMPOSE+['config','--quiet'],timeout=40)
  run(COMPOSE+['up','-d','--no-deps','caddy'],timeout=130)
  cid=run(COMPOSE+['ps','-q','caddy'],timeout=25).strip()
  need(bool(cid),'CADDY_DOWN')
  served=run(DOCKER+['exec',cid,'cat','/srv/neis-circle/index.html'],timeout=25)
  need(all(path in served for path in required),'ASSET_VERIFICATION_FAILED')
  for name,(path,_) in FILES.items():
   live=run(DOCKER+['exec',cid,'cat','/srv/neis-circle/'+path],timeout=25)
   need(digest(live)==digest(sources[name]),'ASSET_VERIFICATION_FAILED')
  conf=run(DOCKER+['exec',cid,'cat','/etc/caddy/Caddyfile'],timeout=25)
  need(all(x in conf for x in ('reverse_proxy rest:3000','reverse_proxy auth:9999','basic_auth')),
       'AUTH_PROXY_CHANGED')
 except Exception:
  if switched:
   OVERLAY.write_text(overlay)
   run(COMPOSE+['up','-d','--no-deps','caddy'],timeout=110,check=False)
   print('POST_COMPOSER_FIX_FRONTEND=ROLLED_BACK')
  raise
 print('POST_COMPOSER_FIX_DEPLOY=SUCCESS')
 print('POST_COMPOSER_FIX_IMAGE_EDITOR=UPDATED')
 print('POST_COMPOSER_FIX_UPLOAD_ERRORS=HANDLED')
 print('POST_COMPOSER_FIX_PUBLISH_NETWORK_ERRORS=HANDLED')
 print('POST_COMPOSER_FIX_AUTH_DB_STORAGE=UNCHANGED')

if __name__=='__main__':
 try: main()
 except Exception as error:
  known={'STAGE_MISSING','INVALID_RELEASE_NAME','TARGET_ALREADY_EXISTS',
   'INVALID_SOURCE_CONTENT_ADMIN_JS','INVALID_SOURCE_SOCIAL_JS','INVALID_SOURCE_IMAGE_EDITOR_JS',
   'BIND_MISSING','UNEXPECTED_RELEASE','UNEXPECTED_LIVE_INDEX','OVERLAY_CHANGED',
   'LIVE_RELEASE_INCOMPLETE','COPY_INVALID','CADDY_DOWN','ASSET_VERIFICATION_FAILED',
   'AUTH_PROXY_CHANGED','COMMAND_FAILED'}
  code=str(error) if str(error) in known else 'UNEXPECTED'
  print('POST_COMPOSER_FIX_DEPLOY=FAILED_'+stage.upper()+'_'+code,file=sys.stderr)
  raise SystemExit(1)
