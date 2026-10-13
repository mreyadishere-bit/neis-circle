#!/usr/bin/env python3
"""Ship additive browser-only article optimization to the CURRENT live OVH release.

Patch only two exact, independently verified code fragments. All other live UI
scripts/HTML remain intact; no database, auth, storage config or user edits.
"""
from pathlib import Path
import json,subprocess,shutil,sys,re
ROOT=Path('/home/ubuntu/neis-supabase')
STAGE=Path('/home/ubuntu/neis-backups/article-image-compression-20261013-v1')
RELEASE=Path('/home/ubuntu/neis-frontend/releases/article-image-compression-20261013-v1')
OVERLAY=ROOT/'docker-compose.frontend-public.yml'
OPT='scripts/article-image-optimizer-v1.js'
DOCKER=['sudo','-n','/usr/bin/docker']
COMPOSE=DOCKER+['compose']+[s for f in (
 'docker-compose.yml','docker-compose.security.yml','docker-compose.caddy.yml',
 'docker-compose.frontend-public.yml','docker-compose.auth-public-direct.yml')
 for s in ('-f',f)]
phase='preflight'
def run(cmd,timeout=100,check=True):
 result=subprocess.run(cmd,text=True,capture_output=True,cwd=ROOT,timeout=timeout)
 if check and result.returncode:raise RuntimeError('COMMAND_FAILED')
 return result.stdout
def assert_ok(value,reason):
 if not value:raise RuntimeError(reason)
def main():
 global phase
 assert_ok(OVERLAY.is_file() and (STAGE/'optimizer.js').is_file()
   and (STAGE/'patches.json').is_file(),'STAGING_INCOMPLETE')
 optimizer=(STAGE/'optimizer.js').read_text()
 patches=json.loads((STAGE/'patches.json').read_text())
 assert_ok(all(t in optimizer for t in ('NEISImageOptimizer','prepare','image/webp',
   '7.5*MIB','MAX_SOURCE')) and len(patches)==2,'SCRIPTS_NOT_VERIFIED')
 assert_ok({p['path'] for p in patches}==
   {'scripts/articles-v27.js','scripts/06-image-editor.js'},'PATCH_PATH_INVALID')
 for patch in patches:
  assert_ok(len(patch['changes']) in (1,2) and all(
    x['old'] and x['new'] and len(x['old'])<15000 and len(x['new'])<16000
    for x in patch['changes']),'PATCH_CONTENT_INVALID')
 run(['node','--check',str(STAGE/'optimizer.js')],timeout=15)
 run(COMPOSE+['config','--quiet'],timeout=40)
 inspected=json.loads(run(DOCKER+['inspect','supabase-caddy'],timeout=18))[0]
 mounts=[m['Source'] for m in inspected.get('Mounts',[]) if
   m.get('Type')=='bind' and m.get('Destination')=='/srv/neis-circle']
 assert_ok(len(mounts)==1,'FRONTEND_MOUNT_CHANGED')
 source=Path(mounts[0])
 assert_ok(source.is_dir() and
  str(source).startswith('/home/ubuntu/neis-frontend/releases/'),'SOURCE_INVALID')
 original_html=(source/'index.html').read_text()
 assert_ok(all(k in original_html for k in ('scripts/articles-v27.js',
   'scripts/06-image-editor.js','main-admin-auth-studio-v5.js',
   'scripts/timetable-export-png-v1.js')) and
   OPT not in original_html,'UNEXPECTED_LIVE_SHELL')
 assert_ok(original_html.count('</body>')==1,'HTML_INVALID')
 original_overlay=OVERLAY.read_text()
 assert_ok(original_overlay.count(str(source))==1,'OVH_OVERLAY_CHANGED')
 assert_ok(not RELEASE.exists() and
   not Path(str(RELEASE)+'.building').exists(),'RELEASE_EXISTS')
 source_files=sum(f.is_file() for f in source.rglob('*'))
 assert_ok(source_files>100,'INCOMPLETE_SOURCE')
 # Preflight all edits against *live* source, not the possibly stale GitHub copy.
 patched={}
 for item in patches:
  path=item['path']
  content=(source/path).read_text()
  for change in item['changes']:
   assert_ok(content.count(change['old'])==1,'LIVE_SCRIPT_FRAGMENT_CHANGED')
   content=content.replace(change['old'],change['new'],1)
  patched[path]=content
 phase='stage'
 temporary=Path(str(RELEASE)+'.building')
 shutil.copytree(source,temporary)
 shutil.copy2(STAGE/'optimizer.js',temporary/OPT)
 for path,content in patched.items():
  (temporary/path).write_text(content)
  run(['node','--check',str(temporary/path)],timeout=20)
 # Force browser to download the patched editor + article script despite
 # 3600s storage cache and the user's installed PWA service worker.
 updated=original_html
 for script_path in patched:
  pattern=r'(<script\b[^>]*\bsrc=["\'])('+re.escape(script_path)+r'(?:\?[^"\']*)?)(["\'][^>]*>)'
  match=re.search(pattern,updated)
  assert_ok(bool(match),'SCRIPT_TAG_NOT_FOUND')
  oldurl=match.group(2)
  newurl=oldurl+('&' if '?' in oldurl else '?')+'largeimages=20261013v1'
  updated=updated[:match.start(2)]+newurl+updated[match.end(2):]
 updated=updated.replace('</body>',
   '<script defer src="'+OPT+'?largeimages=20261013v1"></script>\n</body>')
 (temporary/'index.html').write_text(updated)
 assert_ok(sum(f.is_file() for f in temporary.rglob('*'))==source_files+1
   and 'largeimages=20261013v1' in updated,'RELEASE_COPY_FAILED')
 temporary.rename(RELEASE)
 (STAGE/'original-overlay.yml').write_text(original_overlay)

 phase='activate'
 switched=False
 try:
  OVERLAY.write_text(original_overlay.replace(str(source),str(RELEASE)))
  switched=True
  run(COMPOSE+['config','--quiet'],timeout=40)
  run(COMPOSE+['up','-d','--no-deps','caddy'],timeout=120)
  cid=run(COMPOSE+['ps','-q','caddy'],timeout=25).strip()
  assert_ok(bool(cid),'CADDY_NOT_RUNNING')
  served=run(DOCKER+['exec',cid,'cat','/srv/neis-circle/index.html'],timeout=25)
  live=run(DOCKER+['exec',cid,'cat','/srv/neis-circle/'+OPT],timeout=25)
  a=run(DOCKER+['exec',cid,'cat','/srv/neis-circle/scripts/articles-v27.js'],timeout=25)
  e=run(DOCKER+['exec',cid,'cat','/srv/neis-circle/scripts/06-image-editor.js'],timeout=25)
  assert_ok('largeimages=20261013v1' in served and
    'NEISImageOptimizer' in live and
    'await window.NEISImageOptimizer.prepare(file)' in a and
    'record.source=optimized.file' in e and
    'scripts/timetable-export-png-v1.js' in served and
    'main-admin-auth-studio-v5.js' in served,'LIVE_ASSETS_NOT_VERIFIED')
  config=run(DOCKER+['exec',cid,'cat','/etc/caddy/Caddyfile'],timeout=25)
  assert_ok(all(v in config for v in ('reverse_proxy rest:3000',
      'reverse_proxy auth:9999','basic_auth')),'PROXY_CHANGED')
 except Exception:
  if switched:
   OVERLAY.write_text(original_overlay)
   run(COMPOSE+['up','-d','--no-deps','caddy'],timeout=100,check=False)
   print('ARTICLE_IMAGE_FRONTEND=ROLLED_BACK')
  raise
 print('ARTICLE_IMAGE_DEPLOY=SUCCESS')
 print('ARTICLE_IMAGE_LIMIT=7.5_MIB')
 print('ARTICLE_IMAGE_SOURCE=CLIENT_ONLY')
 print('ARTICLE_IMAGE_EXISTING_ARTICLES_AND_AUTH=UNCHANGED')
 print('ARTICLE_IMAGE_NEW_DOCKER_SERVICES=NONE')
if __name__=='__main__':
 try:main()
 except Exception as exc:
  allow={'STAGING_INCOMPLETE','SCRIPTS_NOT_VERIFIED','PATCH_PATH_INVALID',
    'PATCH_CONTENT_INVALID','FRONTEND_MOUNT_CHANGED','SOURCE_INVALID',
    'UNEXPECTED_LIVE_SHELL','HTML_INVALID','OVH_OVERLAY_CHANGED',
    'RELEASE_EXISTS','INCOMPLETE_SOURCE','LIVE_SCRIPT_FRAGMENT_CHANGED',
    'SCRIPT_TAG_NOT_FOUND','RELEASE_COPY_FAILED','CADDY_NOT_RUNNING',
    'LIVE_ASSETS_NOT_VERIFIED','PROXY_CHANGED','COMMAND_FAILED'}
  err=str(exc) if str(exc) in allow else 'UNEXPECTED'
  print('ARTICLE_IMAGE_DEPLOY=FAILED_'+phase.upper()+'_'+err,file=sys.stderr)
  raise SystemExit(1)
