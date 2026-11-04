#!/usr/bin/env python3
"""Safe, isolated Timetable Gemini HTTP 503 Edge-only recovery.

Uses the SAME active Edge Compose chain as the latest Magnus runtime:
base + edge/timetable/gemini/cloudflare + Magnus (last precedence).
Verifies the actual running mount, clones it to an immutable release,
replaces ONLY timetable-ai/index.ts and switches the Magnus-owned mount.
Does not change the live website, keys, database, timetable schema or
other AI functions. Strict config parity and automatic rollback.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sys
import urllib.error
import urllib.request
import time
import uuid

STAGE=Path('/home/ubuntu/neis-backups/timetable-ai-gemini-20261102-v3')
SOURCE=STAGE/'index.ts'
HELPER=STAGE/'ovh-deploy-magnus-speed-20261103.py'
REV=uuid.uuid4().hex[:12]
OVERLAY=Path('/home/ubuntu/neis-supabase/docker-compose.magnus-neis.yml')
DEST=Path('/home/ubuntu/neis-backups/timetable-503-edge-release-'+REV)

def require(ok,code):
    if not ok:
        raise RuntimeError(code)

def digest(path):
    h=hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda:stream.read(1024*1024),b''):
            h.update(block)
    return h.hexdigest()

def load_helper():
    require(HELPER.is_file() and not HELPER.is_symlink(),'ACTIVE_EDGE_HELPER_MISSING')
    spec=importlib.util.spec_from_file_location('active_edge_runtime',HELPER)
    require(spec is not None and spec.loader is not None,'ACTIVE_EDGE_HELPER_INVALID')
    helper=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    require(helper.OVERLAY==OVERLAY,'ACTIVE_EDGE_OVERLAY_CHANGED')
    return helper

def validate():
    require(STAGE.is_dir() and not STAGE.is_symlink(),'SOURCE_STAGE_UNSAFE')
    require(SOURCE.is_file() and not SOURCE.is_symlink(),'SOURCE_MISSING')
    expected=(STAGE/'index.ts.sha256').read_text().strip()
    require(len(expected)==64 and expected==digest(SOURCE),'SOURCE_HASH_MISMATCH')
    edge=SOURCE.read_text()
    for token in (
        'const PRIMARY_MODEL = "gemini-3.8-flash"',
        'const OVERLOAD_FALLBACK_MODEL = "gemini-3.6-flash"',
        'responseSchema: TIMETABLE_RESPONSE_SCHEMA',
        'client.auth.getUser(jwt)',
        'inlineData:',
        'GEMINI_SERVICE_UNAVAILABLE_503',
        'validateAndNormalizeEntries(',
    ):
        require(token in edge,'ORIGINAL_TIMETABLE_CONTRACT_CHANGED')
    require('decodeVerifiedJwtClaims' not in edge,'AUTH_SECURITY_REGRESSION')
    require('groq' not in edge.lower(),'UNKNOWN_AI_PROVIDER')
    require(OVERLAY.is_file() and not OVERLAY.is_symlink(),'ACTIVE_MAGNUS_OVERLAY_MISSING')
    require((OVERLAY.stat().st_mode&0o777)==0o600,'OVERLAY_PERMISSIONS_UNSAFE')

def preflight(h):
    validate()
    before=h.config()
    mount=h.mount(before)
    require(mount.get('type')=='bind' and mount.get('read_only') is True,
            'ACTIVE_EDGE_MOUNT_NOT_READONLY')
    active=h.current()
    require(active==Path(mount['source']),'ACTIVE_EDGE_CONFIG_MISMATCH')
    require((active/'main/index.ts').is_file(),'MAIN_ROUTER_MISSING')
    require((active/'timetable-ai/index.ts').is_file(),'TIMETABLE_EDGE_MISSING')
    # Preserve every existing function in the active directory, without
    # hard-coding the name or location of Magnus or any other Edge function.
    other={str(f.relative_to(active)):digest(f)
           for f in active.glob('*/index.ts')
           if f.parent.name!='timetable-ai'}
    require('main/index.ts' in other,'MAIN_ROUTER_MISSING')
    require(not DEST.exists() and not Path(str(DEST)+'.building').exists(),
            'IMMUTABLE_EDGE_RELEASE_COLLISION')
    h.run(h.cmd()+['config','--quiet'],timeout=40)
    h.run(h.DOCKER+['exec','supabase-edge-functions','sh','-c',
         'test -n "$GEMINI_API_KEY"'],timeout=15)
    return before,active,other

def write_overlay_atomic(data):
    tmp=OVERLAY.with_name(OVERLAY.name+'.timetable-hotfix-'+REV)
    fd=os.open(str(tmp),os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    try:
        with os.fdopen(fd,'wb') as out:
            out.write(data)
        os.replace(tmp,OVERLAY)
    finally:
        tmp.unlink(missing_ok=True)

def verify_timetable_auth_gate():
    # A newly recreated Edge functions service may need several seconds to
    # mount and begin accepting requests. Never skip the unauthenticated
    # access check: require 401 (and fail closed on unexpected 2xx).
    req=urllib.request.Request(
       'https://supabase.neiscircle.site/functions/v1/timetable-ai',
       data=b'{"prompt":"ping"}',
       headers={'Content-Type':'application/json'},
       method='POST')
    last='unknown'
    for attempt in range(12):
        try:
            with urllib.request.urlopen(req,timeout=8) as response:
                last=response.status
        except urllib.error.HTTPError as error:
            last=error.code
        except (urllib.error.URLError,TimeoutError,OSError) as error:
            last=type(error).__name__
        if last==401:
            print('TIMETABLE_EDGE_AUTH_GATE=401_VERIFIED')
            return
        if isinstance(last,int) and 200<=last<300:
            raise RuntimeError('TIMETABLE_EDGE_AUTH_GATE_UNEXPECTED_PUBLIC_ACCESS')
        if attempt<11:
            time.sleep(2)
    raise RuntimeError('TIMETABLE_EDGE_AUTH_GATE_NOT_READY_LAST_STATUS_'+str(last))

def deploy(h,before,active,other):
    old_overlay=OVERLAY.read_bytes()
    tmp=Path(str(DEST)+'.building')
    # Copy only from the actual live Edge mount; never assemble functions
    # from an outdated GitHub snapshot that might remove newer AI routes.
    shutil.copytree(active,tmp)
    shutil.copy2(SOURCE,tmp/'timetable-ai/index.ts')
    tmp.rename(DEST)
    for path,hash_before in other.items():
        require(digest(DEST/path)==hash_before,'UNRELATED_EDGE_FUNCTION_CHANGED')
    require(digest(DEST/'timetable-ai/index.ts')==digest(SOURCE),
            'TIMETABLE_SOURCE_NOT_COPIED')

    updated=copy.deepcopy(h.mount(before))
    updated['source']=str(DEST)
    new_overlay=(
        'services:\n'
        '  functions:\n'
        '    volumes:\n'
        '      - '+json.dumps(updated,separators=(',',':'))+'\n'
    ).encode('utf-8')
    changed=False
    try:
        write_overlay_atomic(new_overlay)
        changed=True
        candidate=h.config()
        h.assert_parity(before,candidate)
        require(Path(h.mount(candidate)['source'])==DEST,'WRONG_EDGE_MOUNT')
        h.run(h.cmd()+['config','--quiet'],timeout=40)
        h.run(h.cmd()+['up','-d','--no-deps','--force-recreate','functions'],timeout=125)
        require(h.current()==DEST,'EDGE_ACTIVATION_MOUNT_MISMATCH')
        verify_timetable_auth_gate()
        h.verify_route()  # Magnus OPTIONS + unauthenticated POST must still work.
        for path,hash_before in other.items():
            require(digest(DEST/path)==hash_before,'POST_DEPLOY_FUNCTION_CHANGED')
    except Exception:
        if changed:
            write_overlay_atomic(old_overlay)
            try:
                h.run(h.cmd()+['up','-d','--no-deps','--force-recreate','functions'],
                      timeout=115,check=False)
            except Exception:
                pass
            print('TIMETABLE_503_EDGE=ROLLBACK_ATTEMPTED')
        raise

def main():
    parser=argparse.ArgumentParser()
    mode=parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--preflight',action='store_true')
    mode.add_argument('--deploy',action='store_true')
    args=parser.parse_args()
    h=load_helper()
    before,active,other=preflight(h)
    if args.preflight:
        print('TIMETABLE_503_EDGE_PREFLIGHT=PASS')
        print('TIMETABLE_ACTIVE_COMPOSE=VERIFIED_WITH_MAGNUS')
        print('TIMETABLE_FRONTEND_DATABASE=UNCHANGED')
        return
    deploy(h,before,active,other)
    print('TIMETABLE_GEMINI_503_HOTFIX=DEPLOYED_AND_VERIFIED')
    print('TIMETABLE_PRIMARY=gemini-3.8-flash')
    print('TIMETABLE_503_FALLBACK=gemini-3.6-flash')
    print('TIMETABLE_OTHER_EDGE_FUNCTIONS=UNCHANGED')
    print('TIMETABLE_FRONTEND_DATABASE=UNCHANGED')

if __name__=='__main__':
    try:
        main()
    except Exception as exc:
        print('TIMETABLE_503_EDGE_HOTFIX_FAILED='+str(exc),file=sys.stderr)
        raise SystemExit(1)
