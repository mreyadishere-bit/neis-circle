#!/usr/bin/env python3
"""Guarded additive OVH release: RTL sidebar labels, footer and scrollbar only."""
import json,shutil,subprocess,sys
from pathlib import Path
ROOT=Path('/home/ubuntu/neis-supabase')
STAGE=Path('/home/ubuntu/neis-backups/sidebar-rtl-polish-20261013-v4')
RELEASE=Path('/home/ubuntu/neis-frontend/releases/sidebar-rtl-polish-20261013-v4')
OVERLAY=ROOT/'docker-compose.frontend-public.yml'
JS='scripts/desktop-hover-rail-rtl-v4.js'
CSS='styles/desktop-hover-rail-rtl-v4.css'
JS_TAG='<script defer src="'+JS+'?sidebar=20261013v4"></script>'
CSS_TAG='<link rel="stylesheet" href="'+CSS+'?sidebar=20261013v4">'
DOCKER=['sudo','-n','/usr/bin/docker']
COMPOSE=DOCKER+['compose']+[piece for f in (
 'docker-compose.yml','docker-compose.security.yml','docker-compose.caddy.yml',
 'docker-compose.frontend-public.yml','docker-compose.auth-public-direct.yml')
 for piece in ('-f',f)]
phase='preflight'

def call(args,timeout=60,check=True):
    p=subprocess.run(args,cwd=ROOT,text=True,capture_output=True,timeout=timeout)
    if check and p.returncode:raise RuntimeError('COMMAND_FAILED')
    return p.stdout

def require(ok,code):
    if not ok:raise RuntimeError(code)

def main():
    global phase
    require(OVERLAY.exists() and (STAGE/'rtl.js').exists() and
            (STAGE/'rtl.css').exists(),'MISSING_FILES')
    js=(STAGE/'rtl.js').read_text()
    css=(STAGE/'rtl.css').read_text()
    for item in ('data-action','neis-rail-label','Connections','العلاقات',
                 'MutationObserver','aria-pressed'):
        require(item in js,'INCOMPLETE_JS')
    for item in ('@media (min-width: 1024px)','body.rtl','justify-content: flex-start',
                 'scrollbar-width: none','rail-nav'):
        require(item in css,'INCOMPLETE_CSS')
    call(['node','--check',str(STAGE/'rtl.js')],timeout=15)
    call(COMPOSE+['config','--quiet'],timeout=35)
    details=json.loads(call(DOCKER+['inspect','supabase-caddy'],timeout=20))[0]
    mounts=[m['Source'] for m in details.get('Mounts',[])
       if m.get('Type')=='bind' and m.get('Destination')=='/srv/neis-circle']
    require(len(mounts)==1,'UNEXPECTED_FRONTEND_MOUNT')
    previous=Path(mounts[0])
    require(previous.is_dir() and
            str(previous).startswith('/home/ubuntu/neis-frontend/releases/'),
            'INVALID_FRONTEND_SOURCE')
    html=(previous/'index.html').read_text()
    require(all(x in html for x in (
      'styles/desktop-hover-rail-fluid-v3.css',
      'scripts/desktop-hover-rail-v1.js',
      'scripts/timetable-export-png-v1.js',
      'main-admin-auth-studio-v5.js',
      'main-admin-db-storage-v1.js')) and
      JS not in html and CSS not in html and
      html.count('</head>')==1 and html.count('</body>')==1,
      'CURRENT_RELEASE_CHANGED')
    original=OVERLAY.read_text()
    require(original.count(str(previous))==1,'FRONTEND_BIND_CHANGED')
    require(not RELEASE.exists() and
            not Path(str(RELEASE)+'.building').exists(),'TARGET_EXISTS')
    previous_count=sum(p.is_file() for p in previous.rglob('*'))
    require(previous_count>100,'INCOMPLETE_ORIGINAL')

    phase='prepare'
    tmp=Path(str(RELEASE)+'.building')
    shutil.copytree(previous,tmp)
    shutil.copy2(STAGE/'rtl.js',tmp/JS)
    shutil.copy2(STAGE/'rtl.css',tmp/CSS)
    updated=html.replace('</head>',CSS_TAG+'\n</head>').replace(
       '</body>',JS_TAG+'\n</body>')
    (tmp/'index.html').write_text(updated)
    require(sum(p.is_file() for p in tmp.rglob('*'))==previous_count+2 and
       updated.count(CSS_TAG)==1 and updated.count(JS_TAG)==1,'BAD_RELEASE_COPY')
    tmp.rename(RELEASE)
    (STAGE/'frontend-overlay-before-rtl-v4.yml').write_text(original)

    phase='activate'
    changed=False
    try:
        OVERLAY.write_text(original.replace(str(previous),str(RELEASE)))
        changed=True
        call(COMPOSE+['config','--quiet'],timeout=35)
        call(COMPOSE+['up','-d','--no-deps','caddy'],timeout=120)
        cid=call(COMPOSE+['ps','-q','caddy'],timeout=25).strip()
        require(bool(cid),'CADDY_NOT_RUNNING')
        served=call(DOCKER+['exec',cid,'cat','/srv/neis-circle/index.html'],timeout=25)
        live_js=call(DOCKER+['exec',cid,'cat','/srv/neis-circle/'+JS],timeout=25)
        live_css=call(DOCKER+['exec',cid,'cat','/srv/neis-circle/'+CSS],timeout=25)
        require(JS_TAG in served and CSS_TAG in served and
           'scripts/timetable-export-png-v1.js' in served and
           'main-admin-auth-studio-v5.js' in served and
           'main-admin-db-storage-v1.js' in served and
           'العلاقات' in live_js and
           'justify-content: flex-start' in live_css,'LIVE_VERIFICATION_FAILED')
        caddy=call(DOCKER+['exec',cid,'cat','/etc/caddy/Caddyfile'],timeout=25)
        require(all(t in caddy for t in
          ('reverse_proxy rest:3000','reverse_proxy auth:9999','basic_auth')),
          'AUTH_PROXY_CHANGED')
    except Exception:
        if changed:
            OVERLAY.write_text(original)
            call(COMPOSE+['up','-d','--no-deps','caddy'],timeout=100,check=False)
            print('SIDEBAR_RTL_FRONTEND=ROLLED_BACK')
        raise

    print('SIDEBAR_RTL_DEPLOY=SUCCESS')
    print('SIDEBAR_RTL_LABELS=ARABIC_AND_ENGLISH')
    print('SIDEBAR_RTL_PIN=ALIGNED')
    print('SIDEBAR_RTL_DESKTOP_ONLY=YES')
    print('SIDEBAR_RTL_EXISTING_NAV_AND_PWA=UNCHANGED')
    print('SIDEBAR_RTL_AUTH_AND_DB=UNCHANGED')
if __name__=='__main__':
    try:main()
    except Exception as e:
        safe={'MISSING_FILES','INCOMPLETE_JS','INCOMPLETE_CSS',
              'UNEXPECTED_FRONTEND_MOUNT','INVALID_FRONTEND_SOURCE',
              'CURRENT_RELEASE_CHANGED','FRONTEND_BIND_CHANGED','TARGET_EXISTS',
              'INCOMPLETE_ORIGINAL','BAD_RELEASE_COPY','CADDY_NOT_RUNNING',
              'LIVE_VERIFICATION_FAILED','AUTH_PROXY_CHANGED','COMMAND_FAILED'}
        print('SIDEBAR_RTL_DEPLOY=FAILED_'+phase.upper()+'_'+
              (str(e) if str(e) in safe else 'UNEXPECTED'),file=sys.stderr)
        raise SystemExit(1)
