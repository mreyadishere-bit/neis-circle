#!/usr/bin/env python3
"""Apply a bounded frontend patch to an immutable copy of the current OVH release."""
from pathlib import Path
import hashlib, json, re, shutil, subprocess, sys
ROOT = Path('/home/ubuntu/neis-supabase')
STAGE = Path('/home/ubuntu/neis-backups/startup-notification-20261023-v2')
RELEASE = Path('/home/ubuntu/neis-frontend/releases/startup-notification-20261023-v2')
OVERLAY = ROOT / 'docker-compose.frontend-public.yml'
FILES = ['scripts/02-content-admin.js', 'scripts/05-social.js',
         'scripts/featured-articles-v160.js', 'scripts/runtime-core-v166.js',
         'scripts/secondary-data-v173.js', 'scripts/social/notifications-v174.js']
DOCKER = ['sudo', '-n', '/usr/bin/docker']
COMPOSE = DOCKER + ['compose'] + [part for name in (
    'docker-compose.yml', 'docker-compose.security.yml', 'docker-compose.caddy.yml',
    'docker-compose.frontend-public.yml', 'docker-compose.auth-public-direct.yml')
    for part in ('-f', name)]
MARKER = 'startup=20261023v2'

def digest(data):
    return hashlib.sha256(data).hexdigest()

def need(ok, message):
    if not ok:
        raise RuntimeError(message)

def run(args, cwd=ROOT, timeout=90):
    result = subprocess.run(args, cwd=cwd, capture_output=True, timeout=timeout)
    need(result.returncode == 0, 'command failed: ' + args[0])
    return result.stdout

def bust(html):
    for path in FILES:
        pattern = r'(<script\b[^>]*\bsrc=["\'])' + re.escape(path) + r'([^"\']*)(["\'])'
        html, count = re.subn(pattern, lambda m: m[1] + path + m[2] +
                             ('&' if '?' in m[2] else '?') + MARKER + m[3], html)
        need(count == 1, 'script reference mismatch: ' + path)
    return html

def rollback():
    backup = STAGE / 'overlay.before.yml'
    need(backup.is_file(), 'rollback backup missing')
    if str(RELEASE) not in OVERLAY.read_text():
        print('ROLLBACK=SKIPPED_RELEASE_NOT_CURRENT')
        return
    OVERLAY.write_text(backup.read_text())
    run(COMPOSE + ['up', '-d', '--no-deps', 'caddy'], timeout=150)
    print('STARTUP_NOTIFICATION_DEPLOY=ROLLED_BACK')


def main():
    patch = STAGE / 'startup.patch'
    need(patch.is_file() and OVERLAY.is_file(), 'staging files missing')
    paths = re.findall(r'^\+\+\+ b/(.+)$', patch.read_text(), re.M)
    need(set(paths) == set(FILES) and len(paths) == len(FILES), 'patch scope mismatch')
    run(COMPOSE + ['config', '--quiet'])
    container = json.loads(run(DOCKER + ['inspect', 'supabase-caddy']))[0]
    mounts = [m['Source'] for m in container['Mounts']
              if m.get('Type') == 'bind' and m.get('Destination') == '/srv/neis-circle']
    need(len(mounts) == 1, 'live mount missing')
    old = Path(mounts[0])
    need(old.is_dir() and old.parent == RELEASE.parent, 'unexpected live release')
    overlay = OVERLAY.read_text()
    need(overlay.count(str(old)) == 1, 'overlay mount mismatch')
    need(not RELEASE.exists(), 'target already exists')
    tmp = Path(str(RELEASE) + '.building')
    need(not tmp.exists(), 'staging directory already exists')
    index = (old / 'index.html').read_text()
    need('scripts/01-core.js' in index and 'Maintenance ·' not in index, 'not an app shell')
    auth_before = (old / 'scripts/01-core.js').read_bytes()
    need(b'https://supabase.neiscircle.site' in auth_before, 'unexpected backend config')
    conf_before = run(DOCKER + ['exec', 'supabase-caddy', 'cat', '/etc/caddy/Caddyfile'])
    before = {str(p.relative_to(old)): digest(p.read_bytes()) for p in old.rglob('*') if p.is_file()}
    need(len(before) > 100, 'incomplete current release')
    shutil.copytree(old, tmp)
    run(['git', 'apply', '--check', str(patch)], cwd=tmp)
    run(['git', 'apply', str(patch)], cwd=tmp)
    for path in FILES:
        run(['node', '--check', str(tmp / path)])
    (tmp / 'index.html').write_text(bust(index))
    allowed = set(FILES) | {'index.html'}
    if (tmp / '404.html').is_file() and 'scripts/01-core.js' in (tmp / '404.html').read_text():
        (tmp / '404.html').write_text(bust((tmp / '404.html').read_text()))
        allowed.add('404.html')
    after = {str(p.relative_to(tmp)): digest(p.read_bytes()) for p in tmp.rglob('*') if p.is_file()}
    need(before.keys() == after.keys(), 'release file inventory changed')
    need(all(before[p] == after[p] for p in before if p not in allowed), 'unrelated asset changed')
    need((tmp / 'scripts/01-core.js').read_bytes() == auth_before, 'auth config changed')
    tmp.rename(RELEASE)
    (STAGE / 'overlay.before.yml').write_text(overlay)
    (STAGE / 'release.json').write_text(json.dumps({'previous': str(old), 'release': str(RELEASE),
                                                  'changed': sorted(allowed), 'sha256': after}))
    try:
        need(OVERLAY.read_text() == overlay, 'concurrent deployment detected')
        OVERLAY.write_text(overlay.replace(str(old), str(RELEASE)))
        run(COMPOSE + ['config', '--quiet'])
        run(COMPOSE + ['up', '-d', '--no-deps', 'caddy'], timeout=150)
        conf_after = run(DOCKER + ['exec', 'supabase-caddy', 'cat', '/etc/caddy/Caddyfile'])
        need(conf_after == conf_before, 'gateway configuration changed')
        served = run(DOCKER + ['exec', 'supabase-caddy', 'cat', '/srv/neis-circle/index.html'])
        need(served == (RELEASE / 'index.html').read_bytes(), 'mounted index mismatch')
        print('STARTUP_NOTIFICATION_ACTIVATION=SUCCESS')
        print('PATCHED_FILES=6; AUTH_CONFIG=UNCHANGED; PUBLIC_VERIFICATION=REQUIRED')
        print('ROLLBACK_RELEASE=' + str(old))
    except Exception:
        # Do not overwrite a release selected by another deployer.
        if str(RELEASE) in OVERLAY.read_text():
            OVERLAY.write_text(overlay)
            run(COMPOSE + ['up', '-d', '--no-deps', 'caddy'], timeout=150)
            print('STARTUP_NOTIFICATION_DEPLOY=ROLLED_BACK')
        raise

if __name__ == '__main__':
    try:
        rollback() if '--rollback' in sys.argv else main()
    except Exception as error:
        print('STARTUP_NOTIFICATION_DEPLOY=FAILED: ' + str(error), file=sys.stderr)
        raise SystemExit(1)
