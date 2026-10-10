#!/usr/bin/env python3
"""Read-only Storage image/config layout audit; no environment values except public file path."""
import json,subprocess,re
from pathlib import Path
root='/home/ubuntu/neis-supabase'
docker=['sudo','-n','/usr/bin/docker']
compose=docker+['compose','-f','docker-compose.yml','-f','docker-compose.security.yml','-f','docker-compose.caddy.yml']
def run(command,stdin=None):
 return subprocess.run(command,cwd=root,capture_output=True,text=True,input=stdin,timeout=40)
p=run(compose+['ps','-q','storage'])
if p.returncode or not p.stdout.strip():raise SystemExit('LAYOUT_IMAGE=STORAGE_CONTAINER_MISSING')
r=run(docker+['inspect','--format','{{json .}}',p.stdout.strip()])
if r.returncode:raise SystemExit('LAYOUT_IMAGE=INSPECT_FAILED')
j=json.loads(r.stdout)
config=j['Config']
image=config.get('Image','')
print('STORAGE_IMAGE_VERSION_TAG='+('SEMVER_TAG' if re.search(r':v\d+\.\d+',image) else 'UNVERSIONED_OR_HASH'))
if re.search(r':v\d+\.\d+\.\d+',image):
 print('STORAGE_IMAGE_SEMVER='+re.search(r':(v\d+\.\d+\.\d+)',image).group(1))
print('STORAGE_IMAGE_USER_CONFIGURED='+str(bool(config.get('User'))).upper())
print('STORAGE_IMAGE_WORKDIR_PRESENT='+str(bool(config.get('WorkingDir'))).upper())
env=dict(x.split('=',1) for x in config.get('Env',[]) if '=' in x)
for key in ('FILE_STORAGE_BACKEND_PATH','STORAGE_FILE_BACKEND_PATH','STORAGE_FILE_ETAG_ALGORITHM','STORAGE_BACKEND'):
 val=env.get(key,'')
 kind='ABSOLUTE' if val.startswith('/') else 'MISSING' if not val else 'RELATIVE_OR_ENUM'
 if key=='STORAGE_BACKEND':kind='LOCAL_FILE' if val=='file' else 'OTHER'
 print('CONFIG_'+key+'_CLASS='+kind)
script=r"""
const fs=require('node:fs'),path=require('node:path');
const roots=['/app','/usr/src/app','/home/node/app','/opt/app'];
for(const root of roots){
 if(!fs.existsSync(root))continue;
 let files=0,matched=0,oldLayout=0,newLayout=0;
 function check(dir,depth){
  if(depth>5||files>25000)return;
  let entries;
  try{entries=fs.readdirSync(dir,{withFileTypes:true})}catch{return}
  for(const x of entries){
   const p=path.join(dir,x.name);
   if(x.isDirectory() && x.name!=='node_modules')check(p,depth+1);
   else if(x.isFile()&&/\.(?:js|cjs|mjs)$/.test(x.name)){
    files++;
    if(!(/storage|backend|file/i.test(p)))continue;
    let text='';
    try{text=fs.readFileSync(p,'utf8')}catch{continue}
    if(text.includes('withOptionalVersion')||text.includes('storageFilePath')){
     matched++;
     if(text.includes('data/')||text.includes("'/data'"))newLayout++;
     if(text.includes('FILE_STORAGE_BACKEND_PATH')||text.includes('withOptionalVersion'))oldLayout++;
    }
   }
  }
 }
 check(root,0);
 console.log('RUNTIME_APP_ROOT_FOUND=YES');
 console.log('RUNTIME_BACKEND_CODE_CANDIDATES='+matched);
 console.log('RUNTIME_BACKEND_DATA_PREFIX_REFERENCES='+newLayout);
 console.log('RUNTIME_BACKEND_VERSION_REFERENCES='+oldLayout);
 break;
}
"""
args=docker+['run','--rm','--network','none','--pull','never','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--entrypoint','node',image,'-e',script]
q=run(args)
if q.returncode:print('STORAGE_IMAGE_CODE_PROBE=UNAVAILABLE')
else:
 for line in q.stdout.splitlines():
  if line.startswith(('RUNTIME_APP_ROOT_FOUND=','RUNTIME_BACKEND_CODE_CANDIDATES=','RUNTIME_BACKEND_DATA_PREFIX_REFERENCES=','RUNTIME_BACKEND_VERSION_REFERENCES=')):print(line)
print('LAYOUT_IMAGE=READ_ONLY_NO_APPLICATION_DATA')
