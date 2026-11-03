#!/usr/bin/env python3
"""NEIS Play v2: guarded, reversible OVH rollout. No unrelated service restarts."""
import copy,hashlib,json,os,pathlib,re,shutil,subprocess,sys,urllib.request,urllib.error,uuid

ROOT=pathlib.Path('/home/ubuntu/neis-supabase')
STAGE=pathlib.Path('/home/ubuntu/neis-backups/neis-play-v2-stage')
REL=pathlib.Path('/home/ubuntu/neis-frontend/releases')
OVERLAY=ROOT/'docker-compose.frontend-public.yml'
EDGE_OVERLAY=ROOT/'docker-compose.magnus-neis.yml'
BASE=['docker-compose.yml','docker-compose.security.yml','docker-compose.caddy.yml','docker-compose.frontend-public.yml','docker-compose.auth-public-direct.yml']
EXTRA=['docker-compose.edge-integrations.yml','docker-compose.timetable-ai.yml','docker-compose.timetable-ai-gemini.yml','docker-compose.timetable-ai-cloudflare.yml']
DOCKER=['sudo','-n','/usr/bin/docker']
SHA=os.environ.get('GITHUB_SHA','')[:12]
VERSION='20261103-play-v2-'+SHA
FILES={'neis-play-v1.js':'scripts/neis-play-v1.js','neis-play-v1.css':'styles/neis-play-v1.css'}
ADMIN='scripts/main-admin-auth-studio-v5.js'
OLD_ADMIN_COLUMNS="['last_sign_in_at','Last sign in at'],['status','Status'],['branch','Branch'],\n    ['grade','Grade'],['role','Role'],['actions','Actions']"
NEW_ADMIN_COLUMNS="['last_sign_in_at','Last sign in at'],['status','Status'],['actions','Actions']"
OLD_ADMIN_CLASS="k==='actions'?'st-other'"
NEW_ADMIN_CLASS="k==='actions'?'st-actions'"
EDGE_SOURCE='neis-quiz-ai/index.ts'
def require(cond,msg):
 if not cond:raise RuntimeError(msg)
def cmd():return DOCKER+['compose']+[part for f in BASE+[f for f in EXTRA if (ROOT/f).is_file()]+([EDGE_OVERLAY.name] if EDGE_OVERLAY.is_file() else []) for part in ('-f',f)]
def run(a,stdin=None,timeout=100,check=True):
 p=subprocess.run(a,cwd=ROOT,input=stdin,capture_output=True,text=True,timeout=timeout)
 if check and p.returncode:raise RuntimeError('COMMAND_FAILED_'+str(p.returncode)+':'+p.stderr[-150:])
 return p.stdout
def config():return json.loads(run(cmd()+['config','--format','json'],timeout=60))
def db(sql,timeout=150):
 return run(DOCKER+['exec','-i','supabase-db','psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-Atq'],stdin=sql,timeout=timeout)
def digest(s):return hashlib.sha256(s.encode()).hexdigest()
def active(container,dest):
 data=json.loads(run(DOCKER+['inspect',container],timeout=35))[0]
 require(data.get('State',{}).get('Running'),'SERVICE_DOWN_'+container)
 mounts=[pathlib.Path(v['Source']) for v in data.get('Mounts',[]) if v.get('Type')=='bind' and v.get('Destination')==dest]
 require(len(mounts)==1 and mounts[0].is_dir(),'INVALID_MOUNT_'+container)
 return mounts[0]
def edge_volume(cfg):
 items=[m for m in cfg['services']['functions'].get('volumes',[]) if m.get('target')=='/home/deno/functions']
 require(len(items)==1,'EDGE_VOLUME_MISSING')
 return items[0]
def parity(before,after):
 require(set(before['services'])==set(after['services']),'SERVICE_SET_CHANGED')
 for name,prev in before['services'].items():
  later=after['services'][name]
  if name!='functions':require(prev==later,'UNRELATED_SERVICE_CHANGED_'+name)
  else:
   a=copy.deepcopy(prev);b=copy.deepcopy(later)
   a['volumes']=[m for m in a.get('volumes',[]) if m.get('target')!='/home/deno/functions']
   b['volumes']=[m for m in b.get('volumes',[]) if m.get('target')!='/home/deno/functions']
   require(a==b,'EDGE_RUNTIME_CHANGED')
def check_route(name):
 uri='https://supabase.neiscircle.site/functions/v1/'+name
 req=urllib.request.Request(uri,method='OPTIONS',headers={'Origin':'https://neiscircle.site','Access-Control-Request-Method':'POST'})
 with urllib.request.urlopen(req,timeout=20) as res:require(res.status in (200,204),'EDGE_ROUTE_UNAVAILABLE_'+name)
 req=urllib.request.Request(uri,data=b'{}',method='POST',headers={'Authorization':'Bearer invalid','Content-Type':'application/json'})
 try:
  with urllib.request.urlopen(req,timeout=20):raise RuntimeError('UNAUTHENTICATED_ROUTE_'+name)
 except urllib.error.HTTPError as err:require(err.code in (401,403),'EDGE_AUTH_FAILED_'+name)
def main():
 require(bool(re.fullmatch('[a-f0-9]{12}',SHA)),'INVALID_COMMIT_SHA')
 require(STAGE.is_dir() and OVERLAY.is_file() and EDGE_OVERLAY.is_file(),'STAGE_OR_OVERLAY_MISSING')
 for file in list(FILES)+['main-admin-auth-studio-v5.js','neis-quiz-ai.ts','quiz-studio.sql','quiz-rooms.sql','quiz-limits.sql']:
  require((STAGE/file).is_file(),'STAGED_FILE_MISSING_'+file)
 for f in ('neis-play-v1.js','main-admin-auth-studio-v5.js'):
  run(['node','--check',str(STAGE/f)],timeout=25)
 js=(STAGE/'neis-play-v1.js').read_text()
 require('view.replaceChildren(r)' in js and 'sendInvitation(kind,id)' in js and "neis_quiz_grade" in js,'BAD_FRONTEND_SOURCE')
 sql='\n'.join((STAGE/f).read_text() for f in ('quiz-studio.sql','quiz-rooms.sql','quiz-limits.sql'))
 require('neis_quiz_ai_claim' in sql and 'neis_quiz_room_scores' in sql,'MISSING_MIGRATION')
 run(cmd()+['config','--quiet'],timeout=50)
 before=config()
 edge=active('supabase-edge-functions','/home/deno/functions')
 require(edge==pathlib.Path(edge_volume(before)['source']),'EDGE_ACTIVE_CONFIG_MISMATCH')
 require((edge/'magnus-chat/index.ts').is_file() and (edge/'main/index.ts').is_file(),'EDGE_FUNCTIONS_INCOMPLETE')
 run(DOCKER+['exec','supabase-edge-functions','sh','-c','test -n "$GEMINI_API_KEY"'],timeout=20)
 front=active('supabase-caddy','/srv/neis-circle')
 require(front.parent==REL,'FRONTEND_RELEASE_UNEXPECTED')
 original_front=OVERLAY.read_text();original_edge=EDGE_OVERLAY.read_text()
 require(original_front.count(str(front))==1,'FRONT_OVERLAY_CHANGED')
 html=(front/'index.html').read_text()
 require(all(p in html for p in ('scripts/01-core.js','scripts/05-social.js','scripts/main-admin-auth-studio-v5.js','scripts/neis-play-v1.js')),'FRONTEND_INDEX_INCOMPLETE')
 live_admin=(front/ADMIN).read_text()
 require(live_admin.count(OLD_ADMIN_COLUMNS)==1 or live_admin.count(NEW_ADMIN_COLUMNS)==1,'ADMIN_COLUMNS_CHANGED')
 # Validate migrations in a transaction, even when new tables already exist.
 witness="select case when to_regclass('public.neis_quizzes') is not null and to_regclass('public.neis_quiz_answers') is not null and to_regprocedure('public.neis_quiz_room_scores(uuid)') is not null and to_regprocedure('public.neis_quiz_ai_claim()') is not null then 'PLAY_V2_SQL=PASS' else 'PLAY_V2_SQL=FAIL' end;"
 outcome=db('begin;\n'+sql+'\n'+witness+'\nrollback;\n',timeout=180)
 require('PLAY_V2_SQL=PASS' in outcome,'DB_MIGRATION_DRY_RUN_FAILED')
 print('PLAY_V2_SQL_DRY_RUN=PASS')
 if '--dry-run' in sys.argv:
  print('PLAY_V2_PREFLIGHT=PASS')
  return
 # New dedicated tables and additive updated Play-only RPCs are transactionally applied.
 db('begin;\n'+sql+'\ncommit;\n',timeout=180)
 require(db(witness).strip()=='PLAY_V2_SQL=PASS','DB_MIGRATION_NOT_VISIBLE')
 print('PLAY_V2_DB=APPLIED')
 # Edge: preserve all other functions from the live mount.
 suffix=SHA+'-'+uuid.uuid4().hex[:5]
 edge_release=pathlib.Path('/home/ubuntu/neis-backups/play-v2-edge-'+suffix)
 edge_tmp=pathlib.Path(str(edge_release)+'.building')
 require(not edge_release.exists() and not edge_tmp.exists(),'EDGE_RELEASE_EXISTS')
 shutil.copytree(edge,edge_tmp)
 (edge_tmp/'neis-quiz-ai').mkdir(parents=True,exist_ok=True)
 shutil.copy2(STAGE/'neis-quiz-ai.ts',edge_tmp/EDGE_SOURCE)
 edge_tmp.rename(edge_release)
 volume=copy.deepcopy(edge_volume(before))
 require(volume.get('type')=='bind' and volume.get('read_only') is True,'EDGE_VOLUME_UNSAFE')
 volume['source']=str(edge_release)
 new_overlay='services:\n  functions:\n    volumes:\n      - '+json.dumps(volume,separators=(',',':'))+'\n'
 edge_switched=False
 front_switched=False
 try:
  EDGE_OVERLAY.write_text(new_overlay);edge_switched=True
  parity(before,config())
  run(cmd()+['up','-d','--no-deps','--force-recreate','functions'],timeout=150)
  require(active('supabase-edge-functions','/home/deno/functions')==edge_release,'EDGE_RELEASE_NOT_ACTIVE')
  check_route('neis-quiz-ai')
  check_route('magnus-chat')
  print('PLAY_V2_EDGE=VERIFIED')
  # Frontend: inherit *currently active* release, not a stale GitHub snapshot.
  current=active('supabase-caddy','/srv/neis-circle')
  require(current==front,'FRONT_CHANGED_DURING_DEPLOY')
  release=REL/('neis-play-v2-'+suffix)
  tmp=pathlib.Path(str(release)+'.building')
  require(not release.exists() and not tmp.exists(),'FRONT_RELEASE_EXISTS')
  count=sum(p.is_file() for p in current.rglob('*'))
  require(count>100,'FRONTEND_INCOMPLETE')
  shutil.copytree(current,tmp)
  for staged,dest in FILES.items():shutil.copy2(STAGE/staged,tmp/dest)
  patched=live_admin.replace(OLD_ADMIN_COLUMNS,NEW_ADMIN_COLUMNS,1).replace(OLD_ADMIN_CLASS,NEW_ADMIN_CLASS,1)
  patched=re.sub(r"'#neisAuthStudio \.st-moderation\{display:flex;align-items:center;flex-wrap:wrap;gap:7px\}',",
    "'#neisAuthStudio .st-moderation{display:flex;align-items:center;flex-wrap:nowrap;gap:8px;width:max-content}',\n    '#neisAuthStudio .st-actions{width:265px;min-width:265px;overflow:visible}',",patched,count=1)
  require(NEW_ADMIN_COLUMNS in patched and NEW_ADMIN_CLASS in patched and 'flex-wrap:nowrap' in patched,'ADMIN_PATCH_FAILED')
  (tmp/ADMIN).write_text(patched)
  for path in [*FILES.values(),ADMIN]:
   html,n=re.subn('('+re.escape(path)+r')(?:\?[^"\s]*)?',lambda m:m.group(1)+'?v='+VERSION,html,count=1)
   require(n==1,'FRONTEND_CACHE_KEY_FAILED_'+path)
  # Keep the existing runtime coordinator last. Inserting new scripts after it fails static quality checks.
  play_script=re.search(r'<script[^>]+src="scripts/neis-play-v1\.js\?[^"]+"[^>]*></script>',html)
  coordinator=re.search(r'<script[^>]+src="scripts/data-coordinator-v171\.js\?[^"]+"[^>]*></script>',html)
  require(play_script is not None and coordinator is not None,'SCRIPT_ORDER_ANCHORS_MISSING')
  play_tag=play_script.group(0)
  html=html.replace(play_tag,'',1)
  anchor=coordinator.group(0)
  html=html.replace(anchor,play_tag+'\n  '+anchor,1)
  (tmp/'index.html').write_text(html)
  require(sum(p.is_file() for p in tmp.rglob('*'))==count,'FRONT_FILES_CHANGED')
  for path in [*FILES.values(),ADMIN]:run(['node','--check',str(tmp/path)],timeout=25) if path.endswith('.js') else None
  tmp.rename(release)
  OVERLAY.write_text(original_front.replace(str(current),str(release),1));front_switched=True
  run(cmd()+['config','--quiet'],timeout=50)
  run(cmd()+['up','-d','--no-deps','caddy'],timeout=150)
  require(active('supabase-caddy','/srv/neis-circle')==release,'FRONT_RELEASE_NOT_ACTIVE')
  cid=run(cmd()+['ps','-q','caddy'],timeout=30).strip()
  require(bool(cid),'CADDY_MISSING')
  active_html=run(DOCKER+['exec',cid,'cat','/srv/neis-circle/index.html'],timeout=30)
  require(all(path+'?v='+VERSION in active_html for path in [*FILES.values(),ADMIN]),'LIVE_CACHE_MISMATCH')
  for path in [*FILES.values(),ADMIN]:
   got=run(DOCKER+['exec',cid,'cat','/srv/neis-circle/'+path],timeout=30)
   require(digest(got)==digest((release/path).read_text()),'LIVE_FILE_MISMATCH_'+path)
  conf=run(DOCKER+['exec',cid,'cat','/etc/caddy/Caddyfile'],timeout=30)
  require(all(q in conf for q in ('reverse_proxy rest:3000','reverse_proxy auth:9999','basic_auth')),'AUTH_PROXY_CHANGED')
 except Exception:
  if front_switched:
   OVERLAY.write_text(original_front)
   run(cmd()+['up','-d','--no-deps','caddy'],timeout=130,check=False)
   print('PLAY_V2_FRONTEND=ROLLED_BACK')
  if edge_switched:
   EDGE_OVERLAY.write_text(original_edge)
   run(cmd()+['up','-d','--no-deps','--force-recreate','functions'],timeout=140,check=False)
   print('PLAY_V2_EDGE=ROLLED_BACK')
  raise
 print('PLAY_V2_FRONTEND=DEPLOYED_AND_VERIFIED')
 print('PLAY_V2_UNRELATED_SERVICES=UNCHANGED')
 print('PLAY_V2_REVISION='+SHA)
if __name__=='__main__':
 try:main()
 except Exception as exc:
  print('PLAY_V2_DEPLOY=FAILED_'+str(exc)[:190],file=sys.stderr)
  sys.exit(1)
