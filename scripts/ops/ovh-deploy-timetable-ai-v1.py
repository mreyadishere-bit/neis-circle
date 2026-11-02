#!/usr/bin/env python3
"""Safely activate Timetable AI on the existing OVH runtime.
Does NOT replace GitHub's maintenance index, change base Compose files,
modify existing student records, or show secrets. Uses isolated releases and rollback.
"""
from pathlib import Path
import json, os, shutil, subprocess, sys, time, urllib.request, urllib.error

ROOT=Path('/home/ubuntu/neis-supabase')
STAGE=Path('/home/ubuntu/neis-backups/timetable-ai-20261102-v1')
FRONTEND=Path('/home/ubuntu/neis-frontend/releases/timetable-ai-20261102-v1')
EDGE_RELEASE=STAGE/'edge-functions'
NEW_OVERLAY=ROOT/'docker-compose.timetable-ai.yml'
FRONT_OVERLAY=ROOT/'docker-compose.frontend-public.yml'
EDGE_OVERLAY=ROOT/'docker-compose.edge-integrations.yml'
KEYFILE=STAGE/'groq.env'
DOCKER=['sudo','-n','/usr/bin/docker']
BASE=['docker-compose.yml','docker-compose.security.yml','docker-compose.caddy.yml']
FRONT_STACK=BASE+['docker-compose.edge-integrations.yml','docker-compose.frontend-public.yml','docker-compose.auth-public-direct.yml','docker-compose.timetable-ai.yml']
EDGE_STACK=BASE+['docker-compose.edge-integrations.yml','docker-compose.timetable-ai.yml']
STABLE_EDGE_STACK=BASE+['docker-compose.edge-integrations.yml']
phase='preflight'
edge_active=False
frontend_active=False
previous_front_config=''
def compose(files):
  return DOCKER+['compose']+[part for f in files for part in ('-f',f)]
def run(args,timeout=70,stdin=None,check=True):
  r=subprocess.run(args,cwd=ROOT,capture_output=True,input=stdin,text=True,timeout=timeout)
  if check and r.returncode:
    raise RuntimeError('COMMAND_FAILED')
  return r
def need(ok,code):
  if not ok:raise RuntimeError(code)
def inspect(name):
  out=run(DOCKER+['inspect',name],timeout=25)
  return json.loads(out.stdout)[0]
def mount(info,path):
  sources=[m.get('Source') for m in info.get('Mounts',[])
           if m.get('Type')=='bind' and m.get('Destination')==path]
  need(len(sources)==1,'MOUNT_NOT_FOUND')
  return Path(sources[0])
def pg(sql):
  return run(compose(BASE)+['exec','-T','db','psql','-X','-v','ON_ERROR_STOP=1',
       '-U','postgres','-d','postgres','-Atq'],stdin=sql,timeout=90)
def rollback():
  global frontend_active,edge_active
  if frontend_active:
    try:
      FRONT_OVERLAY.write_text(previous_front_config)
      run(compose(FRONT_STACK)+['up','-d','--no-deps','caddy'],timeout=110)
      print('FRONTEND_ROLLBACK=SUCCESS')
    except Exception:
      print('FRONTEND_ROLLBACK=REQUIRES_MANUAL_REVIEW')
  if edge_active:
    try:
      run(compose(STABLE_EDGE_STACK)+['up','-d','--no-deps','--force-recreate','functions'],timeout=125)
      print('EDGE_ROLLBACK=SUCCESS')
    except Exception:
      print('EDGE_ROLLBACK=REQUIRES_MANUAL_REVIEW')
def main():
  global phase,edge_active,frontend_active,previous_front_config
  need(ROOT.is_dir() and STAGE.is_dir(),'STAGING_MISSING')
  for f in ('ai.ts','ui.js','ui.css','quota.sql','apply.sql','groq.env'):
    need((STAGE/f).is_file() and not (STAGE/f).is_symlink(),'STAGING_FILE_MISSING')
  need(KEYFILE.stat().st_mode & 0o777 == 0o600,'KEY_PERMISSIONS_UNSAFE')
  key=KEYFILE.read_text().strip()
  need(key.startswith('GROQ_API_KEY=gsk_') and '\n' not in key and len(key)<300,
       'KEY_FORMAT_INVALID')
  for f in BASE+['docker-compose.edge-integrations.yml','docker-compose.frontend-public.yml','docker-compose.auth-public-direct.yml']:
    need((ROOT/f).is_file(),'COMPOSE_MISSING')
  need(not NEW_OVERLAY.exists() and not FRONTEND.exists() and not EDGE_RELEASE.exists(),
       'ALREADY_INSTALLED')
  need(EDGE_OVERLAY.stat().st_mode & 0o777 == 0o600,'EDGE_PRIVATE_ENV_UNSAFE')
  need(not (EDGE_OVERLAY.is_symlink() or FRONT_OVERLAY.is_symlink()),'OVERLAY_SYMLINK')
  old_edge=mount(inspect('supabase-edge-functions'),'/home/deno/functions')
  old_front=mount(inspect('supabase-caddy'),'/srv/neis-circle')
  need(str(old_edge).startswith('/home/ubuntu/') and
       (old_edge/'main'/'index.ts').is_file(),'ACTIVE_EDGE_INVALID')
  need(str(old_front).startswith('/home/ubuntu/neis-frontend/releases/') and
       (old_front/'index.html').is_file(),'ACTIVE_FRONTEND_INVALID')
  need((old_edge/'study-livekit-token'/'index.ts').is_file(),'ACTIVE_FUNCTIONS_MISSING')
  need((old_front/'scripts/timetable-v147.js').is_file(),'ACTIVE_TIMETABLE_MISSING')
  old_index=(old_front/'index.html').read_text()
  need('scripts/timetable-v147.js' in old_index and '</body>' in old_index
       and '</head>' in old_index and 'scripts/timetable-ai-v1.js' not in old_index,
       'FRONTEND_UNEXPECTED_VERSION')
  previous_front_config=FRONT_OVERLAY.read_text()
  need(previous_front_config.count(str(old_front))==1,'FRONTEND_POINTER_MISMATCH')
  need('timetable-ai' not in (EDGE_OVERLAY.read_text()+previous_front_config),
       'PREVIOUS_AI_OVERLAY_FOUND')
  print('OVH_PRECHECK=PASS_EXISTING_STACK_UNCHANGED')

  # Validate SQL in a rollback-only transaction BEFORE changing any service.
  phase='sql_dryrun'
  quota=(STAGE/'quota.sql').read_text()
  apply=(STAGE/'apply.sql').read_text()
  need('timetable_ai_global_usage' in quota and 'security definer' in quota
       and 'security invoker' in apply and 'Your timetable changed' in apply,
       'SQL_CONTRACT_INVALID')
  pg('BEGIN;\n'+quota+'\n'+apply+'\nROLLBACK;\n')
  print('TIMETABLE_AI_SQL_DRYRUN=PASS_ROLLBACK')

  phase='build'
  # Build two independent immutable release trees. Keep the current Edge main
  # router, current frontend shell and all other features exactly as deployed.
  need(not any(p.is_symlink() for p in old_edge.rglob('*')),'EDGE_SYMLINK_REFUSED')
  need(not any(p.is_symlink() for p in old_front.rglob('*')),'FRONT_SYMLINK_REFUSED')
  shutil.copytree(old_edge,EDGE_RELEASE)
  (EDGE_RELEASE/'timetable-ai').mkdir(exist_ok=False)
  shutil.copy2(STAGE/'ai.ts',EDGE_RELEASE/'timetable-ai'/'index.ts')
  need((EDGE_RELEASE/'main'/'index.ts').read_bytes()==
       (old_edge/'main'/'index.ts').read_bytes(),'EDGE_ROUTER_CHANGED')
  tmp=Path(str(FRONTEND)+'.building')
  need(not tmp.exists(),'FRONTEND_BUILD_EXISTS')
  shutil.copytree(old_front,tmp)
  js=tmp/'scripts/timetable-ai-v1.js'
  css=tmp/'styles/timetable-ai-v1.css'
  js.parent.mkdir(exist_ok=True)
  css.parent.mkdir(exist_ok=True)
  shutil.copy2(STAGE/'ui.js',js)
  shutil.copy2(STAGE/'ui.css',css)
  script='<script defer src="scripts/timetable-ai-v1.js?ttai=20261102v1"></script>'
  style='<link rel="stylesheet" href="styles/timetable-ai-v1.css?ttai=20261102v1">'
  index=old_index.replace('</head>',style+'\n</head>').replace('</body>',script+'\n</body>')
  need(index.count(script)==1 and index.count(style)==1,'INDEX_INSERT_FAILED')
  (tmp/'index.html').write_text(index)
  need(len(list(tmp.rglob('*')))>100 and (tmp/'scripts/timetable-export-png-v1.js').exists(),
       'FRONTEND_COPY_INCOMPLETE')
  tmp.rename(FRONTEND)
  print('IMMUTABLE_RELEASES=STAGED')

  # A private env_file avoids ever serializing the key into a public .js file,
  # Actions logs or the existing production overlay with other integrations.
  overlay=(
     'services:\n  functions:\n'
     '    env_file:\n'
     '      - /home/ubuntu/neis-backups/timetable-ai-20261102-v1/groq.env\n'
     '    volumes:\n'
     '      - type: bind\n'
     '        source: /home/ubuntu/neis-backups/timetable-ai-20261102-v1/edge-functions\n'
     '        target: /home/deno/functions\n'
     '        read_only: true\n'
  )
  NEW_OVERLAY.write_text(overlay)
  NEW_OVERLAY.chmod(0o600)
  p=run(compose(EDGE_STACK)+['config','--format','json'],timeout=50)
  config=json.loads(p.stdout)
  svc=config['services']['functions']
  need(bool(svc.get('environment',{}).get('GROQ_API_KEY')),'KEY_NOT_IN_COMPOSE')
  need(all(svc['environment'].get(k) for k in ('SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY')),
       'ORIGINAL_EDGE_ENV_LOST')
  mounts=[v for v in svc.get('volumes',[]) if v.get('target')=='/home/deno/functions']
  need(len(mounts)==1 and mounts[0]['source']==str(EDGE_RELEASE) and mounts[0].get('read_only') is True,
       'EDGE_MOUNT_INCORRECT')
  run(compose(FRONT_STACK)+['config','--quiet'],timeout=50)
  print('EDGE_COMPOSE_ENV_AND_MOUNTS=VALID_NO_SECRET_OUTPUT')

  phase='database'
  # The only database change is two additive private helper migrations.
  pg('BEGIN;\n'+quota+'\n'+apply+'\nNOTIFY pgrst, '+ "'reload schema'"+';\nCOMMIT;\n')
  check=pg("""select case when
    to_regprocedure('public.consume_timetable_ai_quota()') is not null
    and to_regprocedure('public.apply_timetable_ai_plan(jsonb,jsonb)') is not null
    and not has_table_privilege('anon','public.timetable_ai_usage','SELECT')
    then 'PASS' else 'BLOCKED' end;""").stdout.strip()
  need(check=='PASS','DATABASE_RPC_MISSING')
  print('TIMETABLE_AI_DATABASE=READY_PRIVATE_RLS')

  phase='edge_activate'
  # Recreate only functions service, not database, Caddy, storage or auth.
  edge_active=True
  run(compose(EDGE_STACK)+['up','-d','--no-deps','--force-recreate','functions'],timeout=125)
  time.sleep(4)
  current=inspect('supabase-edge-functions')
  need(current.get('State',{}).get('Running') is True,'EDGE_RESTART_FAILED')
  need(mount(current,'/home/deno/functions')==EDGE_RELEASE,'EDGE_RELEASE_NOT_ACTIVE')
  env={part.split('=',1)[0]:part.split('=',1)[1] for part in
       current['Config'].get('Env',[]) if '=' in part}
  need(bool(env.get('GROQ_API_KEY')),'EDGE_KEY_NOT_APPLIED')
  need('SUPABASE_URL' in env and 'SUPABASE_ANON_KEY' in env,'EDGE_CONFIG_LOST')
  print('TIMETABLE_AI_EDGE=LIVE_WITH_SECRET')

  phase='api_smoke'
  # We do not need a student's JWT for this public negative-auth check.
  # An unauthenticated POST must be rejected, never get a timetable response.
  url='https://supabase.neiscircle.site/functions/v1/timetable-ai'
  req=urllib.request.Request(url,data=b'{"message":"health"}',method='POST',
      headers={'Content-Type':'application/json','Origin':'https://www.neiscircle.site'})
  try:
    with urllib.request.urlopen(req,timeout=12) as res:
      code=res.status
  except urllib.error.HTTPError as e:
    code=e.code
  except Exception:
    raise RuntimeError('AI_PUBLIC_ROUTE_UNREACHABLE')
  need(code in (400,401,403),'AI_PUBLIC_ROUTE_INVALID')
  print('TIMETABLE_AI_NEGATIVE_AUTH_HTTP='+str(code))

  phase='frontend_activate'
  # No replacement from GitHub's maintenance bridge. Only shift the Caddy
  # frontend mount after the Edge code and DB helper RPCs are ready.
  FRONT_OVERLAY.write_text(previous_front_config.replace(str(old_front),str(FRONTEND)))
  frontend_active=True
  run(compose(FRONT_STACK)+['up','-d','--no-deps','caddy'],timeout=115)
  live=inspect('supabase-caddy')
  need(live.get('State',{}).get('Running') is True,'CADDY_RESTART_FAILED')
  need(mount(live,'/srv/neis-circle')==FRONTEND,'FRONTEND_RELEASE_NOT_ACTIVE')
  need((FRONTEND/'index.html').read_text().count(script)==1,'FRONTEND_AI_TAG_MISSING')
  need((FRONTEND/'scripts/timetable-ai-v1.js').stat().st_size>9000,'FRONTEND_AI_JS_MISSING')
  need((FRONTEND/'styles/timetable-ai-v1.css').stat().st_size>2500,'FRONTEND_AI_CSS_MISSING')
  # Preserve existing original timetable and PNG export features.
  need('scripts/timetable-v147.js' in index and
       'scripts/timetable-export-png-v1.js' in index,'TIMETABLE_FEATURE_LOSS')
  print('TIMETABLE_AI_DEPLOY=SUCCESS')
  print('TIMETABLE_AI_FRONTEND=LIVE')
  print('TIMETABLE_AI_EXISTING_FEATURES=PRESERVED')
  print('TIMETABLE_AI_SECRETS=PRIVATE')
  print('TIMETABLE_AI_COST=GROQ_FREE_TIER_ONLY')
if __name__=='__main__':
  try:
    main()
  except Exception as error:
    print('TIMETABLE_AI_DEPLOY=FAILED_'+phase+'_'+(
      str(error) if str(error).isupper() and len(str(error))<70 else 'UNEXPECTED'),
      file=sys.stderr)
    if edge_active or frontend_active:rollback()
    raise SystemExit(1)
