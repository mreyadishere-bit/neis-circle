#!/usr/bin/env python3
"""Guarded Quiz Studio UI + Edge function release without DB mutation or unrelated restarts."""
import copy,hashlib,json,os,pathlib,re,shutil,subprocess,sys,urllib.request,urllib.error,uuid
ROOT=pathlib.Path('/home/ubuntu/neis-supabase')
STAGE=pathlib.Path('/home/ubuntu/neis-backups/neis-quiz-studio-v3-stage')
RELEASES=pathlib.Path('/home/ubuntu/neis-frontend/releases')
FRONT_OVERLAY=ROOT/'docker-compose.frontend-public.yml'
EDGE_OVERLAY=ROOT/'docker-compose.magnus-neis.yml'
BASE=['docker-compose.yml','docker-compose.security.yml','docker-compose.caddy.yml','docker-compose.frontend-public.yml','docker-compose.auth-public-direct.yml']
EXTRA=['docker-compose.edge-integrations.yml','docker-compose.timetable-ai.yml','docker-compose.timetable-ai-gemini.yml','docker-compose.timetable-ai-cloudflare.yml']
DOCKER=['sudo','-n','/usr/bin/docker']
SHA=os.environ.get('GITHUB_SHA','')[:12]
ASSETS={'neis-play-v1.js':'scripts/neis-play-v1.js','neis-play-v1.css':'styles/neis-play-v1.css'}
def check(cond,msg):
 if not cond:raise RuntimeError(msg)
def cmd():return DOCKER+['compose']+[part for f in BASE+[x for x in EXTRA if (ROOT/x).is_file()]+[EDGE_OVERLAY.name] for part in ('-f',f)]
def run(args,stdin=None,timeout=100,required=True):
 p=subprocess.run(args,input=stdin,text=True,capture_output=True,cwd=ROOT,timeout=timeout)
 if p.returncode and required:raise RuntimeError('COMMAND_FAILED_'+str(p.returncode)+':'+p.stderr[-160:])
 return p.stdout
def digest(text):return hashlib.sha256(text.encode()).hexdigest()
def config():return json.loads(run(cmd()+['config','--format','json'],timeout=55))
def active(name,target):
 entry=json.loads(run(DOCKER+['inspect',name],timeout=30))[0]
 check(entry.get('State',{}).get('Running'),'SERVICE_NOT_RUNNING_'+name)
 matches=[pathlib.Path(v['Source']) for v in entry.get('Mounts',[]) if v.get('Type')=='bind' and v.get('Destination')==target]
 check(len(matches)==1 and matches[0].is_dir(),'MOUNT_UNEXPECTED_'+name)
 return matches[0]
def edge_volume(cfg):
 hits=[v for v in cfg['services']['functions'].get('volumes',[]) if v.get('target')=='/home/deno/functions']
 check(len(hits)==1,'EDGE_BIND_MISSING')
 return hits[0]
def compare_config(before,after):
 check(set(before['services'])==set(after['services']),'SERVICES_CHANGED')
 for name,prior in before['services'].items():
  new=after['services'][name]
  if name=='functions':
   a=copy.deepcopy(prior);b=copy.deepcopy(new)
   a['volumes']=[x for x in a.get('volumes',[]) if x.get('target')!='/home/deno/functions']
   b['volumes']=[x for x in b.get('volumes',[]) if x.get('target')!='/home/deno/functions']
   check(a==b,'EDGE_RUNTIME_CHANGED')
  else:check(prior==new,'OTHER_SERVICE_CHANGED_'+name)
def route(name):
 url='https://supabase.neiscircle.site/functions/v1/'+name
 request=urllib.request.Request(url,method='OPTIONS',headers={'Origin':'https://neiscircle.site','Access-Control-Request-Method':'POST'})
 with urllib.request.urlopen(request,timeout=22) as response:check(response.status in (200,204),'ROUTE_OPTIONS_FAILED_'+name)
 request=urllib.request.Request(url,data=b'{}',method='POST',headers={'Authorization':'Bearer invalid','Content-Type':'application/json'})
 try:
  with urllib.request.urlopen(request,timeout=22):raise RuntimeError('UNAUTHENTICATED_REQUEST_ACCEPTED_'+name)
 except urllib.error.HTTPError as error:check(error.code in (401,403),'ROUTE_AUTH_BROKEN_'+name)
def provider_smoke():
 # Requests a minimal quiz question using the key inside Edge, without printing the key or any personal data.
 source=r"""
const key=Deno.env.get('GEMINI_API_KEY');
if(!key)throw new Error('GEMINI_KEY_NOT_PRESENT');
const controller=new AbortController();
const timer=setTimeout(()=>controller.abort(),30000);
try{
 const r=await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent',{
  method:'POST',signal:controller.signal,
  headers:{'x-goog-api-key':key,'content-type':'application/json'},
  body:JSON.stringify({contents:[{parts:[{text:'Return JSON only: {"questions":[{"prompt":"What is 2 + 2?","options":["3","4","5","6"],"correct_index":1,"explanation":"2 + 2 = 4"}]}' }]}],generationConfig:{responseMimeType:'application/json',temperature:0.1,maxOutputTokens:512}})
 });
 if(!r.ok)throw new Error('GEMINI_UPSTREAM_HTTP_'+r.status);
 const json=await r.json();
 const output=(json?.candidates?.[0]?.content?.parts||[]).map(p=>p.text||'').join('');
 const decoded=JSON.parse(output);
 if(!Array.isArray(decoded.questions)||!decoded.questions.length)throw new Error('GEMINI_UPSTREAM_INVALID_JSON');
 console.log('QUIZ_GEMINI_PROVIDER_SMOKE=PASS');
}finally{clearTimeout(timer)}
"""
 output=run(DOCKER+['exec','-i','supabase-edge-functions','deno','run','--allow-env','--allow-net','-'],stdin=source,timeout=55)
 check('QUIZ_GEMINI_PROVIDER_SMOKE=PASS' in output,'GEMINI_PROVIDER_TEST_FAILED')
 print('QUIZ_GEMINI_PROVIDER_SMOKE=PASS')
def main():
 check(bool(re.fullmatch('[a-f0-9]{12}',SHA)),'BAD_REVISION')
 check(STAGE.is_dir() and FRONT_OVERLAY.is_file() and EDGE_OVERLAY.is_file(),'STAGING_OR_OVERLAY_MISSING')
 for p in [*ASSETS,'neis-quiz-ai.ts']:check((STAGE/p).is_file(),'MISSING_SOURCE_'+p)
 for name in ('neis-play-v1.js',):run(['node','--check',str(STAGE/name)],timeout=25)
 js=(STAGE/'neis-play-v1.js').read_text()
 css=(STAGE/'neis-play-v1.css').read_text()
 edge_code=(STAGE/'neis-quiz-ai.ts').read_text()
 check('pendingInviteCode()' in js and 'quiz-review' in js and 'neis-studio-v3' in js,'QUIZ_FRONTEND_INCOMPLETE')
 check('.neis-studio-v3' in css,'QUIZ_STYLE_MISSING')
 check('client.auth.getUser(jwt)' in edge_code and 'neis_quiz_ai_claim' in edge_code,'EDGE_AUTH_MISSING')
 run(cmd()+['config','--quiet'],timeout=55)
 before=config()
 old_edge=active('supabase-edge-functions','/home/deno/functions')
 check(old_edge==pathlib.Path(edge_volume(before)['source']),'EDGE_CONFIG_MOUNT_MISMATCH')
 check((old_edge/'magnus-chat/index.ts').is_file() and (old_edge/'neis-quiz-ai/index.ts').is_file(),'EDGE_FUNCTIONS_INCOMPLETE')
 old_front=active('supabase-caddy','/srv/neis-circle')
 check(old_front.parent==RELEASES,'FRONT_RELEASE_UNEXPECTED')
 old_html=(old_front/'index.html').read_text()
 check(all(old_html.count(p)==1 for p in ASSETS.values()),'FRONTEND_INDEX_BAD')
 check('scripts/data-coordinator-v171.js' in old_html,'CORE_RUNTIME_MISSING')
 original_edge_overlay=EDGE_OVERLAY.read_text()
 original_front_overlay=FRONT_OVERLAY.read_text()
 check(original_front_overlay.count(str(old_front))==1,'FRONT_OVERLAY_CHANGED')
 check(edge_volume(before).get('type')=='bind' and edge_volume(before).get('read_only') is True,'EDGE_VOLUME_UNSAFE')
 # Existing schema only. No student tables or data are edited.
 sql="select (to_regclass('public.neis_quizzes') is not null and to_regprocedure('public.neis_quiz_add_question(uuid,text,jsonb,integer,text)') is not null and to_regprocedure('public.neis_quiz_ai_claim()') is not null);"
 schema=run(DOCKER+['exec','-i','supabase-db','psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-Atq'],stdin=sql,timeout=35)
 check(schema.strip()=='t','QUIZ_DATABASE_FUNCTIONS_MISSING')
 if '--dry-run' in sys.argv:
  print('QUIZ_STUDIO_PREFLIGHT=PASS')
  return
 suffix=SHA+'-'+uuid.uuid4().hex[:6]
 edge_dest=pathlib.Path('/home/ubuntu/neis-backups/quiz-studio-edge-'+suffix)
 edge_build=pathlib.Path(str(edge_dest)+'.building')
 check(not edge_dest.exists() and not edge_build.exists(),'EDGE_RELEASE_EXISTS')
 shutil.copytree(old_edge,edge_build)
 shutil.copy2(STAGE/'neis-quiz-ai.ts',edge_build/'neis-quiz-ai/index.ts')
 edge_build.rename(edge_dest)
 volume=copy.deepcopy(edge_volume(before));volume['source']=str(edge_dest)
 next_overlay='services:\n  functions:\n    volumes:\n      - '+json.dumps(volume,separators=(',',':'))+'\n'
 edge_switched=False;front_switched=False
 try:
  EDGE_OVERLAY.write_text(next_overlay);edge_switched=True
  compare_config(before,config())
  run(cmd()+['up','-d','--no-deps','--force-recreate','functions'],timeout=155)
  check(active('supabase-edge-functions','/home/deno/functions')==edge_dest,'EDGE_NEW_MOUNT_MISSING')
  route('neis-quiz-ai');route('magnus-chat')
  print('QUIZ_STUDIO_EDGE_ROUTE=VERIFIED')
  provider_smoke()
  # Build from currently running frontend, retaining all previous hotfixes.
  current=active('supabase-caddy','/srv/neis-circle')
  check(current==old_front,'FRONT_UPDATED_DURING_DEPLOY')
  release=RELEASES/('quiz-studio-v3-'+suffix)
  building=pathlib.Path(str(release)+'.building')
  check(not release.exists() and not building.exists(),'FRONT_RELEASE_EXISTS')
  count=sum(p.is_file() for p in current.rglob('*'))
  check(count>100,'FRONT_TOO_SMALL')
  shutil.copytree(current,building)
  html=(current/'index.html').read_text()
  for name,target in ASSETS.items():
   shutil.copy2(STAGE/name,building/target)
   html,n=re.subn('('+re.escape(target)+r')(?:\?[^"\s]*)?',lambda m:m.group(1)+'?v=quiz-v3-'+SHA,html,count=1)
   check(n==1,'CACHE_KEY_MISSING_'+target)
  (building/'index.html').write_text(html)
  check(html.index('scripts/neis-play-v1.js')<html.index('scripts/data-coordinator-v171.js'),'LOAD_ORDER_BROKEN')
  check(sum(p.is_file() for p in building.rglob('*'))==count,'FILES_REMOVED')
  building.rename(release)
  FRONT_OVERLAY.write_text(original_front_overlay.replace(str(old_front),str(release),1));front_switched=True
  run(cmd()+['config','--quiet'],timeout=55)
  run(cmd()+['up','-d','--no-deps','caddy'],timeout=155)
  check(active('supabase-caddy','/srv/neis-circle')==release,'LIVE_FRONT_MOUNT_WRONG')
  cid=run(cmd()+['ps','-q','caddy'],timeout=30).strip()
  check(bool(cid),'CADDY_NOT_FOUND')
  live_index=run(DOCKER+['exec',cid,'cat','/srv/neis-circle/index.html'],timeout=25)
  for name,path in ASSETS.items():
   live=run(DOCKER+['exec',cid,'cat','/srv/neis-circle/'+path],timeout=35)
   check(digest(live)==digest((release/path).read_text()),'LIVE_ASSET_MISMATCH_'+path)
   check(path+'?v=quiz-v3-'+SHA in live_index,'LIVE_CACHE_MISMATCH_'+path)
  caddy=run(DOCKER+['exec',cid,'cat','/etc/caddy/Caddyfile'],timeout=25)
  check(all(x in caddy for x in ('reverse_proxy rest:3000','reverse_proxy auth:9999','basic_auth')),'PROXY_CHANGED')
 except Exception:
  if front_switched:
   FRONT_OVERLAY.write_text(original_front_overlay)
   run(cmd()+['up','-d','--no-deps','caddy'],timeout=130,required=False)
   print('QUIZ_FRONTEND=ROLLED_BACK')
  if edge_switched:
   EDGE_OVERLAY.write_text(original_edge_overlay)
   run(cmd()+['up','-d','--no-deps','--force-recreate','functions'],timeout=150,required=False)
   print('QUIZ_EDGE=ROLLED_BACK')
  raise
 print('QUIZ_STUDIO=DEPLOYED_AND_VERIFIED')
 print('QUIZ_DB=UNCHANGED')
 print('UNRELATED_SERVICES=UNCHANGED')
 print('QUIZ_STUDIO_RELEASE='+SHA)
if __name__=='__main__':
 try:main()
 except Exception as ex:
  print('QUIZ_STUDIO_RELEASE=FAILED_'+str(ex)[:220],file=sys.stderr)
  sys.exit(1)
