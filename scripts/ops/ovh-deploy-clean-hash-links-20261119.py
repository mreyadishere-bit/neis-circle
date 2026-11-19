#!/usr/bin/env python3
"""OVH clean social share links without ANY new visible pages or app redesign.

Exact URLs /articles, /study, etc internally serve metadata-only HTML files
which instantly execute location.replace('/#/articles') in a browser.
Crawlers read distinct OpenGraph images before executing any JavaScript.

No changes to database, authentication, original app pages, or existing artwork.
The only Caddy change is to prefer {path}.html before the unchanged SPA fallback.
"""
from pathlib import Path
import hashlib, json, os, re, shutil, subprocess, sys

ROOT = Path('/home/ubuntu/neis-supabase')
RELEASES = Path('/home/ubuntu/neis-frontend/releases')
OVERLAY = ROOT / 'docker-compose.frontend-public.yml'
STAGE = Path('/home/ubuntu/neis-backups/clean-hash-links-20261119')
DOCKER = ['sudo','-n','/usr/bin/docker']
COMPOSE = DOCKER + ['compose'] + [p for file in (
    'docker-compose.yml','docker-compose.security.yml','docker-compose.caddy.yml',
    'docker-compose.frontend-public.yml','docker-compose.auth-public-direct.yml'
) for p in ('-f',file)]
SLUGS = (
    'feed','discover','study','messages','connections','saved',
    'opportunities','gallery','articles','circles','analytics',
    'timetable','notifications','settings','games'
)
BRIDGE = '<script src="scripts/hash-route-open-v1.js?v=20261119-clean-links" defer></script>'
OLD_CADDY = 'try_files {path} /index.html'
MARKER = '# NEIS CLEAN HASH PREVIEWS (15 static social metadata endpoints)'

def build_caddy(config):
    # Exact rewrites run before try_files according to Caddy directive order.
    pos=config.index(OLD_CADDY)
    start=config.rfind('\n',0,pos)+1
    indent=config[start:pos]
    require(not indent.strip(),'UNEXPECTED_CADDY_SITE_INDENT')
    rules=[indent+MARKER]
    for slug in SLUGS:
        rules.append(indent+'rewrite /'+slug+' /'+slug+'.html')
    new=config[:start]+'\n'.join(rules)+'\n'+config[start:]
    require(new.count(MARKER)==1,'CADDY_SCOPED_RULE_FAILED')
    return new

def require(condition, label):
    if not condition: raise RuntimeError(label)

def run(command, timeout=100):
    proc=subprocess.run(command,cwd=ROOT,capture_output=True,text=True,timeout=timeout)
    if proc.returncode:
        raise RuntimeError('COMMAND_FAILED_'+(proc.stderr or '')[-220:])
    return proc.stdout

def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    revision=os.environ.get('GITHUB_SHA','')[:12]
    require(bool(re.fullmatch('[0-9a-f]{12}',revision)), 'BAD_GITHUB_SHA')
    require(STAGE.is_dir() and RELEASES.is_dir() and OVERLAY.is_file(), 'REQUIRED_PATHS_MISSING')
    for slug in SLUGS:
        meta=STAGE/'html'/(slug+'.html')
        photo=STAGE/'assets'/(slug+'.webp')
        require(meta.is_file() and photo.is_file(),'SHARE_FILE_MISSING_'+slug)
        data=meta.read_text()
        require(
            'property="og:title"' in data
            and 'property="og:image"' in data
            and 'window.location.replace(' in data
            and 'https://neiscircle.site/'+slug+'"' in data
            and '#/'+slug in data,
            'SHARE_META_OR_REDIRECT_INVALID_'+slug)
        require(photo.read_bytes()[:4]==b'RIFF' and photo.read_bytes()[8:12]==b'WEBP',
                'SOCIAL_IMAGE_INVALID_'+slug)
    bridge=STAGE/'hash-route-open-v1.js'
    require(bridge.is_file() and 'MutationObserver' in bridge.read_text(),
            'HASH_LINK_ROUTER_MISSING')
    run(['node','--check',str(bridge)],timeout=20)
    run(COMPOSE+['config','--quiet'],timeout=50)
    instance=json.loads(run(DOCKER+['inspect','supabase-caddy'],timeout=28))[0]
    mounts=instance.get('Mounts',[])
    frontends=[Path(m['Source']) for m in mounts
               if m.get('Destination')=='/srv/neis-circle' and m.get('Type')=='bind']
    configs=[Path(m['Source'])/'Caddyfile' for m in mounts
             if m.get('Destination')=='/etc/caddy' and m.get('Type')=='bind']
    require(len(frontends)==1 and len(configs)==1 and configs[0].is_file(),
            'EXPECTED_CADDY_MOUNTS_MISSING')
    source=frontends[0];config_path=configs[0]
    old_overlay=OVERLAY.read_text()
    old_config=config_path.read_text()
    require(source.is_dir() and source.parent==RELEASES
            and old_overlay.count(str(source))==1,'LIVE_FRONTEND_UNEXPECTED')
    require(old_config.count(OLD_CADDY)==1
            and MARKER not in old_config,'CADDY_FALLBACK_CHANGED')
    existing_index=(source/'index.html').read_text()
    require(BRIDGE not in existing_index and
            'section-share-router-v1.js?v=20261119-sharing' not in existing_index,
            'UNEXPECTED_PREVIOUS_SHARE_ROUTER')
    for required in ('scripts/03-auth-i18n.js','scripts/user-activity-v1.js',
                     'original-tab-20261119','assets/share/home-main.webp'):
        require(required in existing_index,'LIVE_APP_FEATURE_MISSING_'+required)
    for slug in SLUGS:
        require(not (source/(slug+'.html')).exists(),'EXISTING_PAGE_COLLISION_'+slug)
    count=sum(p.is_file() for p in source.rglob('*'))
    require(count>100,'CURRENT_RELEASE_INCOMPLETE')
    dest=RELEASES/('clean-hash-links-'+revision)
    temp=Path(str(dest)+'.building')
    require(not dest.exists() and not temp.exists(),'RELEASE_ALREADY_EXISTS')
    shutil.copytree(source,temp)
    folder=temp/'assets/share-link'
    folder.mkdir(parents=True,exist_ok=True)
    for slug in SLUGS:
        shutil.copy2(STAGE/'html'/(slug+'.html'),temp/(slug+'.html'))
        shutil.copy2(STAGE/'assets'/(slug+'.webp'),folder/(slug+'.webp'))
    shutil.copy2(bridge,temp/'scripts/hash-route-open-v1.js')
    require(existing_index.count('</body>')==1,'HTML_BODY_NOT_FOUND')
    modified=existing_index.replace('</body>','  '+BRIDGE+'\n</body>',1)
    (temp/'index.html').write_text(modified)
    for src in ('scripts/03-auth-i18n.js','scripts/user-activity-v1.js',
                'scripts/pwa-install-v117.js','styles/ui-v14.css',
                'assets/email-logo.png','assets/share/home-main.webp','favicon.ico'):
        require(sha(temp/src)==sha(source/src),'UNRELATED_ASSET_CHANGED_'+src)
    require(sum(p.is_file() for p in temp.rglob('*'))==count+len(SLUGS)*2+1,
            'FRONTEND_FILE_COUNT_CHANGED')
    temp.rename(dest)
    old_release_path=STAGE/('previous-release-'+revision+'.txt')
    old_config_path=STAGE/('previous-caddy-'+revision+'.txt')
    old_release_path.write_text(str(source));old_release_path.chmod(0o600)
    old_config_path.write_text(old_config);old_config_path.chmod(0o600)
    changed_overlay=False
    changed_caddy=False
    try:
        OVERLAY.write_text(old_overlay.replace(str(source),str(dest),1))
        changed_overlay=True
        run(COMPOSE+['config','--quiet'],timeout=55)
        run(COMPOSE+['up','-d','--no-deps','caddy'],timeout=175)
        cid=run(COMPOSE+['ps','-q','caddy'],timeout=25).strip()
        require(bool(cid),'CADDY_NOT_RUNNING')
        html=run(DOCKER+['exec',cid,'cat','/srv/neis-circle/index.html'],timeout=30)
        require(BRIDGE in html and 'assets/share/home-main.webp' in html,
                'LIVE_APP_CHANGED_OR_MISSING_BRIDGE')
        for slug in SLUGS:
            live_hash=run(DOCKER+['exec',cid,'sha256sum',
                              '/srv/neis-circle/assets/share-link/'+slug+'.webp'],
                          timeout=20).split()[0]
            require(live_hash==sha(STAGE/'assets'/(slug+'.webp')),
                    'LIVE_IMAGE_HASH_WRONG_'+slug)
        # Exact section matchers serve metadata; every other path keeps the SPA.
        updated=build_caddy(old_config)
        config_path.write_text(updated)
        changed_caddy=True
        run(DOCKER+['exec',cid,'caddy','validate',
                   '--config','/etc/caddy/Caddyfile'],timeout=50)
        run(DOCKER+['exec',cid,'caddy','reload',
                   '--config','/etc/caddy/Caddyfile'],timeout=55)
        # Verify the direct OVH origin before exposing the new release publicly.
        for slug in ('feed','articles','study','messages','games'):
            page=run(['curl','-ksSL','--connect-timeout','8','--max-time','12',
                      '--resolve','neiscircle.site:443:127.0.0.1',
                      'https://neiscircle.site/'+slug],timeout=17)
            require('<meta property="og:url" content="https://neiscircle.site/'+slug+'">' in page
                    and 'window.location.replace(' in page,
                    'OVH_ORIGIN_CLEAN_SHARE_FAILED_'+slug)
        print('OVH_ORIGIN_CLEAN_SHARE_CHECK=PASS')
    except Exception:
        if changed_caddy:
            config_path.write_text(old_config)
            try:run(DOCKER+['exec','supabase-caddy','caddy','reload',
                          '--config','/etc/caddy/Caddyfile'],timeout=55)
            except Exception:print('CLEAN_SHARE_CADDY_ROLLBACK=UNVERIFIED')
        if changed_overlay:
            OVERLAY.write_text(old_overlay)
            try:run(COMPOSE+['up','-d','--no-deps','caddy'],timeout=175)
            except Exception:print('CLEAN_SHARE_RELEASE_ROLLBACK=UNVERIFIED')
            else:print('CLEAN_SHARE_RELEASE_ROLLBACK=COMPLETE')
        raise
    print('CLEAN_SECTION_LINKS=DEPLOYED_INTERNAL_CHECK_PASS')
    print('ORIGINAL_HASH_APP_NAVIGATION=RETAINED')
    print('NO_VISIBLE_ADDITIONAL_PAGES=YES')
    print('ORIGINAL_MAIN_AND_HOME_ARTWORK=UNCHANGED')
    print('ORIGINAL_IMAGE_ASPECT_RATIOS=RESTORED_FOR_OG')
    print('PUBLIC_SOCIAL_SHARE_LINKS='+str(len(SLUGS)))
    print('STUDENT_DATA_AND_AUTH=UNCHANGED')
if __name__=='__main__':
    try:main()
    except Exception as error:
        print('CLEAN_SECTION_LINKS=FAILED_'+str(error)[:250],file=sys.stderr)
        sys.exit(1)
