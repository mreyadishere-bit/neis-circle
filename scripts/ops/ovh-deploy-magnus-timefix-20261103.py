#!/usr/bin/env python3
"""Safely repair Magnus's PostgreSQL timestamp bug and remove its welcome paragraph.
No Supabase Edge or unrelated app services are restarted.
"""
import json
import pathlib
import re
import shutil
import subprocess
import sys
import uuid

ROOT=pathlib.Path('/home/ubuntu/neis-supabase')
STAGE=pathlib.Path('/home/ubuntu/neis-backups/magnus-timefix-20261103')
FRONT_OVERLAY=ROOT/'docker-compose.frontend-public.yml'
RELEASES=pathlib.Path('/home/ubuntu/neis-frontend/releases')
REV=uuid.uuid4().hex[:12]
DOCKER=['sudo','-n','/usr/bin/docker']
COMPOSE=DOCKER+['compose']
for file in ('docker-compose.yml','docker-compose.security.yml',
             'docker-compose.caddy.yml','docker-compose.frontend-public.yml',
             'docker-compose.auth-public-direct.yml'):
    COMPOSE.extend(['-f',file])

def require(condition,code):
    if not condition:raise RuntimeError(code)

def run(command,stdin=None,timeout=90,check=True):
    p=subprocess.run(command,cwd=ROOT,input=stdin,text=True,
                     capture_output=True,timeout=timeout)
    if check and p.returncode:raise RuntimeError('COMMAND_FAILED')
    return p

def db(query):
    return run(DOCKER+['exec','-i','supabase-db','psql','-X','-v',
      'ON_ERROR_STOP=1','-U','postgres','-d','postgres','-Atq'],
      stdin=query,timeout=65)

def currently_mounted():
    result=run(DOCKER+['inspect','supabase-caddy'])
    container=json.loads(result.stdout)[0]
    require(container.get('State',{}).get('Running'), 'CADDY_NOT_RUNNING')
    mounts=[pathlib.Path(m['Source']) for m in container.get('Mounts',[])
      if m.get('Type')=='bind' and m.get('Destination')=='/srv/neis-circle']
    require(len(mounts)==1 and mounts[0].is_dir(),'FRONTEND_MOUNT_INVALID')
    return mounts[0]

def test_in_rollback(migration):
    # The old migration's final COMMIT/NOTIFY cannot run in a dry-run.
    lines=[line for line in migration.splitlines() if
      line.strip().lower() not in ('begin;','commit;')
      and not line.strip().lower().startswith('notify pgrst')]
    payload=('begin;\n'+'\n'.join(lines)+
      '\nselect set_config(\'magnus.test.user\',(select id::text from auth.users where deleted_at is null order by created_at limit 1),true);'+
      '\nselect set_config(\'request.jwt.claim.sub\',current_setting(\'magnus.test.user\'),true);'+
      '\nset local role authenticated;\nselect public.magnus_claim_turn();'+
      '\nset local role service_role;\nselect public.magnus_commit_turn('+
      'current_setting(\'magnus.test.user\')::uuid,gen_random_uuid(),'+
      '\'smoke message\',\'smoke response\',null);'+
      '\nrollback;\n')
    output=db(payload).stdout
    require('allowed' in output and 't' in output,'MAGNUS_RPC_ROLLBACK_VERIFICATION_FAILED')

def main():
    require(STAGE.is_dir() and FRONT_OVERLAY.is_file(),'MISSING_STAGING')
    sql_path=STAGE/'migration.sql'
    frontend_path=STAGE/'magnus-neis-v1.js'
    require(sql_path.is_file() and frontend_path.is_file(),'INPUT_MISSING')
    sql=sql_path.read_text()
    code=frontend_path.read_text()
    require('v_now timestamptz' in sql,'TIMESTAMP_FIX_MISSING')
    require('magnus_claim_turn' in sql,'RPC_FIX_MISSING')
    require('class="magnus-intro"' in code and 'welcome(lang)' not in code,
            'WELCOME_PARAGRAPH_STILL_PRESENT')
    run(['node','--check',str(frontend_path)],timeout=20)
    run(COMPOSE+['config','--quiet'],timeout=45)
    test_in_rollback(sql)
    print('MAGNUS_DB_FUNCTION_DRY_RUN=PASS')
    if '--dry-run' in sys.argv:
        print('MAGNUS_DEPLOY_DRY_RUN_ONLY=SUCCESS')
        return
    # Apply the database correction independently. It is safe if the UI
    # deployment fails, because this restores the existing AI path.
    db(sql)
    print('MAGNUS_DB_TIMESTAMP_FIX=APPLIED')
    test_in_rollback('-- Existing fixed function is tested below\n')
    print('MAGNUS_AUTHENTICATED_RPC=PASS')
    current=currently_mounted()
    require(current.parent==RELEASES,'UNEXPECTED_FRONTEND_RELEASE')
    original=FRONT_OVERLAY.read_text()
    require(original.count(str(current))==1,'FRONTEND_MOUNT_OUT_OF_SYNC')
    release=RELEASES/('magnus-timefix-'+REV)
    staging=pathlib.Path(str(release)+'.building')
    require(not release.exists() and not staging.exists(),'RELEASE_COLLISION')
    shutil.copytree(current,staging)
    target=staging/'scripts/magnus-neis-v1.js'
    shutil.copy2(frontend_path,target)
    run(['node','--check',str(target)],timeout=20)
    html=(staging/'index.html').read_text()
    html,count=re.subn(r'(scripts/magnus-neis-v1[.]js)(?:[?][^"\s]*)?',
        lambda m:m.group(1)+'?v=timestamp-fix-'+REV,html,count=1)
    require(count==1,'MAGNUS_SCRIPT_NOT_FOUND')
    (staging/'index.html').write_text(html)
    staging.rename(release)
    modified=False
    try:
        FRONT_OVERLAY.write_text(original.replace(str(current),str(release),1))
        modified=True
        run(COMPOSE+['config','--quiet'],timeout=45)
        run(COMPOSE+['up','-d','--no-deps','caddy'],timeout=120)
        active=currently_mounted()
        require(active==release,'NEW_FRONTEND_NOT_ACTIVE')
        index=(active/'index.html').read_text()
        require('magnus-neis-v1.js?v=timestamp-fix-'+REV in index,
                'MAGNUS_CACHE_BUSTER_MISSING')
        require('welcome(lang)' not in (active/'scripts/magnus-neis-v1.js').read_text(),
                'WELCOME_STILL_LIVE')
    except Exception:
        if modified:
            FRONT_OVERLAY.write_text(original)
            run(COMPOSE+['up','-d','--no-deps','caddy'],
                timeout=90,check=False)
        raise
    print('MAGNUS_FRONTEND=DEPLOYED')
    print('MAGNUS_HIGHLIGHTED_COPY=REMOVED')
    print('MAGNUS_RELEASE='+REV)

if __name__=='__main__':
    try:main()
    except Exception as exc:
        print('MAGNUS_TIMEFIX_DEPLOY=FAILED_'+str(exc)[:65],file=sys.stderr)
        raise SystemExit(1)
