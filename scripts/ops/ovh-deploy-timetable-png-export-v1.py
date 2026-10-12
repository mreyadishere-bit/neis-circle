#!/usr/bin/env python3
"""Deploy timetable PNG export additively over the actual current OVH release.

Only a local JS/CSS pair is appended to index.html. No auth, SQL, server
config, student content, PDF plugin or original timetable files are modified.
"""
from pathlib import Path
import subprocess,shutil,json,sys

ROOT=Path('/home/ubuntu/neis-supabase')
STAGE=Path('/home/ubuntu/neis-backups/timetable-png-export-20261012-v1')
DEST=Path('/home/ubuntu/neis-frontend/releases/timetable-png-export-20261012-v1')
OVERLAY=ROOT/'docker-compose.frontend-public.yml'
DOCKER=['sudo','-n','/usr/bin/docker']
COMPOSE=DOCKER+['compose']+[s for f in (
 'docker-compose.yml','docker-compose.security.yml','docker-compose.caddy.yml',
 'docker-compose.frontend-public.yml','docker-compose.auth-public-direct.yml'
) for s in ('-f',f)]
JS='scripts/timetable-export-png-v1.js'
CSS='styles/timetable-export-png-v1.css'
SCRIPT='<script defer src="'+JS+'?timetablepng=20261012v1"></script>'
STYLE='<link rel="stylesheet" href="'+CSS+'?timetablepng=20261012v1">'
phase='preflight'

def call(args,timeout=70,check=True):
 r=subprocess.run(args,text=True,capture_output=True,cwd=ROOT,timeout=timeout)
 if check and r.returncode:raise RuntimeError('COMMAND_FAILED')
 return r.stdout
def ensure(ok,code):
 if not ok:raise RuntimeError(code)

def main():
 global phase
 ensure(OVERLAY.is_file() and (STAGE/'export.js').is_file()
        and (STAGE/'export.css').is_file(),'STAGING_MISSING')
 code=(STAGE/'export.js').read_text()
 for tok in ('tt-desktop-only .tt-board','createFrame','inlineComputedStyles',
             'image/png','canvas.toBlob','MutationObserver','safeToExport'):
  ensure(tok in code,'EXPORT_CODE_INVALID')
 call(['node','--check',str(STAGE/'export.js')],timeout=15)
 call(COMPOSE+['config','--quiet'],timeout=40)
 mounts=[m.get('Source') for m in
   json.loads(call(DOCKER+['inspect','supabase-caddy'],timeout=20))[0].get('Mounts',[])
   if m.get('Type')=='bind' and m.get('Destination')=='/srv/neis-circle']
 ensure(len(mounts)==1,'CADDY_FRONTEND_BIND_NOT_FOUND')
 src=Path(mounts[0])
 ensure(src.is_dir() and str(src).startswith('/home/ubuntu/neis-frontend/releases/'),
        'INVALID_RELEASE')
 index=(src/'index.html').read_text()
 ensure(index.count('</head>')==1 and index.count('</body>')==1 and
        'scripts/timetable-v147.js' in index and
        'styles/timetable-v147.css' in index and
        'styles/desktop-hover-rail-fluid-v3.css' in index and
        'main-admin-db-storage-v1.js' in index and
        'main-admin-auth-studio-v5.js' in index and
        JS not in index and CSS not in index,
        'UNEXPECTED_CURRENT_FRONTEND')
 original=OVERLAY.read_text()
 ensure(original.count(str(src))==1,'OVERLAY_BIND_CHANGED')
 ensure(not DEST.exists() and not Path(str(DEST)+'.building').exists(),
        'DESTINATION_ALREADY_EXISTS')
 count=sum(p.is_file() for p in src.rglob('*'))
 ensure(count>100,'CURRENT_RELEASE_INCOMPLETE')
 phase='copy'
 tmp=Path(str(DEST)+'.building')
 shutil.copytree(src,tmp)
 shutil.copy2(STAGE/'export.js',tmp/JS)
 shutil.copy2(STAGE/'export.css',tmp/CSS)
 updated=index.replace('</head>',STYLE+'\n</head>').replace(
     '</body>',SCRIPT+'\n</body>')
 (tmp/'index.html').write_text(updated)
 ensure(sum(p.is_file() for p in tmp.rglob('*'))==count+2 and
        updated.count(SCRIPT)==1 and updated.count(STYLE)==1,'COPY_INVALID')
 tmp.rename(DEST)
 (STAGE/'frontend-overlay.before-png.yml').write_text(original)

 phase='activate'
 applied=False
 try:
  OVERLAY.write_text(original.replace(str(src),str(DEST)))
  applied=True
  call(COMPOSE+['config','--quiet'],timeout=40)
  call(COMPOSE+['up','-d','--no-deps','caddy'],timeout=125)
  cid=call(COMPOSE+['ps','-q','caddy'],timeout=22).strip()
  ensure(bool(cid),'CADDY_DOWN')
  html=call(DOCKER+['exec',cid,'cat','/srv/neis-circle/index.html'],timeout=22)
  code_live=call(DOCKER+['exec',cid,'cat','/srv/neis-circle/'+JS],timeout=22)
  style_live=call(DOCKER+['exec',cid,'cat','/srv/neis-circle/'+CSS],timeout=22)
  ensure(SCRIPT in html and STYLE in html and
         'styles/desktop-hover-rail-fluid-v3.css' in html and
         'main-admin-auth-studio-v5.js' in html and
         'main-admin-db-storage-v1.js' in html and
         'Timetable PNG' in code_live and
         '.tt-export-png-button' in style_live,
         'LIVE_ASSET_VERIFICATION_FAILED')
  conf=call(DOCKER+['exec',cid,'cat','/etc/caddy/Caddyfile'],timeout=25)
  ensure(all(t in conf for t in ('reverse_proxy rest:3000',
           'reverse_proxy auth:9999','basic_auth')),'CADDY_ROUTING_CHANGED')
 except Exception:
  if applied:
   OVERLAY.write_text(original)
   call(COMPOSE+['up','-d','--no-deps','caddy'],timeout=100,check=False)
   print('TIMETABLE_PNG_FRONTEND=ROLLED_BACK')
  raise
 print('TIMETABLE_PNG_DEPLOY=SUCCESS')
 print('TIMETABLE_PNG_SOURCE=EXISTING_DESKTOP_BOARD')
 print('TIMETABLE_PNG_RENDER=FULL_WEEK_DESKTOP_ON_ANY_DEVICE')
 print('TIMETABLE_PNG_FILE=LOCAL_ONLY_NO_UPLOAD')
 print('TIMETABLE_PNG_NATIVE_TIMETABLE=UNCHANGED')
 print('TIMETABLE_PNG_AUTH_AND_DB=UNCHANGED')
 print('TIMETABLE_PNG_SIDEBAR=UNCHANGED')
if __name__=='__main__':
 try:main()
 except Exception as error:
  allowed={'STAGING_MISSING','EXPORT_CODE_INVALID','CADDY_FRONTEND_BIND_NOT_FOUND',
           'INVALID_RELEASE','UNEXPECTED_CURRENT_FRONTEND','OVERLAY_BIND_CHANGED',
           'DESTINATION_ALREADY_EXISTS','CURRENT_RELEASE_INCOMPLETE','COPY_INVALID',
           'CADDY_DOWN','LIVE_ASSET_VERIFICATION_FAILED','CADDY_ROUTING_CHANGED',
           'COMMAND_FAILED'}
  label=str(error) if str(error) in allowed else 'UNEXPECTED'
  print('TIMETABLE_PNG_DEPLOY=FAILED_'+phase.upper()+'_'+label,file=sys.stderr)
  raise SystemExit(1)
