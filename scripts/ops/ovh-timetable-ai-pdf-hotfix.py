#!/usr/bin/env python3
"""Additive Timetable AI PDF fix over CURRENT live OVH frontend.
No Edge/DB or other app modifications. Immutable frontend + rollback.
"""
from pathlib import Path
import subprocess,shutil,json,re,sys
ROOT=Path('/home/ubuntu/neis-supabase')
STAGE=Path('/home/ubuntu/neis-backups/timetable-ai-pdf-fix-20261102-v2')
DEST=Path('/home/ubuntu/neis-frontend/releases/timetable-ai-pdf-fix-20261102-v2')
OVERLAY=ROOT/'docker-compose.frontend-public.yml'
DOCKER=['sudo','-n','/usr/bin/docker']
FILES=['docker-compose.yml','docker-compose.security.yml','docker-compose.caddy.yml',
       'docker-compose.edge-integrations.yml','docker-compose.frontend-public.yml',
       'docker-compose.auth-public-direct.yml','docker-compose.timetable-ai.yml']
COMPOSE=DOCKER+['compose']+[x for f in FILES for x in ('-f',f)]
PHASE='preflight'
OLD_OVERLAY=''
ACTIVATED=False
def run(cmd,timeout=100):
    p=subprocess.run(cmd,cwd=ROOT,text=True,capture_output=True,timeout=timeout)
    if p.returncode:raise RuntimeError('COMMAND_FAILED')
    return p.stdout
def require(ok,error):
    if not ok:raise RuntimeError(error)
def current():
    result=json.loads(run(DOCKER+['inspect','supabase-caddy'],30))[0]
    require(result.get('State',{}).get('Running') is True,'CADDY_NOT_RUNNING')
    matches=[m.get('Source') for m in result.get('Mounts',[])
             if m.get('Type')=='bind' and m.get('Destination')=='/srv/neis-circle']
    require(len(matches)==1,'FRONTEND_MOUNT_AMBIGUOUS')
    return Path(matches[0])
def rollback():
    if not ACTIVATED:return
    try:
        OVERLAY.write_text(OLD_OVERLAY)
        run(COMPOSE+['up','-d','--no-deps','caddy'],110)
        print('TIMETABLE_AI_PDF_ROLLBACK=SUCCESS')
    except Exception:
        print('TIMETABLE_AI_PDF_ROLLBACK=MANUAL_REVIEW_REQUIRED')
def main():
    global PHASE,OLD_OVERLAY,ACTIVATED
    require(STAGE.is_dir() and (STAGE/'ui.js').is_file() and (STAGE/'ui.css').is_file(),
            'STAGE_INCOMPLETE')
    require(not DEST.exists() and not Path(str(DEST)+'.building').exists(),
            'DESTINATION_EXISTS')
    require(OVERLAY.is_file() and not OVERLAY.is_symlink() and
            all((ROOT/f).is_file() for f in FILES),'COMPOSE_INCOMPLETE')
    run(COMPOSE+['config','--quiet'],40)
    src=current()
    require(str(src).startswith('/home/ubuntu/neis-frontend/releases/') and
            (src/'index.html').is_file(),'SOURCE_RELEASE_INVALID')
    old=(src/'index.html').read_text()
    original_js=(src/'scripts/timetable-ai-v1.js').read_text()
    js=(STAGE/'ui.js').read_text()
    css=(STAGE/'ui.css').read_text()
    require('pdf.destroy()' in original_js and 'ttai-privacy' in original_js,
            'FRONTEND_NOT_EXPECTED_V1')
    require('typeof task.destroy==="function"' in js and
            'ttai-info-btn' in js and 'footer.append(compose);' in js and
            'pdf.destroy()' not in js,'PDF_FIX_INCOMPLETE')
    require('.ttai-privacy-info' in css and '.ttai-retry' in css,'CSS_FIX_INCOMPLETE')
    require('scripts/timetable-v147.js' in old and
            'timetable-export-png-v1.js' in old and
            'scripts/timetable-ai-v1.js' in old and
            'oauthlogout=20261102v1' in old,'LIVE_FEATURES_CHANGED')
    require(old.count('scripts/timetable-ai-v1.js?ttai=20261102v1')==1 and
            old.count('styles/timetable-ai-v1.css?ttai=20261102v1')==1,
            'ORIGINAL_AI_ASSET_TAGS_CHANGED')
    require('scripts/identity-v15.js?oauthlogout=20261102v1' in old,
            'AUTH_LOGOUT_PATCH_ABSENT')
    OLD_OVERLAY=OVERLAY.read_text()
    require(OLD_OVERLAY.count(str(src))==1,'RELEASE_POINTER_NOT_UNIQUE')
    require(len(list(src.rglob('*')))>120,'CURRENT_FRONTEND_TOO_SMALL')
    PHASE='build'
    temp=Path(str(DEST)+'.building')
    shutil.copytree(src,temp)
    shutil.copy2(STAGE/'ui.js',temp/'scripts/timetable-ai-v1.js')
    shutil.copy2(STAGE/'ui.css',temp/'styles/timetable-ai-v1.css')
    html=old.replace('scripts/timetable-ai-v1.js?ttai=20261102v1',
                     'scripts/timetable-ai-v1.js?ttai=20261102v2')
    html=html.replace('styles/timetable-ai-v1.css?ttai=20261102v1',
                      'styles/timetable-ai-v1.css?ttai=20261102v2')
    require(html.count('ttai=20261102v2')==2,'HTML_TAG_UPDATE_FAILED')
    (temp/'index.html').write_text(html)
    require(sum(p.is_file() for p in src.rglob('*'))==
            sum(p.is_file() for p in temp.rglob('*')),'ASSET_FILE_COUNT_CHANGED')
    # Only the AI JS/CSS and index.html may differ. Preserve session/login and other features.
    require((temp/'scripts/01-core.js').read_bytes()==(src/'scripts/01-core.js').read_bytes(),
            'AUTH_CORE_MODIFIED')
    require((temp/'scripts/identity-v15.js').read_bytes()==
            (src/'scripts/identity-v15.js').read_bytes(),'AUTH_UI_MODIFIED')
    require((temp/'scripts/timetable-v147.js').read_bytes()==
            (src/'scripts/timetable-v147.js').read_bytes(),'TIMETABLE_MODIFIED')
    run(['node','--check',str(temp/'scripts/timetable-ai-v1.js')],15)
    temp.rename(DEST)
    (STAGE/'previous-overlay.yml').write_text(OLD_OVERLAY)
    print('TIMETABLE_AI_PDF_BUILD=PASS_CURRENT_LIVE_BASE')
    PHASE='activation'
    OVERLAY.write_text(OLD_OVERLAY.replace(str(src),str(DEST)))
    ACTIVATED=True
    run(COMPOSE+['config','--quiet'],40)
    run(COMPOSE+['up','-d','--no-deps','caddy'],110)
    require(current()==DEST,'NEW_FRONTEND_NOT_MOUNTED')
    served=run(DOCKER+['exec','supabase-caddy','cat','/srv/neis-circle/index.html'],20)
    served_js=run(DOCKER+['exec','supabase-caddy','cat',
                  '/srv/neis-circle/scripts/timetable-ai-v1.js'],25)
    require('scripts/timetable-ai-v1.js?ttai=20261102v2' in served and
            'styles/timetable-ai-v1.css?ttai=20261102v2' in served and
            'oauthlogout=20261102v1' in served,'LIVE_ASSETS_NOT_UPDATED')
    require('typeof task.destroy==="function"' in served_js and
            'footer.append(compose);' in served_js and
            'pdf.destroy()' not in served_js,'LIVE_PDF_SCRIPT_INVALID')
    print('TIMETABLE_AI_PDF_FIX=SUCCESS')
    print('TIMETABLE_AI_PDF_DESTROY_ERROR=FIXED')
    print('TIMETABLE_AI_PRIVACY_FOOTER=REMOVED')
    print('TIMETABLE_AI_ERROR_RETRY=ENABLED')
    print('AUTH_CORE_TIMETABLE_AND_OTHER_FEATURES=UNCHANGED')
    print('OVH_DATABASE_AND_EDGE=UNCHANGED')
if __name__=='__main__':
    try:main()
    except Exception as e:
        reason=str(e)
        if not re.fullmatch('[A-Z_]{3,75}',reason):reason='UNEXPECTED'
        print('TIMETABLE_AI_PDF_FIX=FAILED_'+PHASE.upper()+'_'+reason,file=sys.stderr)
        rollback()
        raise SystemExit(1)
