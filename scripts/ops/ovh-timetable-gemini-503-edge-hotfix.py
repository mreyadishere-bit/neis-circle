#!/usr/bin/env python3
"""Backend-only Gemini 503 hotfix on the existing NEIS Circle OVH Edge runtime.

Reuses the previously tested immutable-release / Compose-preservation / automatic
rollback code. Does NOT touch front-end files, Caddy, existing database, API
routes, timetable drafts, RPCs, or unrelated Edge functions.

Run on OVH only after GitHub Actions verifies model metadata and regression tests.
"""
from __future__ import annotations
import argparse
import hashlib
import importlib.util
import json
import os
import sys
from pathlib import Path
import subprocess

STAGE=Path('/home/ubuntu/neis-backups/timetable-ai-gemini-20261102-v3')
SOURCE=STAGE/'index.ts'
IMPL=STAGE/'ovh-deploy-timetable-ai-gemini-v1.py'

def require(condition, message):
    if not condition:
        raise RuntimeError(message)

def load_original():
    require(IMPL.is_file() and not IMPL.is_symlink(), 'BACKEND_ONLY_DEPLOY_HELPER_MISSING')
    spec=importlib.util.spec_from_file_location('neis_gemini_immutable_deployer',IMPL)
    require(spec is not None and spec.loader is not None,'ORIGINAL_EDGE_DEPLOYER_UNAVAILABLE')
    mod=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    require(mod.STAGE==STAGE,'RELEASE_STAGING_CHANGED')
    return mod

def fingerprint(path):
    h=hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda:source.read(1024*1024),b''):
            h.update(block)
    return h.hexdigest()

def validate_candidate():
    require(STAGE.is_dir() and not STAGE.is_symlink(),'GEMINI_STAGE_UNSAFE')
    require(SOURCE.is_file() and not SOURCE.is_symlink(),'GEMINI_HOTFIX_SOURCE_MISSING')
    expected=(STAGE/'index.ts.sha256').read_text().strip()
    require(len(expected)==64 and expected==fingerprint(SOURCE),'HOTFIX_SOURCE_HASH_MISMATCH')
    source=SOURCE.read_text()
    for needle in (
       'const PRIMARY_MODEL = "gemini-3.8-flash"',
       'const OVERLOAD_FALLBACK_MODEL = "gemini-3.6-flash"',
       'responseSchema: TIMETABLE_RESPONSE_SCHEMA',
       'client.auth.getUser(jwt)',
       'inlineData:',
       'GEMINI_SERVICE_UNAVAILABLE_503',
       'validateAndNormalizeEntries(',
    ):
        require(needle in source,'HOTFIX_MISSING_INVARIANT')
    require('decodeVerifiedJwtClaims' not in source,'UNVERIFIED_AUTH_FORBIDDEN')
    require('groq' not in source.lower(),'UNEXPECTED_AI_PROVIDER')
    # The Frontend Timetable AI contract and existing save RPC are deliberately
    # not redeployed or rewritten by this hotfix.
    return source

def preflight(mod):
    validate_candidate()
    anon,gemini_key=mod.read_ovh_env()
    before=mod.read_compose_config(include_gemini=True)
    existing_mount=mod.edge_mount(before)
    require(existing_mount.get('read_only') is True,'EDGE_MOUNT_NOT_READONLY')
    existing_path=Path(existing_mount['source'])
    require((existing_path/'timetable-ai/index.ts').is_file(),'LIVE_TIMETABLE_FUNCTION_MISSING')
    require((existing_path/'main/index.ts').is_file(),'EDGE_ROUTER_MISSING')
    require((existing_path/'magnus-chat/index.ts').is_file(),'MAGNUS_FUNCTION_MISSING')
    inspect=json.loads(mod.call(mod.DOCKER+['inspect','supabase-edge-functions'],timeout=20))[0]
    mounts=[m.get('Source') for m in inspect.get('Mounts',[])
           if m.get('Destination')=='/home/deno/functions']
    require(inspect.get('State',{}).get('Running') is True,'EDGE_RUNTIME_NOT_RUNNING')
    require(mounts==[str(existing_path)],'EDGE_RUNTIME_COMPOSE_MOUNT_MISMATCH')
    # Check obvious non-target routes before changing the mounted release.
    preserved={
      'main/index.ts':fingerprint(existing_path/'main/index.ts'),
      'magnus-chat/index.ts':fingerprint(existing_path/'magnus-chat/index.ts'),
    }
    return anon,gemini_key,preserved

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--preflight',action='store_true')
    parser.add_argument('--deploy',action='store_true')
    parser.add_argument('--key-stdin',action='store_true')
    args=parser.parse_args()
    require(args.preflight != args.deploy,'SELECT_PREFLIGHT_OR_DEPLOY')
    if args.key_stdin:
        # GitHub Secrets arrives only via encrypted SSH stdin. The key is
        # never embedded in an SSH command, a URL, repository file or logs.
        key=sys.stdin.read(256).strip()
        require(len(key)>=20 and '\n' not in key,'GEMINI_KEY_STDIN_INVALID')
        os.environ['GEMINI_API_KEY']=key
    mod=load_original()
    anon,key,preserved=preflight(mod)
    if args.preflight:
        print('TIMETABLE_503_EDGE_PREFLIGHT=PASS')
        print('TIMETABLE_503_FRONTEND=UNTOUCHED')
        print('TIMETABLE_503_OTHER_FUNCTIONS=UNTOUCHED')
        return
    # This existing helper performs an immutable full Edge function tree copy,
    # compares complete Compose service config (only functions source changes),
    # recreates ONLY the functions service and rolls back on failure.
    mod.deploy_edge_function(anon,key)
    after=mod.read_compose_config(include_gemini=True)
    new_path=Path(mod.edge_mount(after)['source'])
    require(fingerprint(new_path/'timetable-ai/index.ts')==fingerprint(SOURCE),
            'DEPLOYED_TIMETABLE_FUNCTION_HASH_MISMATCH')
    for path,digest in preserved.items():
        require(fingerprint(new_path/path)==digest,'UNRELATED_FUNCTION_CHANGED_'+path)
    # The original deploy helper already checked endpoint returns 401 without
    # credentials; never send a production user's PDF or chat content here.
    print('TIMETABLE_GEMINI_503_HOTFIX=DEPLOYED_AND_VERIFIED')
    print('TIMETABLE_PRIMARY=gemini-3.8-flash')
    print('TIMETABLE_503_FALLBACK=gemini-3.6-flash')
    print('TIMETABLE_FRONTEND_DATABASE_AND_OTHER_FUNCTIONS=UNCHANGED')

if __name__=='__main__':
    main()
