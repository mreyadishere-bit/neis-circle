#!/usr/bin/env python3
"""Scoped Saved feed sizing deployment; preserve live OVH configuration."""
import json,os,pathlib,re,shutil,subprocess,sys
ROOT=pathlib.Path('/home/ubuntu/neis-supabase')
STAGE=pathlib.Path('/home/ubuntu/neis-backups/saved-post-home-width-20261103')
REL=pathlib.Path('/home/ubuntu/neis-frontend/releases')
OVERLAY=ROOT/'docker-compose.frontend-public.yml'
DOCKER=['sudo','-n','/usr/bin/docker']
COMPOSE=DOCKER+['compose']+[v for f in ('docker-compose.yml','docker-compose.security.yml','docker-compose.caddy.yml','docker-compose.frontend-public.yml','docker-compose.auth-public-direct.yml') for v in ('-f',f)]
OLD='<div class="feed">'+ '$' + '{p.length?p.map(postCard).join(""):'
NEW='<div class="feed saved-home-width-feed">'+ '$' + '{p.length?p.map(postCard).join(""):'
STYLE='\n/* saved-home-layout-20261103 */\n@media(min-width:1101px){#view .saved-home-width-feed{width:calc(100% - 352px);max-width:100%;min-width:0}}\n@media(max-width:1100px){#view .saved-home-width-feed{width:100%;max-width:100%;min-width:0}}\n'
def need(ok,msg):
 if not ok:raise RuntimeError(msg)
def cmd(a,timeout=90,check=True):
 r=subprocess.run(a,cwd=ROOT,capture_output=True,text=True,timeout=timeout)
 if check and r.returncode:raise RuntimeError('COMMAND_FAILED')
 return r.stdout
def main():
 need(STAGE.is_dir() and OVERLAY.is_file() and REL.is_dir(),'MISSING_FILES')
 source=(STAGE/'01-core.js').read_text()
 need(source.count(NEW)==1,'INVALID_SOURCE')
 cmd(COMPOSE+['config','--quiet'],timeout=50)
 obj=json.loads(cmd(DOCKER+['inspect','supabase-caddy'],timeout=30))[0]
 mounts=[m['Source'] for m in obj.get('Mounts',[]) if m.get('Type')=='bind' and m.get('Destination')=='/srv/neis-circle']
 need(len(mounts)==1,'MISSING_BIND')
 old=pathlib.Path(mounts[0])
 need(old.is_dir() and old.parent==REL,'INVALID_RELEASE')
 original=OVERLAY.read_text()
 need(original.count(str(old))==1,'OVERLAY_MISMATCH')
 html=(old/'index.html').read_text()
 need(html.count('scripts/01-core.js')==1 and html.count('styles/app.css')==1,'INVALID_INDEX')
 code=(old/'scripts/01-core.js').read_text()
 css=(old/'styles/app.css').read_text()
 need(code.count(OLD)==1 or code.count(NEW)==1,'INVALID_LIVE_MARKUP')
 name=os.environ.get('GITHUB_SHA','')[:12]
 need(bool(re.fullmatch('[a-f0-9]{12}',name)),'INVALID_REVISION')
 dest=REL/('saved-post-width-'+name)
 building=pathlib.Path(str(dest)+'.building')
 need(not dest.exists() and not building.exists(),'RELEASE_EXISTS')
 count=sum(f.is_file() for f in old.rglob('*'))
 need(count>100,'INCOMPLETE_FRONTEND')
 shutil.copytree(old,building)
 modified=code.replace(OLD,NEW,1)
 (building/'scripts/01-core.js').write_text(modified)
 modified_css=css if 'saved-home-layout-20261103' in css else css+STYLE
 (building/'styles/app.css').write_text(modified_css)
 rev='20261103-saved-home-size'
 html,a=re.subn(r'(scripts/01-core\.js)(?:\?[^"\s]*)?',lambda m:m.group(1)+'?v='+rev,html,count=1)
 html,b=re.subn(r'(styles/app\.css)(?:\?[^"\s]*)?',lambda m:m.group(1)+'?v='+rev,html,count=1)
 need(a==1 and b==1,'CACHE_BUST_FAILED')
 (building/'index.html').write_text(html)
 need(sum(f.is_file() for f in building.rglob('*'))==count,'COPY_INCOMPLETE')
 cmd(['node','--check',str(building/'scripts/01-core.js')],timeout=25)
 building.rename(dest)
 changed=False
 try:
  OVERLAY.write_text(original.replace(str(old),str(dest),1));changed=True
  cmd(COMPOSE+['config','--quiet'],timeout=50)
  cmd(COMPOSE+['up','-d','--no-deps','caddy'],timeout=150)
  cid=cmd(COMPOSE+['ps','-q','caddy'],timeout=30).strip()
  need(bool(cid),'CADDY_DOWN')
  livehtml=cmd(DOCKER+['exec',cid,'cat','/srv/neis-circle/index.html'],timeout=30)
  livecode=cmd(DOCKER+['exec',cid,'cat','/srv/neis-circle/scripts/01-core.js'],timeout=30)
  livecss=cmd(DOCKER+['exec',cid,'cat','/srv/neis-circle/styles/app.css'],timeout=30)
  need(livecode==modified and livecss==modified_css,'ASSETS_CHANGED')
  need('01-core.js?v='+rev in livehtml and 'app.css?v='+rev in livehtml,'INDEX_NOT_ACTIVE')
  need(livecode.replace(NEW,OLD,1)==code,'UNRELATED_CORE_CHANGED')
  cf=cmd(DOCKER+['exec',cid,'cat','/etc/caddy/Caddyfile'],timeout=30)
  need(all(z in cf for z in ('reverse_proxy rest:3000','reverse_proxy auth:9999','basic_auth')),'PROXY_CHANGED')
 except Exception:
  if changed:
   OVERLAY.write_text(original)
   cmd(COMPOSE+['up','-d','--no-deps','caddy'],timeout=120,check=False)
   print('SAVED_FEED_WIDTH=ROLLED_BACK')
  raise
 print('SAVED_FEED_WIDTH=DEPLOYED_AND_VERIFIED')
 print('OVH_CONFIG_AND_DATABASE=UNCHANGED')
if __name__=='__main__':
 try:main()
 except Exception as err:
  print('SAVED_FEED_WIDTH=FAILED_'+str(err)[:70],file=sys.stderr)
  sys.exit(1)
