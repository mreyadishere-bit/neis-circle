#!/usr/bin/env python3
"""Install external game connector assets on live OVH Caddy, with rollback."""
import hashlib,json,os,pathlib,re,shutil,subprocess,sys
ROOT=pathlib.Path('/home/ubuntu/neis-supabase')
STAGE=pathlib.Path('/home/ubuntu/neis-backups/neis-connectors-v1-stage')
RELEASES=pathlib.Path('/home/ubuntu/neis-frontend/releases')
OVERLAY=ROOT/'docker-compose.frontend-public.yml'
DOCKER=['sudo','-n','/usr/bin/docker']
FILES={'neis-game-connectors-v1.js':'scripts/neis-game-connectors-v1.js',
       'featured-articles-v160.js':'scripts/featured-articles-v160.js',
       'neis-game-connectors-v1.css':'styles/neis-game-connectors-v1.css',
       'navigation-v14.js':'scripts/navigation-v14.js',
       'ui-v14.css':'styles/ui-v14.css',
       '05-social.js':'scripts/05-social.js',
       'magnus-neis-v1.js':'scripts/magnus-neis-v1.js',
       'timetable-ai-v1.js':'scripts/timetable-ai-v1.js'}
COMPOSE=DOCKER+['compose']+[x for f in ('docker-compose.yml','docker-compose.security.yml',
 'docker-compose.caddy.yml','docker-compose.frontend-public.yml','docker-compose.auth-public-direct.yml')
 for x in ('-f',f)]
def check(cond,msg):
 if not cond:raise RuntimeError(msg)
def call(args,timeout=110,required=True):
 p=subprocess.run(args,cwd=ROOT,text=True,capture_output=True,timeout=timeout)
 if p.returncode and required:raise RuntimeError('COMMAND_FAILED_'+str(p.returncode)+':'+p.stderr[-130:])
 return p.stdout
def checksum(x):return hashlib.sha256(x.encode()).hexdigest()
def active():
 info=json.loads(call(DOCKER+['inspect','supabase-caddy'],timeout=25))[0]
 check(info.get('State',{}).get('Running'),'CADDY_NOT_RUNNING')
 mounts=[pathlib.Path(m['Source']) for m in info.get('Mounts',[])
         if m.get('Type')=='bind' and m.get('Destination')=='/srv/neis-circle']
 check(len(mounts)==1 and mounts[0].is_dir(),'CADDY_BIND_UNEXPECTED')
 return mounts[0]
def main():
 check(STAGE.is_dir() and OVERLAY.is_file() and RELEASES.is_dir(),'RELEASE_PREREQUISITE_MISSING')
 js=(STAGE/'neis-game-connectors-v1.js').read_text()
 css=(STAGE/'neis-game-connectors-v1.css').read_text()
 check('window.NEISPlayConnectors' in js and 'start_direct_conversation' in js and 'circle_messages' in js,'CONNECTOR_FUNCTIONS_MISSING')
 check('.neis-connect-dialog' in css and '@media(max-width:560px)' in css,'RESPONSIVE_CSS_MISSING')
 featured=(STAGE/'featured-articles-v160.js').read_text()
 check('state.articles=[];' in featured and 'return baseHome();' in featured and
       'set_article_featured' in featured and 'data-article-feature-filter' in featured,
       'HOME_ONLY_ARTICLE_SHOWCASE_REMOVAL_NOT_VERIFIED')
 check('neis-mobile-game-entry' in (STAGE/'navigation-v14.js').read_text(),'MOBILE_GAME_ENTRY_MISSING')
 check('list.scrollTop=0' in (STAGE/'navigation-v14.js').read_text(),'MOBILE_NAV_SCROLL_FIX_MISSING')
 check('overflow-anchor:none' in (STAGE/'ui-v14.css').read_text(),'MOBILE_NAV_CSS_FIX_MISSING')
 chat_js=(STAGE/'05-social.js').read_text()
 magnus_js=(STAGE/'magnus-neis-v1.js').read_text()
 timetable_js=(STAGE/'timetable-ai-v1.js').read_text()
 check('dismissSoftKeyboardOnSend()' in chat_js and 'if(dismissSoftKeyboardOnSend())input.blur()' in chat_js,'CHAT_KEYBOARD_FIX_MISSING')
 check('if(mobileSend())input.blur()' in magnus_js,'MAGNUS_KEYBOARD_FIX_MISSING')
 check('input.blur()' in timetable_js,'TIMETABLE_KEYBOARD_FIX_MISSING')
 for filename in ('neis-game-connectors-v1.js','featured-articles-v160.js','navigation-v14.js','05-social.js','magnus-neis-v1.js','timetable-ai-v1.js'):
  call(['node','--check',str(STAGE/filename)],timeout=35)
 call(COMPOSE+['config','--quiet'],timeout=45)
 previous=active();check(previous.parent==RELEASES,'FRONTEND_RELEASE_NOT_PINNED')
 original_overlay=OVERLAY.read_text()
 check(original_overlay.count(str(previous))==1,'FRONTEND_OVERLAY_CHANGED')
 html=(previous/'index.html').read_text()
 check('scripts/data-coordinator-v171.js' in html and 'scripts/05-social.js' in html,'APP_RUNTIME_MISSING')
 old_scripts=['scripts/neis-play-v1.js','scripts/neis-game-connectors-v1.js']
 old_styles=['styles/neis-play-v1.css','styles/neis-game-connectors-v1.css']
 check(any(p in html for p in old_scripts) and any(p in html for p in old_styles),'GAME_ENTRYPOINT_NOT_FOUND')
 count=sum(p.is_file() for p in previous.rglob('*'))
 check(count>100,'FRONTEND_TOO_SMALL')
 if '--dry-run' in sys.argv:
  print('NEIS_CONNECTORS_OVH_PREFLIGHT=PASS')
  return
 revision=os.environ.get('GITHUB_SHA','')[:12]
 check(bool(re.fullmatch('[a-f0-9]{12}',revision)),'INVALID_REVISION')
 destination=RELEASES/('neis-game-connectors-'+revision)
 building=pathlib.Path(str(destination)+'.building')
 check(not destination.exists() and not building.exists(),'RELEASE_ALREADY_EXISTS')
 shutil.copytree(previous,building)
 for src,target in FILES.items():
  dest=building/target;dest.parent.mkdir(parents=True,exist_ok=True)
  shutil.copy2(STAGE/src,dest)
  check(dest.read_text()==(STAGE/src).read_text(),'ASSET_COPY_MISMATCH')
 def swap(content,oldpaths,newpath):
  for oldpath in oldpaths:
   content,n=re.subn(re.escape(oldpath)+r'(?:\?[^"<> ]*)?',newpath+'?v='+revision,content)
   if n:return content
  raise RuntimeError('INDEX_GAME_ASSET_REFERENCE_MISSING_'+newpath)
 html=swap(html,old_styles,'styles/neis-game-connectors-v1.css')
 html=swap(html,old_scripts,'scripts/neis-game-connectors-v1.js')
 html=swap(html,['scripts/featured-articles-v160.js'],'scripts/featured-articles-v160.js')
 html=swap(html,['scripts/navigation-v14.js'],'scripts/navigation-v14.js')
 # Publish the mobile navigation and message composers in the same atomic release.
 # Update their query strings to avoid serving stale JavaScript/CSS from PWA caches.
 for path in ('styles/ui-v14.css','scripts/05-social.js','scripts/magnus-neis-v1.js','scripts/timetable-ai-v1.js'):
  html=swap(html,[path],path)
 # The release is cloned from the active OVH site, not the repository index.html.
 # Make Game Hub resources non-blocking on the *deployed* HTML as well.
 stylesheet='<link rel="stylesheet" href="styles/neis-game-connectors-v1.css?v='+revision+'" media="print" onload="this.media=\'all\'">'
 html,n=re.subn(r'<link\b[^>]*href="styles/neis-game-connectors-v1\.css\?v='+revision+r'"[^>]*>',lambda _m:stylesheet,html,count=1)
 check(n==1,'GAME_CSS_NONBLOCKING_SWAP_FAILED')
 script=r'<script src="scripts/neis-game-connectors-v1.js?v='+revision+r'" async></script>'
 html,n=re.subn(r'<script\b[^>]*src="scripts/neis-game-connectors-v1\.js\?v='+revision+r'"[^>]*></script>',lambda _m:script,html,count=1)
 check(n==1,'GAME_JS_ASYNC_SWAP_FAILED')
 check(html.count('scripts/neis-game-connectors-v1.js')==1,'GAME_SCRIPT_DUPLICATE')
 check(html.count('scripts/featured-articles-v160.js')==1,'FEATURED_ARTICLE_MODULE_DUPLICATE')
 check(html.count('scripts/navigation-v14.js')==1,'MOBILE_NAV_SCRIPT_DUPLICATE')
 check(html.count('styles/neis-game-connectors-v1.css')==1,'GAME_STYLE_DUPLICATE')
 for path in ('styles/ui-v14.css','scripts/05-social.js','scripts/magnus-neis-v1.js','scripts/timetable-ai-v1.js'):
  check(html.count(path)==1,'MOBILE_RUNTIME_DUPLICATE_'+path)
 check('scripts/neis-play-v1.js' not in html,'OLD_GAME_ENGINE_STILL_LOADED')
 check(html.index('scripts/featured-articles-v160.js')<html.index('scripts/data-coordinator-v171.js'),'FEATURED_ARTICLE_LOAD_ORDER_CHANGED')
 check(html.index('scripts/neis-game-connectors-v1.js')<html.index('scripts/data-coordinator-v171.js'),'LOAD_ORDER_CHANGED')
 (building/'index.html').write_text(html)
 check(sum(p.is_file() for p in building.rglob('*'))>=count,'FRONTEND_FILES_REMOVED')
 building.rename(destination)
 changed=False
 try:
  OVERLAY.write_text(original_overlay.replace(str(previous),str(destination),1))
  changed=True
  call(COMPOSE+['config','--quiet'],timeout=45)
  call(COMPOSE+['up','-d','--no-deps','caddy'],timeout=155)
  check(active()==destination,'NEW_CADDY_MOUNT_NOT_ACTIVE')
  container=call(COMPOSE+['ps','-q','caddy'],timeout=20).strip()
  check(bool(container),'CADDY_CONTAINER_MISSING')
  deployed_html=call(DOCKER+['exec',container,'cat','/srv/neis-circle/index.html'],timeout=25)
  check(checksum(deployed_html)==checksum(html),'LIVE_HTML_MISMATCH')
  for src,path in FILES.items():
   deployed=call(DOCKER+['exec',container,'cat','/srv/neis-circle/'+path],timeout=25)
   check(checksum(deployed)==checksum((STAGE/src).read_text()),'LIVE_CONNECTOR_ASSET_MISMATCH')
  caddy=call(DOCKER+['exec',container,'cat','/etc/caddy/Caddyfile'],timeout=25)
  check(all(x in caddy for x in ('reverse_proxy rest:3000','reverse_proxy auth:9999','basic_auth')),'AUTH_PROXY_MODIFIED')
 except Exception:
  if changed:
   OVERLAY.write_text(original_overlay)
   call(COMPOSE+['up','-d','--no-deps','caddy'],timeout=130,required=False)
   print('NEIS_CONNECTORS=ROLLED_BACK')
  raise
 print('NEIS_CONNECTORS=DEPLOYED_AND_VERIFIED')
 print('GAME_ENGINES=DISABLED')
 print('DATABASE_AND_EDGE=UNTOUCHED')
 print('MOBILE_CHAT_INPUT_FOCUS=FIXED')
 print('RELEASE='+revision)
if __name__=='__main__':
 try:main()
 except Exception as exc:
  print('NEIS_CONNECTORS=FAILED_'+str(exc)[:180],file=sys.stderr)
  sys.exit(1)
