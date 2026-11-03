#!/usr/bin/env python3
"""Deploy only the localized post composer link-button fix to OVH frontend."""
import hashlib, json, os, pathlib, re, shutil, subprocess, sys

ROOT = pathlib.Path('/home/ubuntu/neis-supabase')
STAGE = pathlib.Path('/home/ubuntu/neis-backups/post-link-create-20261103')
RELEASES = pathlib.Path('/home/ubuntu/neis-frontend/releases')
OVERLAY = ROOT / 'docker-compose.frontend-public.yml'
DOCKER = ['sudo', '-n', '/usr/bin/docker']
COMPOSE = DOCKER + ['compose'] + [x for f in (
    'docker-compose.yml', 'docker-compose.security.yml', 'docker-compose.caddy.yml',
    'docker-compose.frontend-public.yml', 'docker-compose.auth-public-direct.yml'
) for x in ('-f', f)]
MARKER = '20261103-post-link-create'
ASSET = 'scripts/03-auth-i18n.js'
def require(condition, message):
    if not condition: raise RuntimeError(message)
def run(cmd, timeout=90, check=True):
    p = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, timeout=timeout)
    if check and p.returncode: raise RuntimeError('COMMAND_FAILED')
    return p.stdout
def digest(value): return hashlib.sha256(value.encode()).hexdigest()
def main():
    require(STAGE.is_dir() and OVERLAY.is_file() and RELEASES.is_dir(), 'STAGE_MISSING')
    incoming = STAGE / '03-auth-i18n.js'
    require(incoming.is_file(), 'STAGE_MISSING')
    source = incoming.read_text()
    require(all(v in source for v in (
        'id="postLinkFields"', 'id="postLinkLabel"', 'id="postLinkUrl"',
        "link_button_url&&!validPostHttpsUrl(link_button_url)",
        'link_button_label,link_button_url,youtube_url}));',
        "$('#postLinkFields')?.classList.toggle('hidden',isPoll)"
    )), 'INVALID_COMPOSER_SOURCE')
    run(['node', '--check', str(incoming)], timeout=20)
    run(COMPOSE + ['config', '--quiet'], timeout=50)
    inspection = json.loads(run(DOCKER+['inspect','supabase-caddy'],timeout=30))[0]
    mounts = [m['Source'] for m in inspection.get('Mounts',[]) if
              m.get('Type')=='bind' and m.get('Destination')=='/srv/neis-circle']
    require(len(mounts)==1,'BIND_MISSING')
    old=pathlib.Path(mounts[0])
    require(old.is_dir() and old.parent==RELEASES,'UNEXPECTED_RELEASE')
    original=OVERLAY.read_text()
    require(original.count(str(old))==1,'OVERLAY_CHANGED')
    html=(old/'index.html').read_text()
    require(html.count('scripts/03-auth-i18n.js')==1 and
            html.count('</body>')==1 and html.count('</head>')==1,'UNEXPECTED_INDEX')
    require((old/ASSET).is_file(), 'MISSING_OLD_COMPOSER')
    count=sum(x.is_file() for x in old.rglob('*'))
    require(count>100,'INCOMPLETE_RELEASE')
    revision=os.environ.get('GITHUB_SHA','')[:12]
    require(bool(re.fullmatch('[a-f0-9]{12}',revision)),'INVALID_REVISION')
    target=RELEASES / ('post-link-create-'+revision)
    temp=pathlib.Path(str(target)+'.building')
    require(not target.exists() and not temp.exists(),'RELEASE_ALREADY_EXISTS')
    # Preserve the entire current live OVH frontend. Change only composer and cache key.
    shutil.copytree(old,temp)
    shutil.copy2(incoming,temp/ASSET)
    updated,n=re.subn(r'(scripts/03-auth-i18n\.js)(?:\?[^"\s]*)?',
                       lambda m:m.group(1)+'?v='+MARKER,html,count=1)
    require(n==1,'INDEX_PATCH_FAILED')
    (temp/'index.html').write_text(updated)
    require(sum(x.is_file() for x in temp.rglob('*'))==count,'COPY_INVALID')
    require(digest((temp/ASSET).read_text())==digest(source),'COPY_INVALID')
    temp.rename(target)
    changed=False
    try:
        OVERLAY.write_text(original.replace(str(old),str(target),1));changed=True
        run(COMPOSE+['config','--quiet'],timeout=50)
        run(COMPOSE+['up','-d','--no-deps','caddy'],timeout=150)
        cid=run(COMPOSE+['ps','-q','caddy'],timeout=30).strip()
        require(bool(cid),'CADDY_DOWN')
        live_index=run(DOCKER+['exec',cid,'cat','/srv/neis-circle/index.html'],timeout=30)
        live_code=run(DOCKER+['exec',cid,'cat','/srv/neis-circle/'+ASSET],timeout=30)
        require('scripts/03-auth-i18n.js?v='+MARKER in live_index and
                digest(live_code)==digest(source),'LIVE_ASSET_MISMATCH')
        conf=run(DOCKER+['exec',cid,'cat','/etc/caddy/Caddyfile'],timeout=30)
        require(all(x in conf for x in ('reverse_proxy rest:3000','reverse_proxy auth:9999','basic_auth')),
                'AUTH_PROXY_CHANGED')
        # Verify public Caddy response on local interface without disclosing credentials.
        require('id="postLinkFields"' in live_code and
                'link_button_label,link_button_url,youtube_url}));' in live_code,
                'LIVE_COMPOSER_FAILED')
    except Exception:
        if changed:
            OVERLAY.write_text(original)
            run(COMPOSE+['up','-d','--no-deps','caddy'],timeout=120,check=False)
            print('POST_LINK_OVH=ROLLED_BACK')
        raise
    print('POST_LINK_OVH=DEPLOYED_AND_VERIFIED')
    print('FRONTEND_REVISION='+revision)
    print('DATABASE_AND_OTHER_SERVICES=UNCHANGED')

if __name__=='__main__':
    try: main()
    except Exception as error:
        print('POST_LINK_OVH=FAILED_'+str(error)[:75],file=sys.stderr)
        sys.exit(1)
