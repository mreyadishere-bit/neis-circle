#!/usr/bin/env python3
"""Atomic NEIS Play database bootstrap plus immutable, rollback-protected frontend release.
Only new tables/functions/assets are added; the existing application remains untouched.
"""
from pathlib import Path
import hashlib,json,os,re,shutil,subprocess,sys

ROOT=Path('/home/ubuntu/neis-supabase')
STAGE=Path('/home/ubuntu/neis-backups/neis-play-v1-stage')
RELEASES=Path('/home/ubuntu/neis-frontend/releases')
OVERLAY=ROOT/'docker-compose.frontend-public.yml'
DOCKER=['sudo','-n','/usr/bin/docker']
COMPOSE=DOCKER+['compose']+[v for f in (
 'docker-compose.yml','docker-compose.security.yml','docker-compose.caddy.yml',
 'docker-compose.frontend-public.yml','docker-compose.auth-public-direct.yml'
) for v in ('-f',f)]
ASSETS={
 'neis-play-v1.js':'scripts/neis-play-v1.js',
 'neis-play-v1.css':'styles/neis-play-v1.css',
}
MARKER='20261103-neis-play-beta'
def check(value,code):
 if not value:raise RuntimeError(code)
def run(args,stdin=None,timeout=100,require=True):
 p=subprocess.run(args,cwd=ROOT,input=stdin,text=True,capture_output=True,timeout=timeout)
 if p.returncode and require: raise RuntimeError('COMMAND_FAILED:'+str(p.returncode)+':'+str(p.stderr)[-200:])
 return p.stdout
def db(sql,timeout=140):
 return run(DOCKER+['exec','-i','supabase-db','psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-Atq'],stdin=sql,timeout=timeout)
def digest(text):return hashlib.sha256(text.encode('utf-8')).hexdigest()
def active_frontend():
 info=json.loads(run(DOCKER+['inspect','supabase-caddy'],timeout=30))[0]
 mounts=[Path(x['Source']) for x in info.get('Mounts',[]) if x.get('Type')=='bind' and x.get('Destination')=='/srv/neis-circle']
 check(len(mounts)==1 and mounts[0].is_dir(),'FRONTEND_BIND_MISSING')
 check(info.get('State',{}).get('Running'),'CADDY_NOT_RUNNING')
 return mounts[0]
def test_database(sql):
 # Nothing in this test survives. Existing tables, messages and student accounts are untouched.
 witness=(
  "select case when to_regclass('public.neis_play_rooms') is not null "
  "and to_regclass('public.neis_play_decks') is not null "
  "and to_regclass('public.neis_play_daily_keys') is not null "
  "and to_regprocedure('public.neis_play_create_room(text,text,uuid,jsonb)') is not null "
  "and to_regprocedure('public.neis_play_room_snapshot(uuid,bigint)') is not null "
  "then 'NEIS_PLAY_SQL_DRY_RUN=PASS' else 'NEIS_PLAY_SQL_DRY_RUN=FAIL' end;"
 )
 output=db('begin;\n'+sql+'\n'+witness+'\nrollback;\n')
 check('NEIS_PLAY_SQL_DRY_RUN=PASS' in output,'SQL_DRY_RUN_FAILED')
 print('NEIS_PLAY_SQL_DRY_RUN=PASS')
def main():
 check(OVERLAY.is_file() and STAGE.is_dir() and RELEASES.is_dir(),'STAGING_MISSING')
 sources={}
 for name,path in ASSETS.items():
  p=STAGE/name
  check(p.is_file() and p.stat().st_size>100,'ASSET_MISSING_'+name)
  sources[path]=p.read_text()
 sql_file=STAGE/'migration.sql'
 check(sql_file.is_file(),'SQL_MISSING')
 sql=sql_file.read_text()
 check('neis_play_answer_daily' in sql and 'neis_play_room_snapshot' in sql and
       'neis_play_create_championship' in sql and 'neis_play_daily_keys' in sql,
       'MIGRATION_INCOMPLETE')
 check("room_members_only" in sql and "security definer" in sql.lower(),
       'MIGRATION_SECURITY_MISSING')
 js=sources['scripts/neis-play-v1.js']
 check('window.NEISPlay=' in js and 'data-neis-play-open' in js and 'neis_play_room_snapshot' in js,
       'FRONTEND_MODULE_INVALID')
 run(['node','--check',str(STAGE/'neis-play-v1.js')],timeout=20)
 run(COMPOSE+['config','--quiet'],timeout=50)
 # Check all migration SQL in rolled-back PostgreSQL transaction before touching production.
 exists=db("select to_regclass('public.neis_play_rooms') is not null;").strip()
 check(exists in ('t','f'),'DB_UNKNOWN_STATE')
 if exists=='f': test_database(sql)
 else:
  check(db("select to_regclass('public.neis_play_championships') is not null;").strip()=='t','PARTIAL_DATABASE_INSTALL')
  print('NEIS_PLAY_DB=ALREADY_PRESENT')
 if '--dry-run' in sys.argv:
  if exists=='t':
   auth=STAGE/'auth-smoke.py'
   check(auth.is_file(),'AUTH_SMOKE_SCRIPT_MISSING')
   run(['python3',str(auth)],timeout=90)
   print('NEIS_PLAY_AUTH_SMOKE_PREFLIGHT=PASS')
  print('NEIS_PLAY_PREFLIGHT=PASS')
  return
 if exists=='f':
  # DDL transaction is atomic. A failed migration rolls back in full.
  db('begin;\n'+sql+'\ncommit;\n',timeout=180)
  check(db("select to_regclass('public.neis_play_rooms') is not null;").strip()=='t','MIGRATION_NOT_APPLIED')
  print('NEIS_PLAY_DB=INSTALLED')
 auth=STAGE/'auth-smoke.py'
 check(auth.is_file(),'AUTH_SMOKE_SCRIPT_MISSING')
 run(['python3',str(auth)],timeout=90)
 print('NEIS_PLAY_AUTH_SMOKE=PASS')
 old=active_frontend()
 check(old.parent==RELEASES,'UNEXPECTED_LIVE_RELEASE')
 overlay=OVERLAY.read_text()
 check(overlay.count(str(old))==1,'LIVE_OVERLAY_CHANGED')
 current=(old/'index.html').read_text()
 check(current.count('</head>')==1 and current.count('</body>')==1 and
       'scripts/01-core.js' in current and 'scripts/05-social.js' in current and
       'scripts/04-permissions-ux.js' in current,'ACTIVE_INDEX_UNEXPECTED')
 count=sum(p.is_file() for p in old.rglob('*'))
 check(count>100,'LIVE_RELEASE_INCOMPLETE')
 revision=os.environ.get('GITHUB_SHA','')[:12]
 check(bool(re.fullmatch('[0-9a-f]{12}',revision)),'INVALID_REVISION')
 version=MARKER+'-'+revision
 release=RELEASES/('neis-play-v1-'+revision)
 building=Path(str(release)+'.building')
 check(not release.exists() and not building.exists(),'RELEASE_ALREADY_EXISTS')
 shutil.copytree(old,building)
 for path,contents in sources.items():
  target=building/path
  target.parent.mkdir(exist_ok=True,parents=True)
  target.write_text(contents)
 index=current
 if 'styles/neis-play-v1.css' not in index:
  index=index.replace('</head>',f'  <link rel="stylesheet" href="styles/neis-play-v1.css?v={version}">\n</head>')
 else:index=re.sub(r'(styles/neis-play-v1\.css)(?:\?[^"\s]*)?',lambda m:m.group(1)+'?v='+version,index,count=1)
 if 'scripts/neis-play-v1.js' not in index:
  index=index.replace('</body>',f'  <script src="scripts/neis-play-v1.js?v={version}" defer></script>\n</body>')
 else:index=re.sub(r'(scripts/neis-play-v1\.js)(?:\?[^"\s]*)?',lambda m:m.group(1)+'?v='+version,index,count=1)
 (building/'index.html').write_text(index)
 check(index.count('scripts/neis-play-v1.js')==1 and
       index.count('styles/neis-play-v1.css')==1,'DUPLICATE_ASSETS')
 check(sum(p.is_file() for p in building.rglob('*'))==count+
       sum(1 for path in ASSETS.values() if not (old/path).exists()),'FILES_CHANGED')
 for path,contents in sources.items():check(digest((building/path).read_text())==digest(contents),'ASSET_COPY_FAILED')
 building.rename(release)
 switched=False
 try:
  OVERLAY.write_text(overlay.replace(str(old),str(release),1));switched=True
  run(COMPOSE+['config','--quiet'],timeout=50)
  run(COMPOSE+['up','-d','--no-deps','caddy'],timeout=150)
  live=active_frontend()
  check(live==release,'FRONTEND_NOT_MOUNTED')
  cid=run(COMPOSE+['ps','-q','caddy'],timeout=30).strip()
  check(bool(cid),'CADDY_MISSING')
  live_index=run(DOCKER+['exec',cid,'cat','/srv/neis-circle/index.html'],timeout=30)
  check('scripts/neis-play-v1.js?v='+MARKER in live_index and
        'styles/neis-play-v1.css?v='+MARKER in live_index,'LIVE_INDEX_MISMATCH')
  for path,contents in sources.items():
   actual=run(DOCKER+['exec',cid,'cat','/srv/neis-circle/'+path],timeout=30)
   check(digest(actual)==digest(contents),'LIVE_ASSET_MISMATCH')
  config=run(DOCKER+['exec',cid,'cat','/etc/caddy/Caddyfile'],timeout=30)
  check(all(x in config for x in ('reverse_proxy rest:3000','reverse_proxy auth:9999','basic_auth')),'AUTH_PROXY_CHANGED')
 except Exception:
  if switched:
   OVERLAY.write_text(overlay)
   run(COMPOSE+['up','-d','--no-deps','caddy'],timeout=130,require=False)
   print('NEIS_PLAY_FRONTEND=ROLLED_BACK')
  raise
 print('NEIS_PLAY_FRONTEND=DEPLOYED_AND_VERIFIED')
 print('NEIS_PLAY_OTHER_SERVICES=UNCHANGED')
 print('NEIS_PLAY_RELEASE='+revision)

if __name__=='__main__':
 try:main()
 except Exception as exc:
  print('NEIS_PLAY_DEPLOY=FAILED_'+str(exc)[:170],file=sys.stderr)
  sys.exit(1)
