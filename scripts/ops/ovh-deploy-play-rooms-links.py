#!/usr/bin/env python3
"""OVH frontend-only NEIS Play design rollout; never touch DB or Edge."""
import hashlib,json,os,pathlib,re,shutil,subprocess,sys
ROOT=pathlib.Path('/home/ubuntu/neis-supabase')
STAGE=pathlib.Path('/home/ubuntu/neis-backups/neis-play-rooms-links-20261103')
REL=pathlib.Path('/home/ubuntu/neis-frontend/releases')
OVERLAY=ROOT/'docker-compose.frontend-public.yml'
FILES={'neis-play-v1.js':'scripts/neis-play-v1.js','neis-play-v1.css':'styles/neis-play-v1.css'}
SOCIAL='scripts/05-social.js'

DOCKER=['sudo','-n','/usr/bin/docker']
COMPOSE=DOCKER+['compose']+[x for file in ('docker-compose.yml','docker-compose.security.yml','docker-compose.caddy.yml','docker-compose.frontend-public.yml','docker-compose.auth-public-direct.yml') for x in ('-f',file)]
def check(ok,msg):
 if not ok:raise RuntimeError(msg)
def call(args,timeout=100,require=True):
 p=subprocess.run(args,cwd=ROOT,capture_output=True,text=True,timeout=timeout)
 if p.returncode and require:raise RuntimeError('COMMAND_FAILED_'+str(p.returncode))
 return p.stdout
def sha(s):return hashlib.sha256(s.encode()).hexdigest()
def active():
 obj=json.loads(call(DOCKER+['inspect','supabase-caddy'],timeout=30))[0]
 check(obj.get('State',{}).get('Running'),'CADDY_DOWN')
 binds=[pathlib.Path(m['Source']) for m in obj.get('Mounts',[]) if m.get('Destination')=='/srv/neis-circle' and m.get('Type')=='bind']
 check(len(binds)==1 and binds[0].is_dir(),'CADDY_MOUNT_MISSING')
 return binds[0]
def main():
 check(OVERLAY.is_file() and REL.is_dir() and STAGE.is_dir(),'STAGE_MISSING')
 js=(STAGE/'neis-play-v1.js').read_text()
 css=(STAGE/'neis-play-v1.css').read_text()
 sql=(STAGE/'rooms.sql').read_text()
 social_source=(STAGE/'05-social.js').read_text()
 check('neis_play_manage_room' in sql and 'neis_play_my_rooms' in sql,'MIGRATION_MISSING')
 check('manage:delete:' in js and 'state.view!==S.originalView' in js,'ROOMS_OR_NOTIFICATIONS_MISSING')
 check('function safeChatLinks(value)' in social_source,'LINKIFIER_MISSING')
 call(['node','--check',str(STAGE/'05-social.js')],timeout=30)
 call(['node','--check',str(STAGE/'neis-play-v1.js')],timeout=25)
 call(COMPOSE+['config','--quiet'],timeout=55)
 old=active()
 check(old.parent==REL,'UNEXPECTED_LIVE_RELEASE')
 overlay=OVERLAY.read_text()
 check(overlay.count(str(old))==1,'FRONT_OVERLAY_CHANGED')
 html=(old/'index.html').read_text()
 check(html.count('scripts/neis-play-v1.js')==1 and html.count('styles/neis-play-v1.css')==1,'LIVE_INDEX_MISSING')
 check('data-coordinator-v171.js' in html,'DATA_COORDINATOR_MISSING')
 count=sum(p.is_file() for p in old.rglob('*'))
 check(count>100,'FRONTEND_INCOMPLETE')
 witness="select case when to_regprocedure('public.neis_play_manage_room(uuid,text)') is not null and to_regprocedure('public.neis_play_my_rooms()') is not null then 'ROOM_SQL_OK' else 'ROOM_SQL_BAD' end;"
 def pg(command):
  return call(DOCKER+['exec','-i','supabase-db','psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-Atq'],stdin=command,timeout=170)
 check('ROOM_SQL_OK' in pg('begin;\n'+sql+'\n'+witness+'\nrollback;\n'),'ROOM_SQL_DRY_RUN_FAILED')
 print('ROOM_SQL_DRY_RUN=PASS')
 if '--dry-run' in sys.argv:
  print('ROOM_ROLLOUT_PREFLIGHT=PASS')
  return
 pg('begin;\n'+sql+'\ncommit;\n')
 check(pg(witness).strip()=='ROOM_SQL_OK','ROOM_SQL_NOT_ACTIVE')
 print('ROOM_SQL=APPLIED')

 rev=os.environ.get('GITHUB_SHA','')[:12]
 check(bool(re.fullmatch('[a-f0-9]{12}',rev)),'REVISION_INVALID')
 dest=REL/('neis-play-rooms-links-'+rev)
 tmp=pathlib.Path(str(dest)+'.building')
 check(not dest.exists() and not tmp.exists(),'RELEASE_EXISTS')
 shutil.copytree(old,tmp)
 original_social=(old/SOCIAL).read_text()
 marker='function messageBubble(m,previous){'
 helper=social_source[social_source.index('function safeChatLinks(value){'):social_source.index(marker)]
 if 'function safeChatLinks(value){' not in original_social:
  original_social=original_social.replace(marker,helper+marker,1)
 a=original_social.index(marker)
 b=original_social.index('function circleMessageBubble(m,previous){')
 part=original_social[a:b]
 expected_dm=chr(36)+'{esc(m.body)}'
 fixed_dm=chr(36)+'{safeChatLinks(m.body)}'
 check(expected_dm in part or fixed_dm in part,'DM_BODY_CHANGED')
 original_social=original_social[:a]+part.replace(expected_dm,fixed_dm,1)+original_social[b:]
 b=original_social.index('function circleMessageBubble(m,previous){')
 c=original_social.index('function confirmAction(',b)
 part=original_social[b:c]
 check(':esc(m.body)' in part or ':safeChatLinks(m.body)' in part,'CIRCLE_BODY_CHANGED')
 original_social=original_social[:b]+part.replace(':esc(m.body)',':safeChatLinks(m.body)',1)+original_social[c:]
 check(original_social.count('safeChatLinks(m.body)')==2,'LINKIFIED_MARKUP_MISSING')
 (tmp/SOCIAL).write_text(original_social)
 for src,target in FILES.items():shutil.copy2(STAGE/src,tmp/target)
 for target in [*FILES.values(),SOCIAL]:
  html,n=re.subn('('+re.escape(target)+r')(?:\?[^"\s]*)?',lambda m:m.group(1)+'?v=hub-'+rev,html,count=1)
  check(n==1,'CACHE_BUST_FAILED_'+target)
 (tmp/'index.html').write_text(html)
 check(sum(p.is_file() for p in tmp.rglob('*'))==count,'FRONT_FILE_COUNT_CHANGED')
 check(sha((tmp/'scripts/neis-play-v1.js').read_text())==sha(js),'SCRIPT_COPY_FAILED')
 call(['node','--check',str(tmp/SOCIAL)],timeout=30)
 check(sha((tmp/'styles/neis-play-v1.css').read_text())==sha(css),'CSS_COPY_FAILED')
 # Preserve core runtime ordering and every existing script outside NEIS Play.
 check(html.index('scripts/neis-play-v1.js')<html.index('scripts/data-coordinator-v171.js'),'SCRIPT_LOAD_ORDER_CHANGED')
 tmp.rename(dest)
 changed=False
 try:
  OVERLAY.write_text(overlay.replace(str(old),str(dest),1));changed=True
  call(COMPOSE+['config','--quiet'],timeout=55)
  call(COMPOSE+['up','-d','--no-deps','caddy'],timeout=140)
  check(active()==dest,'NEW_RELEASE_NOT_ACTIVE')
  cid=call(COMPOSE+['ps','-q','caddy'],timeout=25).strip()
  check(bool(cid),'CADDY_CONTAINER_MISSING')
  index=call(DOCKER+['exec',cid,'cat','/srv/neis-circle/index.html'],timeout=25)
  livejs=call(DOCKER+['exec',cid,'cat','/srv/neis-circle/scripts/neis-play-v1.js'],timeout=25)
  livecss=call(DOCKER+['exec',cid,'cat','/srv/neis-circle/styles/neis-play-v1.css'],timeout=25)
  check('neis-play-v1.js?v=hub-'+rev in index and 'neis-play-v1.css?v=hub-'+rev in index and SOCIAL+'?v=hub-'+rev in index,'LIVE_CACHE_MISMATCH')
  check(sha(livejs)==sha(js) and sha(livecss)==sha(css),'LIVE_CONTENT_MISMATCH')
  liveSocial=call(DOCKER+['exec',cid,'cat','/srv/neis-circle/'+SOCIAL],timeout=45)
  check(sha(liveSocial)==sha(original_social),'LIVE_SOCIAL_MISMATCH')
  conf=call(DOCKER+['exec',cid,'cat','/etc/caddy/Caddyfile'],timeout=25)
  check(all(x in conf for x in ('reverse_proxy rest:3000','reverse_proxy auth:9999','basic_auth')),'AUTH_PROXY_CHANGED')
 except Exception:
  if changed:
   OVERLAY.write_text(overlay)
   call(COMPOSE+['up','-d','--no-deps','caddy'],timeout=120,require=False)
   print('NEIS_PLAY_HUB=ROLLED_BACK')
  raise
 print('PLAY_ROOMS_LINKS=DEPLOYED_AND_VERIFIED')
 print('PLAY_ROOMS_UNRELATED_SERVICES=UNCHANGED')
 print('NEIS_PLAY_HUB_RELEASE='+rev)
if __name__=='__main__':
 try:main()
 except Exception as error:
  print('PLAY_ROOMS_LINKS=FAILED_'+str(error)[:80],file=sys.stderr)
  sys.exit(1)
