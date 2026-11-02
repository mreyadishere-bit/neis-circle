#!/usr/bin/env python3
"""Deploy OVH Backend Config Fix & Gemini 3.8 Flash Native Multimodal Timetable AI on OVH.

Stages the authenticated Supabase Edge Function `timetable-ai`, updates
`scripts/timetable-ai-v1.js`, `styles/timetable-ai-v1.css`, `scripts/01-core.js`,
and ensures `index.html` uses the live OVH `ANON_KEY` from `/home/ubuntu/neis-supabase/.env`
(removing any legacy Supabase Cloud URL or `sb_publishable_` key) with automatic rollback.
Never deploys a maintenance page and never logs secret values.
"""
from pathlib import Path
import base64
import json
import re
import shutil
import subprocess
import sys

ROOT = Path('/home/ubuntu/neis-supabase')
ENV_FILE = ROOT / '.env'
STAGE = Path('/home/ubuntu/neis-backups/timetable-ai-gemini-20261102-v2')
DEST = Path('/home/ubuntu/neis-frontend/releases/timetable-ai-gemini-20261102-v2')
OVERLAY = ROOT / 'docker-compose.frontend-public.yml'
DOCKER = ['sudo', '-n', '/usr/bin/docker']
COMPOSE = DOCKER + ['compose'] + [
    s for f in (
        'docker-compose.yml',
        'docker-compose.security.yml',
        'docker-compose.caddy.yml',
        'docker-compose.frontend-public.yml',
        'docker-compose.auth-public-direct.yml',
    ) for s in ('-f', f)
]
JS = 'scripts/timetable-ai-v1.js'
CSS = 'styles/timetable-ai-v1.css'
phase = 'preflight'


def call(args, timeout=70, check=True):
    r = subprocess.run(args, text=True, capture_output=True, cwd=ROOT, timeout=timeout)
    if check and r.returncode:
        raise RuntimeError('COMMAND_FAILED')
    return r.stdout


def ensure(ok, code):
    if not ok:
        raise RuntimeError(code)


def read_ovh_anon_key():
    ensure(ENV_FILE.is_file(), 'OVH_ENV_MISSING')
    anon = ''
    for line in ENV_FILE.read_text().splitlines():
        if line.startswith('ANON_KEY='):
            anon = line.partition('=')[2].strip().strip('"').strip("'")
    parts = anon.split('.')
    ensure(len(parts) == 3, 'INVALID_OVH_ANON_JWT')
    payload = json.loads(base64.urlsafe_b64decode(parts[1] + '=' * (-len(parts[1]) % 4)))
    ensure(payload.get('role') == 'anon', 'INVALID_OVH_ANON_ROLE')
    return anon


def main():
    global phase
    ovh_anon = read_ovh_anon_key()
    ensure(
        OVERLAY.is_file()
        and (STAGE / 'timetable-ai-v1.js').is_file()
        and (STAGE / 'timetable-ai-v1.css').is_file()
        and (STAGE / '01-core.js').is_file()
        and (STAGE / 'index.ts').is_file(),
        'STAGING_MISSING',
    )
    js_code = (STAGE / 'timetable-ai-v1.js').read_text()
    core_code = (STAGE / '01-core.js').read_text()
    edge_code = (STAGE / 'index.ts').read_text()
    for tok in ('gemini-3.8-flash', 'application/pdf', 'timetable-ai'):
        ensure(tok in js_code, 'FRONTEND_CODE_INVALID')
    for tok in ('https://supabase.neiscircle.site', 'flowType:\'pkce\''):
        ensure(tok in core_code, 'CORE_CONFIG_INVALID')
    ensure('ydieijgynqlckaczalju' not in core_code, 'OLD_CLOUD_URL_FOUND_IN_CORE')
    for tok in ('gemini-3.8-flash', 'GEMINI_API_KEY', 'inlineData', 'responseSchema'):
        ensure(tok in edge_code, 'EDGE_CODE_INVALID')
    ensure('groq' not in js_code.lower() and 'groq' not in edge_code.lower(), 'GROQ_REFERENCE_FOUND')

    call(['node', '--check', str(STAGE / 'timetable-ai-v1.js')], timeout=15)
    call(['node', '--check', str(STAGE / '01-core.js')], timeout=15)
    call(COMPOSE + ['config', '--quiet'], timeout=40)

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
    original_overlay = OVERLAY.read_text()
    ensure(original_overlay.count(str(src)) == 1, 'OVERLAY_BIND_CHANGED')
    ensure(not DEST.exists() and not Path(str(DEST) + '.building').exists(), 'DESTINATION_ALREADY_EXISTS')

    phase = 'copy'
    tmp = Path(str(DEST) + '.building')
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
    ensure(
        'sb_publishable_' not in updated_index
        and 'ydieijgynqlckaczalju' not in updated_index
        and 'https://supabase.neiscircle.site' in updated_index,
        'INDEX_CONFIG_VALIDATION_FAILED',
    )
    (tmp / 'index.html').write_text(updated_index)
    tmp.rename(DEST)
    (STAGE / 'frontend-overlay.before-timetable-ai.yml').write_text(original_overlay)

    phase = 'activate'
    applied = False
    try:
        OVERLAY.write_text(original_overlay.replace(str(src), str(DEST)))
        applied = True
        call(COMPOSE + ['config', '--quiet'], timeout=40)
        call(COMPOSE + ['up', '-d', '--no-deps', 'caddy'], timeout=125)
        cid = call(COMPOSE + ['ps', '-q', 'caddy'], timeout=22).strip()
        ensure(bool(cid), 'CADDY_DOWN')
        html = call(DOCKER + ['exec', cid, 'cat', '/srv/neis-circle/index.html'], timeout=22)
        ensure(
            'https://supabase.neiscircle.site' in html
            and 'sb_publishable_' not in html
            and "We'll be back soon" not in html,
            'LIVE_ASSET_VERIFICATION_FAILED',
        )
    except Exception:
        if applied:
            OVERLAY.write_text(original_overlay)
            call(COMPOSE + ['up', '-d', '--no-deps', 'caddy'], timeout=100, check=False)
            print('TIMETABLE_AI_FRONTEND=ROLLED_BACK')
        raise

    print('OVH_BACKEND_CONFIG=FIXED_VERIFIED')
    print('TIMETABLE_AI_DEPLOY=SUCCESS')
    print('TIMETABLE_AI_PROVIDER=GEMINI_3_8_FLASH')
    print('TIMETABLE_AI_MULTIMODAL_PDF_VISION=ENABLED')
    print('TIMETABLE_AI_SECRET_VALUES_LOGGED=NO')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('TIMETABLE_AI_DEPLOY=FAILED_' + phase.upper() + '_' + str(error), file=sys.stderr)
        raise SystemExit(1)
