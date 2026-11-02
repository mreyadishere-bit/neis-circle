#!/usr/bin/env python3
"""Read-only OVH timetable AI deployment preflight. Print metadata only."""
from pathlib import Path
import json, subprocess, sys
ROOT=Path('/home/ubuntu/neis-supabase')
DOCKER=['sudo','-n','/usr/bin/docker']
def run(args,timeout=35):
    return subprocess.run(args,capture_output=True,text=True,timeout=timeout,cwd=ROOT)
def check(ok,label):
    print(label+'='+('PASS' if ok else 'BLOCKED'))
    return ok
good=True
def require(ok,label):
    global good
    good=check(ok,label) and good
require(ROOT.is_dir(),"OVH_ROOT")
front=ROOT/'docker-compose.frontend-public.yml'
edge=ROOT/'docker-compose.edge-integrations.yml'
require(front.is_file() and edge.is_file(),"OVH_OVERLAYS")
require(edge.is_file() and edge.stat().st_mode & 0o777 == 0o600,"OVH_EDGE_PRIVATE_PERMISSIONS")
c=run(DOCKER+['inspect','supabase-edge-functions','supabase-caddy'])
info=[]
if c.returncode==0:
    try:info=json.loads(c.stdout)
    except Exception:pass
functions=next((x for x in info if x.get('Name')=='/supabase-edge-functions'),{})
caddy=next((x for x in info if x.get('Name')=='/supabase-caddy'),{})
require(functions.get('State',{}).get('Running') is True,"EDGE_RUNNING")
require(caddy.get('State',{}).get('Running') is True,"CADDY_RUNNING")
def mounted(dockerinfo,dest):
    hits=[m.get('Source','') for m in dockerinfo.get('Mounts',[])
          if m.get('Type')=='bind' and m.get('Destination')==dest]
    return Path(hits[0]) if len(hits)==1 else None
edge_mount=mounted(functions,'/home/deno/functions')
front_mount=mounted(caddy,'/srv/neis-circle')
require(edge_mount is not None and str(edge_mount).startswith('/home/ubuntu/'),"EDGE_MOUNT")
require(front_mount is not None and str(front_mount).startswith('/home/ubuntu/neis-frontend/releases/'),"FRONTEND_RELEASE_MOUNT")
if edge_mount:
    require((edge_mount/'main'/'index.ts').is_file(),"EDGE_ROUTER")
    for name in ('send-web-push','study-livekit-token'):
        require((edge_mount/name/'index.ts').is_file(),"EDGE_EXISTING_"+name.upper().replace('-','_'))
    main=(edge_mount/'main'/'index.ts').read_text() if (edge_mount/'main'/'index.ts').is_file() else ''
    print("EDGE_ROUTER_STRATEGY="+('DYNAMIC' if ('serve' in main or 'from' in main) else 'REVIEW'))
if front_mount:
    html=(front_mount/'index.html').read_text() if (front_mount/'index.html').is_file() else ''
    require('scripts/timetable-v147.js' in html and '</body>' in html,"FRONTEND_TIMETABLE")
    require('scripts/timetable-ai-v1.js' not in html,"NOT_ALREADY_DEPLOYED")
    print("FRONTEND_FILES_APPROX="+str(sum(1 for f in front_mount.rglob('*') if f.is_file())))
    print("FRONTEND_HAS_PNG="+str('timetable-export-png-v1.js' in html).lower())
require('functions:' in edge.read_text() if edge.is_file() else False,"EDGE_OVERLAY_SERVICE")
if functions:
    names={s.split('=',1)[0] for s in functions.get('Config',{}).get('Env',[]) if '=' in s}
    require({'SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY'}<=names,"EDGE_REQUIRED_ENV")
    print("EDGE_KEY_ALREADY_PRESENT="+str('GROQ_API_KEY' in names).lower())
if all((ROOT/f).is_file() for f in ('docker-compose.yml','docker-compose.security.yml','docker-compose.caddy.yml')):
    compose=DOCKER+['compose']
    for f in ('docker-compose.yml','docker-compose.security.yml','docker-compose.caddy.yml'):
        compose+=['-f',f]
    r=run(compose+['exec','-T','db','psql','-X','-U','postgres','-d','postgres','-Atqc',
        "select case when to_regclass('public.user_timetable_entries') is not null then 'YES' else 'NO' end;"])
    require(r.returncode==0 and r.stdout.strip()=='YES',"DATABASE_TIMETABLE")
else:require(False,"COMPOSE_BASE_FILES")
print("TIMETABLE_AI_PREFLIGHT="+("PASS" if good else "BLOCKED"))
sys.exit(0 if good else 1)
