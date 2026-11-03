#!/usr/bin/env python3
"""Apply Circle chat moderation RPCs, patch only related live UI functions.
No user messages are deleted during deployment; immutable frontend rollback.
"""
import json,os,pathlib,re,shutil,subprocess,sys,uuid
ROOT=pathlib.Path('/home/ubuntu/neis-supabase')
STAGE=pathlib.Path('/home/ubuntu/neis-backups/circle-message-actions-20261103')
RELEASES=pathlib.Path('/home/ubuntu/neis-frontend/releases')
FRONT_OVERLAY=ROOT/'docker-compose.frontend-public.yml'
DOCKER=['sudo','-n','/usr/bin/docker']
COMPOSE=DOCKER+['compose']
for f in ('docker-compose.yml','docker-compose.security.yml','docker-compose.caddy.yml',
          'docker-compose.frontend-public.yml','docker-compose.auth-public-direct.yml'):
 COMPOSE.extend(['-f',f])
REV=uuid.uuid4().hex[:14]
def ensure(ok,reason):
 if not ok:raise RuntimeError(reason)
def run(args,input=None,timeout=85,check=True):
 r=subprocess.run(args,cwd=ROOT,input=input,text=True,capture_output=True,timeout=timeout)
 if check and r.returncode:raise RuntimeError('COMMAND_FAILED_'+str(r.returncode))
 return r.stdout
def db(sql):
 return run(DOCKER+['exec','-i','supabase-db','psql','-X','-v','ON_ERROR_STOP=1',
                   '-U','postgres','-d','postgres','-q'],input=sql,timeout=65)
def mounted(container,target):
 info=json.loads(run(DOCKER+['inspect',container]))[0]
 ensure(info.get('State',{}).get('Running'),'SERVICE_NOT_RUNNING')
 sources=[m['Source'] for m in info['Mounts'] if m.get('Type')=='bind' and m.get('Destination')==target]
 ensure(len(sources)==1,'MOUNT_NOT_FOUND')
 return pathlib.Path(sources[0])
def replace_segment(source,upstream,begin,end):
 a=source.find(begin);b=source.find(end,a+len(begin))
 x=upstream.find(begin);y=upstream.find(end,x+len(begin))
 ensure(min(a,b,x,y)>=0,'SOURCE_ANCHOR_MISMATCH_'+begin[:28])
 return source[:a]+upstream[x:y]+source[b:]
def main():
 ensure(STAGE.is_dir() and FRONT_OVERLAY.is_file(),'STAGING_MISSING')
 sql=(STAGE/'schema.sql').read_text()
 staged=(STAGE/'social.js').read_text()
 ensure('neis_circle_delete_message' in sql and
        "data-remove-my-message-reaction" in staged,'INVALID_INPUT')
 run(['node','--check',str(STAGE/'social.js')],timeout=20)
 filtered=[line for line in sql.splitlines() if line.strip().lower() not in ('begin;','commit;')
           and not line.lower().startswith('notify pgrst')]
 db('begin;\n'+'\n'.join(filtered)+'\nrollback;')
 print('CIRCLE_MESSAGE_DATABASE_DRY_RUN=PASS')
 run(COMPOSE+['config','--quiet'])
 previous=mounted('supabase-caddy','/srv/neis-circle')
 ensure(previous.parent==RELEASES,'UNEXPECTED_RELEASE')
 original=FRONT_OVERLAY.read_text()
 ensure(original.count(str(previous))==1,'ACTIVE_FRONTEND_CONFIG_CHANGED')
 live=(previous/'scripts/05-social.js').read_text()
 patches=[
  ('function openMessageReactionDetails(', 'function bindMessageReactionButtons('),
  ('async function deleteCircleMessage(', 'async function deleteDirectMessage('),
  ('  editMessage(scope,id){','  reactMessage(scope,id){'),
  ('window.neisDeleteMessageNow=async(', '/* v102 — inline delete bridge'),
 ]
 for begin,end in patches:
  live=replace_segment(live,staged,begin,end)
 ensure('neis_circle_edit_message' in live and
  'data-remove-my-message-reaction' in live and
  "sb.rpc('neis_circle_delete_message'" in live,'LIVE_PATCH_VALIDATION_FAILED')
 db(sql)
 print('CIRCLE_MESSAGE_DATABASE_MIGRATION=SUCCESS')
 destination=RELEASES/('circle-action-repair-'+REV)
 tmp=pathlib.Path(str(destination)+'.building')
 ensure(not tmp.exists() and not destination.exists(),'RELEASE_EXISTS')
 shutil.copytree(previous,tmp)
 target=tmp/'scripts/05-social.js'
 target.write_text(live)
 run(['node','--check',str(target)],timeout=20)
 html=(tmp/'index.html').read_text()
 ensure('scripts/05-social.js' in html,'INDEX_SOCIAL_SCRIPT_MISSING')
 html,count=re.subn(r'(scripts/05-social[.]js)(?:[?][^"\\s]*)?',
  lambda m:m.group(1)+'?v=circle-actions-'+REV,html,count=1)
 ensure(count==1,'INDEX_SCRIPT_VERSION_FAILURE')
 (tmp/'index.html').write_text(html)
 tmp.rename(destination)
 changed=False
 try:
  FRONT_OVERLAY.write_text(original.replace(str(previous),str(destination),1));changed=True
  run(COMPOSE+['config','--quiet'])
  run(COMPOSE+['up','-d','--no-deps','caddy'],timeout=120)
  active=mounted('supabase-caddy','/srv/neis-circle')
  ensure(active==destination,'LIVE_FRONTEND_NOT_UPDATED')
  deployed=(active/'scripts/05-social.js').read_text()
  ensure('neis_circle_edit_message' in deployed and
   'data-remove-my-message-reaction' in deployed,'LIVE_ASSETS_MISMATCH')
 except Exception:
  if changed:
   FRONT_OVERLAY.write_text(original)
   run(COMPOSE+['up','-d','--no-deps','caddy'],timeout=120,check=False)
  raise
 print('CIRCLE_MESSAGE_FRONTEND=DEPLOYED')
 print('REACTION_REMOVAL_UI=DEPLOYED')
 print('CIRCLE_MESSAGE_ACTIONS_RELEASE='+REV)
if __name__=='__main__':
 try:main()
 except Exception as exc:
  print('CIRCLE_CHAT_FIX_DEPLOY_FAILED_'+str(exc)[:100],file=sys.stderr)
  raise SystemExit(1)
