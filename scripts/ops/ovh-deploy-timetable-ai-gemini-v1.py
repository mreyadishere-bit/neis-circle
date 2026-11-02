#!/usr/bin/env python3
"""Deploy OVH Backend Config Fix & Gemini 3.8 Flash Native Multimodal Timetable AI on OVH.

1. Validates staged frontend (`timetable-ai-v1.js`, `timetable-ai-v1.css`, `01-core.js`)
   and Edge Function (`timetable-ai/index.ts` with PR #453 authoritative `client.auth.getUser(jwt)`).
2. Builds an immutable OVH Edge Runtime release directory preserving `main/index.ts` and all
   existing functions, stages `timetable-ai/index.ts`, creates a PRIVATE additive
   Compose override and env file WITHOUT editing `docker-compose.edge-integrations.yml`,
   checks all existing services/environment/mounts are preserved, then recreates only
   `functions` and verifies
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
import copy
import base64
import json
import os
import re
import shutil
import subprocess
import sys
import uuid
import urllib.error
import urllib.request

ROOT = Path('/home/ubuntu/neis-supabase')
ENV_FILE = ROOT / '.env'
STAGE = Path('/home/ubuntu/neis-backups/timetable-ai-gemini-20261102-v3')
# Each dispatch gets an immutable, unique release. Never delete/reuse active paths.
RELEASE_ID = uuid.uuid4().hex[:16]
EDGE_REL = Path('/home/ubuntu/neis-backups/edge-runtime-release-gemini-' + RELEASE_ID)
EDGE_OVERLAY = ROOT / 'docker-compose.edge-integrations.yml'
# This deployment owns ONLY this additive override; never rewrite the shared
# Edge integrations overlay containing secrets and unrelated service settings.
GEMINI_OVERLAY = ROOT / 'docker-compose.timetable-ai-gemini.yml'
GEMINI_ENV_FILE = STAGE / ('gemini-provider-' + RELEASE_ID + '.env')
GEMINI_OVERRIDE_BACKUP = STAGE / ('gemini-override.before-' + RELEASE_ID + '.yml')
EXISTING_TIMETABLE_OVERLAY = ROOT / 'docker-compose.timetable-ai.yml'
FRONTEND_DEST = Path('/home/ubuntu/neis-frontend/releases/timetable-ai-gemini-' + RELEASE_ID)
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


def compose_cmd(include_edge=True, include_gemini=None):
    files = list(COMPOSE_FILES)
    if include_edge:
        if EDGE_OVERLAY.is_file():
            files.append('docker-compose.edge-integrations.yml')
        # An existing timetable overlay may hold the *active* Edge code mount.
        # Excluding it would silently discard active service configuration.
        if EXISTING_TIMETABLE_OVERLAY.is_file():
            files.append('docker-compose.timetable-ai.yml')
        if include_gemini is None:
            include_gemini = GEMINI_OVERLAY.is_file()
        if include_gemini:
            files.append('docker-compose.timetable-ai-gemini.yml')
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


def read_compose_config(include_gemini):
    # Parsed in-memory only: rendered Compose config contains secrets.
    # Never print the returned object or a failed command's stdout/stderr.
    rendered = call(compose_cmd(True, include_gemini) +
                    ['config', '--format', 'json'], timeout=50)
    return json.loads(rendered)


def edge_mount(config):
    entries = config['services']['functions'].get('volumes', [])
    matches = [v for v in entries if v.get('target') == '/home/deno/functions']
    ensure(len(matches) == 1, 'EDGE_MOUNT_CONFIG_AMBIGUOUS')
    return matches[0]


def verify_edge_config_preserved(before, after, old_mount_source,
                                 new_mount_source, gemini_key,
                                 previous_gemini_env_file=None):
    """Prove that ONLY Gemini env + the one Edge source mount changed."""
    before_services = copy.deepcopy(before['services'])
    after_services = copy.deepcopy(after['services'])
    ensure(before_services.keys() == after_services.keys(),
           'DOCKER_SERVICE_SET_CHANGED')
    for name in before_services:
        if name != 'functions':
            ensure(before_services[name] == after_services[name],
                   'UNRELATED_DOCKER_SERVICE_CHANGED')
    old = before_services['functions']
    new = after_services['functions']
    old_env = old.pop('environment', {}) or {}
    new_env = new.pop('environment', {}) or {}
    ensure(new_env.get('GEMINI_API_KEY') == gemini_key,
           'GEMINI_SECRET_ENV_NOT_EFFECTIVE')
    new_env.pop('GEMINI_API_KEY')
    old_env.pop('GEMINI_API_KEY', None)
    ensure(old_env == new_env, 'EDGE_OTHER_ENV_CHANGED')
    old_mounts = old.pop('volumes', []) or []
    new_mounts = new.pop('volumes', []) or []
    ensure(len(old_mounts) == len(new_mounts),
           'EDGE_OTHER_MOUNTS_CHANGED')
    for o, n in zip(old_mounts, new_mounts):
        if o.get('target') == '/home/deno/functions':
            ensure(n.get('target') == o.get('target') and
                   o.get('source') == str(old_mount_source) and
                   n.get('source') == str(new_mount_source) and
                   n.get('read_only') is True,
                   'EDGE_CODE_MOUNT_INVALID')
            old_mounts_item = dict(o)
            new_mounts_item = dict(n)
            old_mounts_item.pop('source', None)
            new_mounts_item.pop('source', None)
            ensure(old_mounts_item == new_mounts_item,
                   'EDGE_MOUNT_OPTIONS_CHANGED')
        else:
            ensure(o == n, 'EDGE_OTHER_MOUNTS_CHANGED')
    # Docker Compose may surface env_file metadata even after expanding its
    # contents. The additional private env_file is the ONLY permitted new field.
    old_files = old.pop('env_file', []) or []
    new_files = new.pop('env_file', []) or []
    allowed_env_lists = (old_files, old_files + [str(GEMINI_ENV_FILE)])
    if previous_gemini_env_file is not None:
        # Replacing the prior Gemini-owned env file is safe. Do NOT discard
        # any existing unrelated env files inherited from base Compose.
        ensure(previous_gemini_env_file in old_files,
               'PREVIOUS_GEMINI_ENV_FILE_NOT_ACTIVE')
        replacement = [str(GEMINI_ENV_FILE) if p == previous_gemini_env_file
                       else p for p in old_files]
        allowed_env_lists += (replacement,)
    ensure(new_files in allowed_env_lists, 'EDGE_ENV_FILE_LIST_CHANGED')
    ensure(old == new, 'EDGE_OTHER_CONFIGURATION_CHANGED')


def write_gemini_override_atomic(content):
    """Replace only our own Compose override; keep existing overlay intact."""
    temp = ROOT / ('docker-compose.timetable-ai-gemini.' + RELEASE_ID + '.tmp')
    fd = os.open(str(temp), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            f.write(content)
        os.replace(temp, GEMINI_OVERLAY)
    finally:
        temp.unlink(missing_ok=True)


def restore_previous_gemini_override(previous_bytes):
    """Restore the exact previously active override on preflight/activation errors."""
    if previous_bytes is None:
        GEMINI_OVERLAY.unlink(missing_ok=True)
        return
    # Preserve the exact content including whitespace. It may reference a
    # previous release's private env_file; do not delete that env_file.
    temp = ROOT / ('docker-compose.timetable-ai-gemini.rollback-' + RELEASE_ID + '.tmp')
    fd = os.open(str(temp), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, 'wb') as f:
            f.write(previous_bytes)
        os.replace(temp, GEMINI_OVERLAY)
    finally:
        temp.unlink(missing_ok=True)


def deploy_edge_function(anon_key, gemini_key):
    global phase
    phase = 'edge_stage'
    ensure(EDGE_OVERLAY.is_file() and not EDGE_OVERLAY.is_symlink(),
           'EDGE_ORIGINAL_OVERLAY_MISSING')
    ensure((EDGE_OVERLAY.stat().st_mode & 0o777) == 0o600,
           'EDGE_ORIGINAL_OVERLAY_PERMISSIONS')
    # An existing Gemini override means the previous deployment succeeded.
    # Keep it active, snapshot its bytes, and compare against its effective
    # configuration instead of rejecting normal repeat deployments.
    ensure(not GEMINI_OVERLAY.is_symlink(), 'GEMINI_OVERRIDE_SYMLINK')
    old_gemini_exists = GEMINI_OVERLAY.is_file()
    ensure(not GEMINI_OVERLAY.exists() or old_gemini_exists,
           'GEMINI_OVERRIDE_INVALID_TYPE')
    if old_gemini_exists:
        ensure((GEMINI_OVERLAY.stat().st_mode & 0o777) == 0o600,
               'GEMINI_OVERRIDE_PERMISSIONS')
    ensure(not GEMINI_ENV_FILE.exists() and not GEMINI_ENV_FILE.is_symlink(),
           'GEMINI_SECRET_FILE_ALREADY_EXISTS')
    ensure(not GEMINI_OVERRIDE_BACKUP.exists() and not GEMINI_OVERRIDE_BACKUP.is_symlink(),
           'GEMINI_BACKUP_ALREADY_EXISTS')
    ensure(not EDGE_REL.exists(), 'EDGE_RELEASE_ALREADY_EXISTS')

    edge_inspect = json.loads(call(DOCKER + ['inspect', 'supabase-edge-functions'], timeout=20))[0]
    ensure(edge_inspect.get('State', {}).get('Running') is True,
           'EDGE_SERVICE_NOT_RUNNING')
    edge_mounts = [
        m.get('Source')
        for m in edge_inspect.get('Mounts', [])
        if m.get('Destination') == '/home/deno/functions'
    ]
    ensure(len(edge_mounts) == 1, 'EDGE_FUNCTIONS_MOUNT_NOT_FOUND')
    src_functions = Path(edge_mounts[0])
    ensure((src_functions / 'main' / 'index.ts').is_file(),
           'EDGE_MAIN_ROUTER_MISSING')
    previous_overlay_bytes = EDGE_OVERLAY.read_bytes()
    previous_gemini_bytes = GEMINI_OVERLAY.read_bytes() if old_gemini_exists else None
    previous_owned_env_file = None
    if previous_gemini_bytes is not None:
        # Only replace the known minimal Gemini override created by us;
        # fail closed on unexpected edits or extra service configuration.
        original_gemini_text = previous_gemini_bytes.decode('utf-8')
        expected_prefix = 'services:\n  functions:\n    env_file:\n'
        ensure(original_gemini_text.startswith(expected_prefix) and
               original_gemini_text.count('    env_file:\n') == 1 and
               original_gemini_text.count('    volumes:\n') == 1 and
               original_gemini_text.count('services:\n') == 1,
               'PREVIOUS_GEMINI_OVERRIDE_UNRECOGNIZED')
        env_file_match = re.search(r'^      - (.+\.env)
    # An immutable, private backup lets operators restore this exact release.
    if previous_gemini_bytes is not None:
        fd = os.open(str(GEMINI_OVERRIDE_BACKUP),
                     os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'wb') as f:
            f.write(previous_gemini_bytes)
    ensure(edge_mount(previous).get('source') == str(src_functions),
           'LIVE_EDGE_MOUNT_DIFFERS_FROM_COMPOSE')

    target_functions = EDGE_REL / 'functions'
    shutil.copytree(src_functions, target_functions)
    (target_functions / 'timetable-ai').mkdir(parents=True, exist_ok=True)
    shutil.copy2(STAGE / 'index.ts', target_functions / 'timetable-ai' / 'index.ts')

    # A private 0600 env_file avoids putting the Gemini credential into
    # Git-tracked or existing shared Compose YAML files.
    secret_fd = os.open(str(GEMINI_ENV_FILE),
                        os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(secret_fd, 'w', encoding='utf-8') as f:
            f.write('GEMINI_API_KEY=' + json.dumps(gemini_key) + '\n')
    except Exception:
        GEMINI_ENV_FILE.unlink(missing_ok=True)
        raise

    # Preserve every Docker mount option, including implicit bind defaults
    # such as bind.create_host_path. Docker Compose accepts JSON flow objects
    # as valid YAML, so there is no lossy parsing or conversion.
    current_mount = copy.deepcopy(edge_mount(previous))
    ensure(current_mount.get('type') == 'bind' and
           current_mount.get('read_only') is True,
           'EDGE_CURRENT_MOUNT_UNSAFE')
    current_mount['source'] = str(target_functions)
    # Docker Compose merges services: this additive override changes only the
    # /home/deno/functions mount and adds the Gemini env_file. Do not change
    # ports, command, image, other mounts, or existing environment settings.
    override = (
        'services:\n'
        '  functions:\n'
        '    env_file:\n'
        f'      - {GEMINI_ENV_FILE}\n'
        '    volumes:\n'
        f'      - {json.dumps(current_mount, separators=(",", ":"))}\n'
    )
    # The previous override may still be referenced by the running container.
    # Atomic replacement does not disturb it until Compose explicitly recreates
    # only the Edge service. The previous bytes remain available for rollback.
    write_gemini_override_atomic(override)

    phase = 'edge_preflight'
    try:
        candidate = read_compose_config(include_gemini=True)
        verify_edge_config_preserved(previous, candidate,
                                     src_functions, target_functions, gemini_key,
                                     previous_owned_env_file)
        ensure(EDGE_OVERLAY.read_bytes() == previous_overlay_bytes,
               'EXISTING_EDGE_OVERLAY_MODIFIED')
        call(compose_cmd(True, True) + ['config', '--quiet'], timeout=40)
    except Exception:
        restore_previous_gemini_override(previous_gemini_bytes)
        GEMINI_ENV_FILE.unlink(missing_ok=True)
        raise

    phase = 'edge_activate'
    try:
        call(compose_cmd(True, True) +
             ['up', '-d', '--no-deps', '--force-recreate', 'functions'],
             timeout=120)
        verify_edge_endpoint(anon_key)
        ensure(EDGE_OVERLAY.read_bytes() == previous_overlay_bytes,
               'EXISTING_EDGE_OVERLAY_MODIFIED')
    except Exception:
        # The original overlay is untouched. Remove our new override and
        # recreate only functions from the previous, complete Compose stack.
        restore_previous_gemini_override(previous_gemini_bytes)
        GEMINI_ENV_FILE.unlink(missing_ok=True)
        call(compose_cmd(True, old_gemini_exists) +
             ['up', '-d', '--no-deps', '--force-recreate', 'functions'],
             timeout=100, check=False)
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
    # Never delete any previously published frontend release. A repeated
    # workflow dispatch receives a new RELEASE_ID instead.
    ensure(not FRONTEND_DEST.exists() and not FRONTEND_DEST.is_symlink(),
           'FRONTEND_RELEASE_COLLISION')
    tmp = Path(str(FRONTEND_DEST) + '.building')
    ensure(not tmp.exists() and not tmp.is_symlink(),
           'FRONTEND_STAGING_COLLISION')

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
    print('TIMETABLE_AI_REPEAT_DEPLOY_SAFE=YES')
    print('TIMETABLE_AI_RELEASE_ID=' + RELEASE_ID)
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
,
                                   original_gemini_text, re.MULTILINE)
        ensure(env_file_match is not None,
               'PREVIOUS_GEMINI_SECRET_FILE_UNRECOGNIZED')
        previous_owned_env_file = env_file_match.group(1)
        ensure(previous_owned_env_file.startswith(str(STAGE) + '/') and
               Path(previous_owned_env_file).name.startswith('gemini-provider'),
               'PREVIOUS_GEMINI_SECRET_FILE_UNRECOGNIZED')
    previous = read_compose_config(include_gemini=old_gemini_exists)
    # An immutable, private backup lets operators restore this exact release.
    if previous_gemini_bytes is not None:
        fd = os.open(str(GEMINI_OVERRIDE_BACKUP),
                     os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'wb') as f:
            f.write(previous_gemini_bytes)
    ensure(edge_mount(previous).get('source') == str(src_functions),
           'LIVE_EDGE_MOUNT_DIFFERS_FROM_COMPOSE')

    target_functions = EDGE_REL / 'functions'
    shutil.copytree(src_functions, target_functions)
    (target_functions / 'timetable-ai').mkdir(parents=True, exist_ok=True)
    shutil.copy2(STAGE / 'index.ts', target_functions / 'timetable-ai' / 'index.ts')

    # A private 0600 env_file avoids putting the Gemini credential into
    # Git-tracked or existing shared Compose YAML files.
    secret_fd = os.open(str(GEMINI_ENV_FILE),
                        os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(secret_fd, 'w', encoding='utf-8') as f:
            f.write('GEMINI_API_KEY=' + json.dumps(gemini_key) + '\n')
    except Exception:
        GEMINI_ENV_FILE.unlink(missing_ok=True)
        raise

    # Preserve every Docker mount option, including implicit bind defaults
    # such as bind.create_host_path. Docker Compose accepts JSON flow objects
    # as valid YAML, so there is no lossy parsing or conversion.
    current_mount = copy.deepcopy(edge_mount(previous))
    ensure(current_mount.get('type') == 'bind' and
           current_mount.get('read_only') is True,
           'EDGE_CURRENT_MOUNT_UNSAFE')
    current_mount['source'] = str(target_functions)
    # Docker Compose merges services: this additive override changes only the
    # /home/deno/functions mount and adds the Gemini env_file. Do not change
    # ports, command, image, other mounts, or existing environment settings.
    override = (
        'services:\n'
        '  functions:\n'
        '    env_file:\n'
        f'      - {GEMINI_ENV_FILE}\n'
        '    volumes:\n'
        f'      - {json.dumps(current_mount, separators=(",", ":"))}\n'
    )
    # The previous override may still be referenced by the running container.
    # Atomic replacement does not disturb it until Compose explicitly recreates
    # only the Edge service. The previous bytes remain available for rollback.
    write_gemini_override_atomic(override)

    phase = 'edge_preflight'
    try:
        candidate = read_compose_config(include_gemini=True)
        verify_edge_config_preserved(previous, candidate,
                                     src_functions, target_functions, gemini_key)
        ensure(EDGE_OVERLAY.read_bytes() == previous_overlay_bytes,
               'EXISTING_EDGE_OVERLAY_MODIFIED')
        call(compose_cmd(True, True) + ['config', '--quiet'], timeout=40)
    except Exception:
        restore_previous_gemini_override(previous_gemini_bytes)
        GEMINI_ENV_FILE.unlink(missing_ok=True)
        raise

    phase = 'edge_activate'
    try:
        call(compose_cmd(True, True) +
             ['up', '-d', '--no-deps', '--force-recreate', 'functions'],
             timeout=120)
        verify_edge_endpoint(anon_key)
        ensure(EDGE_OVERLAY.read_bytes() == previous_overlay_bytes,
               'EXISTING_EDGE_OVERLAY_MODIFIED')
    except Exception:
        # The original overlay is untouched. Remove our new override and
        # recreate only functions from the previous, complete Compose stack.
        restore_previous_gemini_override(previous_gemini_bytes)
        GEMINI_ENV_FILE.unlink(missing_ok=True)
        call(compose_cmd(True, old_gemini_exists) +
             ['up', '-d', '--no-deps', '--force-recreate', 'functions'],
             timeout=100, check=False)
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
    # Never delete any previously published frontend release. A repeated
    # workflow dispatch receives a new RELEASE_ID instead.
    ensure(not FRONTEND_DEST.exists() and not FRONTEND_DEST.is_symlink(),
           'FRONTEND_RELEASE_COLLISION')
    tmp = Path(str(FRONTEND_DEST) + '.building')
    ensure(not tmp.exists() and not tmp.is_symlink(),
           'FRONTEND_STAGING_COLLISION')

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
    print('TIMETABLE_AI_REPEAT_DEPLOY_SAFE=YES')
    print('TIMETABLE_AI_RELEASE_ID=' + RELEASE_ID)
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
