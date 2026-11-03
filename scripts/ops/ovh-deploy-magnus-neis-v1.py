#!/usr/bin/env python3
"""Deploy Magnus privately on existing OVH Supabase Edge + frontend.

No new paid services, no modifications to WhatsApp Magnus, no Circle triggers.
Immutable mount releases, config parity checks and rollback of active services.
"""
import copy, json, os, pathlib, re, shutil, subprocess, sys, urllib.error, urllib.request, uuid

ROOT=pathlib.Path('/home/ubuntu/neis-supabase')
STAGE=pathlib.Path('/home/ubuntu/neis-backups/magnus-neis-20261103')
EDGE_OVERLAY=ROOT/'docker-compose.magnus-neis.yml'
FRONT_OVERLAY=ROOT/'docker-compose.frontend-public.yml'
DOCKER=['sudo','-n','/usr/bin/docker']
ROOT_COMPOSE=['docker-compose.yml','docker-compose.security.yml','docker-compose.caddy.yml',
              'docker-compose.frontend-public.yml','docker-compose.auth-public-direct.yml']
FUNCTION_OVERLAYS=['docker-compose.edge-integrations.yml','docker-compose.timetable-ai.yml',
                   'docker-compose.timetable-ai-gemini.yml','docker-compose.timetable-ai-cloudflare.yml']
NEW_VERSION=uuid.uuid4().hex[:14]
EDGE_DEST=pathlib.Path('/home/ubuntu/neis-backups/magnus-edge-release-'+NEW_VERSION)
FRONT_DEST=pathlib.Path('/home/ubuntu/neis-frontend/releases/magnus-neis-'+NEW_VERSION)
ORIGINAL_EDGE=None
ORIGINAL_FRONT=None
OLD_OVERLAY=None
FUNCTIONS_CHANGED=False
FRONT_CHANGED=False

def ensure(condition,code):
 if not condition:raise RuntimeError(code)

def call(cmd,timeout=90,stdin=None,check=True):
 process=subprocess.run(cmd,cwd=ROOT,capture_output=True,input=stdin,text=True,timeout=timeout)
 if check and process.returncode:
  raise RuntimeError('COMMAND_FAILED_'+str(process.returncode))
 return process.stdout

def compose(include_magnus=True):
 files=ROOT_COMPOSE+[f for f in FUNCTION_OVERLAYS if (ROOT/f).is_file()]
 if include_magnus and EDGE_OVERLAY.is_file():files.append(EDGE_OVERLAY.name)
 return DOCKER+['compose']+[part for f in files for part in ('-f',f)]

def config():
 return json.loads(call(compose()+['config','--format','json'],timeout=55))

def mount_by_target(container,desired):
 metadata=json.loads(call(DOCKER+['inspect',container],timeout=25))[0]
 ensure(metadata.get('State',{}).get('Running') is True,container+'_NOT_RUNNING')
 mounts=[m['Source'] for m in metadata['Mounts'] if m.get('Destination')==desired and m.get('Type')=='bind']
 ensure(len(mounts)==1,'MOUNT_UNEXPECTED_'+container)
 return pathlib.Path(mounts[0])

def edge_mount(cfg):
 matches=[m for m in cfg['services']['functions'].get('volumes',[])
          if m.get('target')=='/home/deno/functions']
 ensure(len(matches)==1,'EDGE_COMPOSE_MOUNT_INVALID')
 return matches[0]

def verify_parity(old,new):
 ensure(set(old['services'])==set(new['services']),'SERVICES_CHANGED')
 for key,previous in old['services'].items():
  current=new['services'][key]
  if key!='functions':
   ensure(previous==current,'UNRELATED_SERVICE_CHANGED_'+key)
   continue
  p=copy.deepcopy(previous);n=copy.deepcopy(current)
  p['volumes']=[m for m in p.get('volumes',[]) if m.get('target')!='/home/deno/functions']
  n['volumes']=[m for m in n.get('volumes',[]) if m.get('target')!='/home/deno/functions']
  ensure(p==n,'EDGE_SERVICE_PARAMETERS_CHANGED')

def database(sql,check=True):
 return call(DOCKER+['exec','-i','supabase-db','psql','-X','-v','ON_ERROR_STOP=1',
   '-U','postgres','-d','postgres','-q'],timeout=65,stdin=sql,check=check)

def verify_route():
 url='https://supabase.neiscircle.site/functions/v1/magnus-chat'
 request=urllib.request.Request(url,method='OPTIONS',headers={
  'Origin':'https://neiscircle.site','Access-Control-Request-Method':'POST'})
 with urllib.request.urlopen(request,timeout=18) as response:
  ensure(response.status in (200,204),'MAGNUS_OPTIONS_NOT_READY')
 request=urllib.request.Request(url,method='POST',data=b'{}',headers={
  'Content-Type':'application/json','Authorization':'Bearer invalid'})
 try:
  with urllib.request.urlopen(request,timeout=18) as result:
   raise RuntimeError('UNAUTHENTICATED_MAGNUS_REQUEST_ACCEPTED')
 except urllib.error.HTTPError as e:
  ensure(e.code in (401,403),'MAGNUS_AUTH_CHECK_FAILED')

def write_overlay(text):
 temp=EDGE_OVERLAY.with_suffix('.yml.tmp-'+NEW_VERSION)
 try:
  fd=os.open(str(temp),os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
  with os.fdopen(fd,'w') as out:out.write(text)
  os.replace(temp,EDGE_OVERLAY)
 finally:
  temp.unlink(missing_ok=True)

def restore_edge():
 global FUNCTIONS_CHANGED
 if OLD_OVERLAY is None:EDGE_OVERLAY.unlink(missing_ok=True)
 else:write_overlay(OLD_OVERLAY)
 if FUNCTIONS_CHANGED:
  call(compose()+['up','-d','--no-deps','--force-recreate','functions'],timeout=115,check=False)
 FUNCTIONS_CHANGED=False

def restore_front():
 global FRONT_CHANGED
 if FRONT_CHANGED and ORIGINAL_FRONT is not None:
  FRONT_OVERLAY.write_text(ORIGINAL_FRONT)
  call(compose()+['up','-d','--no-deps','caddy'],timeout=95,check=False)
 FRONT_CHANGED=False

def main():
 global ORIGINAL_EDGE,ORIGINAL_FRONT,OLD_OVERLAY,FUNCTIONS_CHANGED,FRONT_CHANGED
 ensure(STAGE.is_dir() and FRONT_OVERLAY.is_file(),'STAGE_MISSING')
 for file in ('index.ts','magnus-neis-v1.js','magnus-neis-v1.css','05-social.js','schema.sql'):
  ensure((STAGE/file).is_file(),'FILE_MISSING_'+file)
 ensure('magnus_commit_turn' in (STAGE/'index.ts').read_text(),'EDGE_SOURCE_INVALID')
 ensure('NEISMagnus' in (STAGE/'05-social.js').read_text(),'SOCIAL_SOURCE_INVALID')
 call(['node','--check',str(STAGE/'magnus-neis-v1.js')],timeout=20)
 # Dry-run schema in a transaction without changing real accounts.
 original_sql=(STAGE/'schema.sql').read_text()
 lines=[line for line in original_sql.splitlines() if
  line.strip().lower() not in ('begin;','commit;') and
  not line.lower().startswith('notify pgrst')]
 database('begin;\n'+'\n'.join(lines)+'\nrollback;')
 ensure(not EDGE_DEST.exists() and not FRONT_DEST.exists(),'RELEASE_COLLISION')
 ORIGINAL_EDGE=(EDGE_OVERLAY.read_text() if EDGE_OVERLAY.is_file() else None)
 OLD_OVERLAY=ORIGINAL_EDGE
 before=config()
 live_edge=mount_by_target('supabase-edge-functions','/home/deno/functions')
 ensure(edge_mount(before)['source']==str(live_edge),'LIVE_EDGE_COMPOSE_MISMATCH')
 ensure((live_edge/'main/index.ts').is_file(),'EDGE_ROUTER_MISSING')
 # Existing Supabase runtime already has secrets (same key as timetable AI).
 call(DOCKER+['exec','supabase-edge-functions','sh','-c',
  'test -n "$GEMINI_API_KEY" && test -n "$SUPABASE_SERVICE_ROLE_KEY"'],timeout=15)
 temp=pathlib.Path(str(EDGE_DEST)+'.building')
 ensure(not temp.exists(),'EDGE_TEMP_COLLISION')
 shutil.copytree(live_edge,temp)
 (temp/'magnus-chat').mkdir(exist_ok=True)
 shutil.copy2(STAGE/'index.ts',temp/'magnus-chat/index.ts')
 temp.rename(EDGE_DEST)
 mount=copy.deepcopy(edge_mount(before))
 ensure(mount.get('type')=='bind' and mount.get('read_only') is True,'UNSAFE_EDGE_MOUNT')
 mount['source']=str(EDGE_DEST)
 new_overlay='services:\n  functions:\n    volumes:\n      - '+json.dumps(mount,separators=(',',':'))+'\n'
 write_overlay(new_overlay)
 try:
  candidate=config();verify_parity(before,candidate)
  # The schema is additive and does not modify any existing chat tables.
  database(original_sql)
  FUNCTIONS_CHANGED=True
  call(compose()+['up','-d','--no-deps','--force-recreate','functions'],timeout=130)
  verify_route()
 except Exception:
  restore_edge()
  raise

 # Preserve the currently live frontend runtime rather than overwriting it
 # with a potentially stale repository snapshot.
 current=mount_by_target('supabase-caddy','/srv/neis-circle')
 ensure(current.parent==pathlib.Path('/home/ubuntu/neis-frontend/releases'),'INVALID_FRONTEND')
 ORIGINAL_FRONT=FRONT_OVERLAY.read_text()
 ensure(ORIGINAL_FRONT.count(str(current))==1,'FRONT_OVERLAY_MOUNT_INVALID')
 live_index=(current/'index.html').read_text()
 ensure('scripts/05-social.js' in live_index and 'styles/app.css' in live_index,
        'ACTIVE_APP_ASSETS_MISSING')
 temp=pathlib.Path(str(FRONT_DEST)+'.building')
 ensure(not temp.exists(),'FRONT_TEMP_COLLISION')
 shutil.copytree(current,temp)
 shutil.copy2(STAGE/'magnus-neis-v1.js',temp/'scripts/magnus-neis-v1.js')
 shutil.copy2(STAGE/'magnus-neis-v1.css',temp/'styles/magnus-neis-v1.css')
 social_file=temp/'scripts/05-social.js'
 current_social=social_file.read_text()
 staged_social=(STAGE/'05-social.js').read_text()
 marker='// Magnus is a pinned, private AI conversation in Messages only.'
 social_patch=staged_social[staged_social.index(marker):staged_social.index('function sharedChatContentCard(m){',staged_social.index(marker))]
 if 'window.NEISMagnus?.integrate' not in current_social:
  ensure('function sharedChatContentCard(m){' in current_social,'SOCIAL_PATCH_ANCHOR_MISSING')
  current_social=current_social.replace('function sharedChatContentCard(m){',
   social_patch+'function sharedChatContentCard(m){',1)
 if 'window.NEISMagnus?.bind(root' not in current_social:
  ensure('function bindV6(root=document){' in current_social,'SOCIAL_BIND_ANCHOR_MISSING')
  current_social=current_social.replace('function bindV6(root=document){',
   'function bindV6(root=document){\n  window.NEISMagnus?.bind(root,{sb,user:authUser,routeTo,lang:state.lang});',1)
 social_file.write_text(current_social)
 call(['node','--check',str(social_file)],timeout=20)
 if 'scripts/magnus-neis-v1.js' not in live_index:
  social=re.search(r'<script[^>]+scripts/05-social[.]js[^>]*></script>',live_index)
  ensure(social is not None,'INDEX_SOCIAL_SCRIPT_MISSING')
  live_index=live_index.replace(social.group(0),social.group(0)+
   '\n<script src="scripts/magnus-neis-v1.js?v='+NEW_VERSION+'" defer></script>',1)
 else:
  live_index=re.sub(r'(scripts/magnus-neis-v1[.]js)(?:[?][^"]*)?',
    lambda m:m.group(1)+'?v='+NEW_VERSION,live_index,count=1)
 if 'styles/magnus-neis-v1.css' not in live_index:
  live_index=live_index.replace('</head>',
   '<link rel="stylesheet" href="styles/magnus-neis-v1.css?v='+NEW_VERSION+'">\n</head>',1)
 else:
  live_index=re.sub(r'(styles/magnus-neis-v1[.]css)(?:[?][^"]*)?',
    lambda m:m.group(1)+'?v='+NEW_VERSION,live_index,count=1)
 live_index=re.sub(r'(scripts/05-social[.]js)(?:[?][^"]*)?',
   lambda m:m.group(1)+'?v='+NEW_VERSION,live_index,count=1)
 (temp/'index.html').write_text(live_index)
 temp.rename(FRONT_DEST)
 try:
  FRONT_OVERLAY.write_text(ORIGINAL_FRONT.replace(str(current),str(FRONT_DEST),1))
  FRONT_CHANGED=True
  call(compose()+['config','--quiet'],timeout=45)
  call(compose()+['up','-d','--no-deps','caddy'],timeout=120)
  mounted=mount_by_target('supabase-caddy','/srv/neis-circle')
  ensure(mounted==FRONT_DEST,'FRONT_NOT_ACTIVE')
  ensure('magnus-neis-v1.js?v='+NEW_VERSION in (mounted/'index.html').read_text(),
   'MAGNUS_FRONT_NOT_ACTIVE')
 except Exception:
  restore_front()
  restore_edge()
  raise
 print('MAGNUS_BACKEND=DEPLOYED')
 print('MAGNUS_FRONTEND=DEPLOYED')
 print('MAGNUS_ISOLATION=PRIVATE_MESSAGES_ONLY')
 print('MAGNUS_OLD_WHATSAPP_BOT=UNCHANGED')
 print('MAGNUS_RELEASE_ID='+NEW_VERSION)

if __name__=='__main__':
 try:main()
 except Exception as error:
  print('MAGNUS_DEPLOY_FAILED_'+str(error)[:95],file=sys.stderr)
  raise SystemExit(1)
