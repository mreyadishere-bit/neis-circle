#!/usr/bin/env python3
"""Deploy OVH Backend Config Fix & Gemini 3.8 Flash Native Multimodal Timetable AI on OVH.

1. Validates staged frontend (`timetable-ai-v1.js`, `timetable-ai-v1.css`, `01-core.js`)
   and Edge Function (`timetable-ai/index.ts` with PR #453 authoritative `client.auth.getUser(jwt)`).
2. Builds an immutable OVH Edge Runtime release directory preserving `main/index.ts` and all
   existing functions, stages `timetable-ai/index.ts`, injects `GEMINI_API_KEY` into
   `docker-compose.edge-integrations.yml` (mode 0600), recreates `functions`, and verifies
   `https://supabase.neiscircle.site/functions/v1/timetable-ai` responds with 401 on unauthenticated
   POST (with automatic rollback on failure).
3. Builds an immutable OVH Frontend release from the active `/srv/neis-circle` bind mount,
   updates `scripts/timetable-ai-v1.js`, `styles/timetable-ai-v1.css`, `scripts/01-core.js`,
   ensures `index.html` uses the live OVH `ANON_KEY` from `/home/ubuntu/neis-supabase/.env`
   (removing any legacy Supabase Cloud URL or `sb_publishable_` key), updates
   `docker-compose.frontend-public.yml`, reloads Caddy, and verifies live assets
   (with automatic rollback on failure).
Never deploys a maintenance page and never logs secret values.
"""
from pathlib import Path
import base64
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.request

ROOT = Path('/home/ubuntu/neis-supabase')
ENV_FILE = ROOT / '.env'
STAGE = Path('/home/ubuntu/neis-backups/timetable-ai-gemini-20261102-v3')
EDGE_REL = Path('/home/ubuntu/neis-backups/edge-runtime-release-gemini-20261102-v3')
EDGE_OVERLAY = ROOT / 'docker-compose.edge-integrations.yml'
FRONTEND_DEST = Path('/home/ubuntu/neis-frontend/releases/timetable-ai-gemini-20261102-v3')
FRONTEND_OVERLAY = ROOT / 'docker-compose.frontend-public.yml'
DOCKER = ['sudo', '-n', '/usr/bin/docker']
COMPOSE_FILES = [
    'docker-compose.yml',
    'docker-compose.security.yml',
    'docker-compose.caddy.yml',
    'docker-compose.frontend-public.yml',
    'docker-compose.auth-public-direct.yml',
]
JS = 'scripts/timetable-ai-v1.js'
CSS = 'styles/timetable-ai-v1.css'
phase = 'preflight'


def compose_cmd(include_edge=True):
    files = list(COMPOSE_FILES)
    if include_edge and EDGE_OVERLAY.is_file():
        files.append('docker-compose.edge-integrations.yml')
    return DOCKER + ['compose'] + [s for f in files for s in ('-f', f)]


def call(args, timeout=70, check=True):
    r = subprocess.run(args, text=True, capture_output=True, cwd=ROOT, timeout=timeout)
    if check and r.returncode:
        raise RuntimeError('COMMAND_FAILED')
    return r.stdout


def ensure(ok, code):
    if not ok:
        raise RuntimeError(code)


def read_ovh_env():
    ensure(ENV_FILE.is_file(), 'OVH_ENV_MISSING')
    values = {}
    for line in ENV_FILE.read_text().splitlines():
        s = line.strip()
        if not s or s.startswith('#') or '=' not in s:
            continue
        k, _, v = s.partition('=')
        values[k.strip()] = v.strip().strip('"').strip("'")
    anon = values.get('ANON_KEY', '')
    parts = anon.split('.')
    ensure(len(parts) == 3, 'INVALID_OVH_ANON_JWT')
    payload = json.loads(base64.urlsafe_b64decode(parts[1] + '=' * (-len(parts[1]) % 4)))
    ensure(payload.get('role') == 'anon', 'INVALID_OVH_ANON_ROLE')
    gemini_key = os.environ.get('GEMINI_API_KEY', '').strip() or values.get('GEMINI_API_KEY', '').strip()
    ensure(len(gemini_key) >= 20, 'GEMINI_API_KEY_MISSING')
    return anon, gemini_key


def verify_edge_endpoint(anon_key):
    req = urllib.request.Request(
        'https://supabase.neiscircle.site/functions/v1/timetable-ai',
        data=b'{"prompt":"ping"}',
        headers={
            'Content-Type': 'application/json',
            'apikey': anon_key,
        },
        method='POST',
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            status = resp.status
    except urllib.error.HTTPError as e:
        status = e.code
    ensure(status == 401, f'EDGE_UNAUTH_STATUS_UNEXPECTED_{status}')


def deploy_edge_function(anon_key, gemini_key):
    global phase
    phase = 'edge_stage'
    edge_inspect = json.loads(call(DOCKER + ['inspect', 'supabase-edge-functions'], timeout=20))[0]
    edge_mounts = [
        m.get('Source')
        for m in edge_inspect.get('Mounts', [])
        if m.get('Destination') == '/home/deno/functions'
    ]
    ensure(len(edge_mounts) == 1, 'EDGE_FUNCTIONS_MOUNT_NOT_FOUND')
    src_functions = Path(edge_mounts[0])
    ensure((src_functions / 'main' / 'index.ts').is_file(), 'EDGE_MAIN_ROUTER_MISSING')

    if EDGE_REL.exists():
        shutil.rmtree(EDGE_REL)
    target_functions = EDGE_REL / 'functions'
    shutil.copytree(src_functions, target_functions)
    (target_functions / 'timetable-ai').mkdir(parents=True, exist_ok=True)
    shutil.copy2(STAGE / 'index.ts', target_functions / 'timetable-ai' / 'index.ts')

    prev_edge_overlay = EDGE_OVERLAY.read_text() if EDGE_OVERLAY.is_file() else None
    if prev_edge_overlay is not None:
        (STAGE / 'edge-overlay.before-timetable-ai.yml').write_text(prev_edge_overlay)

    # Preserve existing environment entries in docker-compose.edge-integrations.yml while setting GEMINI_API_KEY
    env_map = {}
    if prev_edge_overlay:
        for line in prev_edge_overlay.splitlines():
            m = re.match(r'^\s{6}([A-Z0-9_]+):\s*(.+?)\s*$', line)
            if m:
                k, val = m.group(1), m.group(2)
                try:
                    env_map[k] = json.loads(val)
                except Exception:
                    env_map[k] = val.strip('"').strip("'")
    env_map['GEMINI_API_KEY'] = gemini_key

    env_lines = '\n'.join(f'      {k}: {json.dumps(v)}' for k, v in sorted(env_map.items()))
    new_edge_overlay = (
        'services:\n'
        '  functions:\n'
        '    volumes:\n'
        f'      - {target_functions}:/home/deno/functions:ro\n'
        '    environment:\n'
        f'{env_lines}\n'
    )

    phase = 'edge_activate'
    try:
        EDGE_OVERLAY.write_text(new_edge_overlay)
        os.chmod(EDGE_OVERLAY, 0o600)
        call(compose_cmd(True) + ['config', '--quiet'], timeout=40)
        call(compose_cmd(True) + ['up', '-d', '--no-deps', '--force-recreate', 'functions'], timeout=120)
        verify_edge_endpoint(anon_key)
    except Exception:
        if prev_edge_overlay is not None:
            EDGE_OVERLAY.write_text(prev_edge_overlay)
            os.chmod(EDGE_OVERLAY, 0o600)
            call(compose_cmd(True) + ['up', '-d', '--no-deps', '--force-recreate', 'functions'], timeout=100, check=False)
            print('TIMETABLE_AI_EDGE=ROLLED_BACK')
        raise


def main():
    global phase
    ovh_anon, gemini_key = read_ovh_env()
    ensure(
        FRONTEND_OVERLAY.is_file()
        and (STAGE / 'timetable-ai-v1.js').is_file()
        and (STAGE / 'timetable-ai-v1.css').is_file()
        and (STAGE / '01-core.js').is_file()
        and (STAGE / 'index.ts').is_file(),
        'STAGING_MISSING',
    )
    js_code = (STAGE / 'timetable-ai-v1.js').read_text()
    core_code = (STAGE / '01-core.js').read_text()
    edge_code = (STAGE / 'index.ts').read_text()
    for tok in ('gemini-3.8-flash', 'application/pdf', 'timetable-ai', '__neisTimetableAiMounted'):
        ensure(tok in js_code, 'FRONTEND_CODE_INVALID')
    for tok in ('https://supabase.neiscircle.site', "flowType:'pkce'"):
        ensure(tok in core_code, 'CORE_CONFIG_INVALID')
    ensure('ydieijgynqlckaczalju' not in core_code, 'OLD_CLOUD_URL_FOUND_IN_CORE')
    for tok in ('gemini-3.8-flash', 'GEMINI_API_KEY', 'inlineData', 'responseSchema', 'client.auth.getUser(jwt)'):
        ensure(tok in edge_code, 'EDGE_CODE_INVALID')
    ensure('decodeVerifiedJwtClaims' not in edge_code, 'UNVERIFIED_JWT_DECODE_FORBIDDEN')
    ensure('groq' not in js_code.lower() and 'groq' not in edge_code.lower(), 'GROQ_REFERENCE_FOUND')

    call(['node', '--check', str(STAGE / 'timetable-ai-v1.js')], timeout=15)
    call(['node', '--check', str(STAGE / '01-core.js')], timeout=15)
    call(compose_cmd(True) + ['config', '--quiet'], timeout=40)

    # 1. Deploy and verify OVH Edge Function (`timetable-ai`)
    deploy_edge_function(ovh_anon, gemini_key)

    # 2. Deploy and verify OVH Frontend Release
    phase = 'frontend_preflight'
    mounts = [
        m.get('Source')
        for m in json.loads(call(DOCKER + ['inspect', 'supabase-caddy'], timeout=20))[0].get('Mounts', [])
        if m.get('Type') == 'bind' and m.get('Destination') == '/srv/neis-circle'
    ]
    ensure(len(mounts) == 1, 'CADDY_FRONTEND_BIND_NOT_FOUND')
    src = Path(mounts[0])
    ensure(src.is_dir() and str(src).startswith('/home/ubuntu/neis-frontend/releases/'), 'INVALID_RELEASE')

    index = (src / 'index.html').read_text()
    ensure(
        "We'll be back soon" not in index
        and index.count('</head>') == 1
        and index.count('</body>') == 1
        and 'scripts/01-core.js' in index
        and 'scripts/timetable-v147.js' in index,
        'MAINTENANCE_OR_INVALID_INDEX_BLOCKED',
    )
    original_overlay = FRONTEND_OVERLAY.read_text()
    ensure(original_overlay.count(str(src)) == 1, 'OVERLAY_BIND_CHANGED')
    if FRONTEND_DEST.exists():
        shutil.rmtree(FRONTEND_DEST)
    tmp = Path(str(FRONTEND_DEST) + '.building')
    if tmp.exists():
        shutil.rmtree(tmp)

    phase = 'frontend_copy'
    shutil.copytree(src, tmp)
    shutil.copy2(STAGE / 'timetable-ai-v1.js', tmp / JS)
    shutil.copy2(STAGE / 'timetable-ai-v1.css', tmp / CSS)
    patched_core = re.sub(
        r'supabaseAnonKey\s*:\s*"[^"]+"',
        'supabaseAnonKey:"' + ovh_anon + '"',
        core_code,
    )
    (tmp / 'scripts/01-core.js').write_text(patched_core)

    updated_index = re.sub(
        r'supabaseAnonKey\s*:\s*"[^"]+"',
        'supabaseAnonKey: "' + ovh_anon + '"',
        index,
    )
    # Remove any duplicate timetable-ai-gemini-v1 script/style references if present
    updated_index = re.sub(r'<script[^>]*timetable-ai-gemini-v1\.js[^>]*></script>\s*', '', updated_index)
    updated_index = re.sub(r'<link[^>]*timetable-ai-gemini-v1\.css[^>]*>\s*', '', updated_index)
    ensure(
        'sb_publishable_' not in updated_index
        and 'ydieijgynqlckaczalju' not in updated_index
        and 'https://supabase.neiscircle.site' in updated_index
        and 'scripts/timetable-ai-v1.js' in updated_index,
        'INDEX_CONFIG_VALIDATION_FAILED',
    )
    (tmp / 'index.html').write_text(updated_index)
    tmp.rename(FRONTEND_DEST)
    (STAGE / 'frontend-overlay.before-timetable-ai.yml').write_text(original_overlay)

    phase = 'frontend_activate'
    applied = False
    try:
        FRONTEND_OVERLAY.write_text(original_overlay.replace(str(src), str(FRONTEND_DEST)))
        applied = True
        call(compose_cmd(True) + ['config', '--quiet'], timeout=40)
        call(compose_cmd(True) + ['up', '-d', '--no-deps', 'caddy'], timeout=125)
        cid = call(compose_cmd(True) + ['ps', '-q', 'caddy'], timeout=22).strip()
        ensure(bool(cid), 'CADDY_DOWN')
        html = call(DOCKER + ['exec', cid, 'cat', '/srv/neis-circle/index.html'], timeout=22)
        ensure(
            'https://supabase.neiscircle.site' in html
            and 'sb_publishable_' not in html
            and "We'll be back soon" not in html
            and 'scripts/timetable-ai-v1.js' in html
            and 'timetable-ai-gemini-v1.js' not in html,
            'LIVE_ASSET_VERIFICATION_FAILED',
        )
    except Exception:
        if applied:
            FRONTEND_OVERLAY.write_text(original_overlay)
            call(compose_cmd(True) + ['up', '-d', '--no-deps', 'caddy'], timeout=100, check=False)
            print('TIMETABLE_AI_FRONTEND=ROLLED_BACK')
        raise

    print('OVH_BACKEND_CONFIG=FIXED_VERIFIED')
    print('TIMETABLE_AI_EDGE_DEPLOY=SUCCESS')
    print('TIMETABLE_AI_FRONTEND_DEPLOY=SUCCESS')
    print('TIMETABLE_AI_PROVIDER=GEMINI_3_8_FLASH')
    print('TIMETABLE_AI_AUTH_SECURITY=PR_453_SUPABASE_AUTH_GETUSER_ENFORCED')
    print('TIMETABLE_AI_MULTIMODAL_PDF_VISION=ENABLED')
    print('TIMETABLE_AI_SECRET_VALUES_LOGGED=NO')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('TIMETABLE_AI_DEPLOY=FAILED_' + phase.upper() + '_' + str(error), file=sys.stderr)
        raise SystemExit(1)
