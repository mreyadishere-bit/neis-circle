#!/usr/bin/env python3
"""Authorize live Storage user to write staged VERSIONED media. Production untouched."""
import json,subprocess
from pathlib import Path
root=Path('/home/ubuntu/neis-supabase')
stage=Path('/home/ubuntu/neis-backups/storage-versioned-release-20261010/files')
if not stage.is_dir() or stage.is_symlink() or not stage.parent.is_dir():
 raise SystemExit('VERSIONED_PERMISSIONS=BLOCKED_STAGE')
if stage.parent.stat().st_mode & 0o077:
 raise SystemExit('VERSIONED_PERMISSIONS=BLOCKED_PRIVATE_PARENT_REQUIRED')
docker=['sudo','-n','/usr/bin/docker']
base=docker+['compose','-f','docker-compose.yml','-f','docker-compose.security.yml','-f','docker-compose.caddy.yml']
def run(args,stdin=None,timeout=65):
 return subprocess.run(args,cwd=str(root),capture_output=True,text=True,input=stdin,timeout=timeout)
a=run(base+['ps','-q','storage'])
if a.returncode or not a.stdout.strip():raise SystemExit('VERSIONED_PERMISSIONS=BLOCKED_SERVICE')
ins=run(docker+['inspect','--format','{{json .}}',a.stdout.strip()])
if ins.returncode:raise SystemExit('VERSIONED_PERMISSIONS=BLOCKED_INSPECT')
config=json.loads(ins.stdout)['Config']
image=config['Image']
user=config.get('User','')
chmod=r"""
const fs=require('node:fs'),path=require('node:path');
const root='/dest';let files=0,dirs=0;
function walk(p){
 const stat=fs.lstatSync(p);
 if(stat.isSymbolicLink())throw Error('symlink forbidden');
 if(stat.isDirectory()){
  fs.chmodSync(p,0o777);dirs++;
  for(const n of fs.readdirSync(p))walk(path.join(p,n));
 }else if(stat.isFile()){files++}
 else throw Error('unsupported inode');
}
walk(root);
if(files!==104)throw Error('wrong file count');
console.log('VERSIONED_CHMOD_DIRECTORIES='+dirs);
console.log('VERSIONED_CHMOD_FILE_COUNT='+files);
"""
opts=['--rm','--network','none','--pull','never','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges']
p=run(docker+['run',*opts,'--user','0','-v',str(stage)+':/dest:rw','--entrypoint','node',image,'-e',chmod],timeout=70)
if p.returncode or 'VERSIONED_CHMOD_FILE_COUNT=104' not in p.stdout:
 print('VERSIONED_PERMISSIONS=FAILED_PRIVATE_STAGE_ONLY')
 raise SystemExit(1)
for line in p.stdout.splitlines():
 if line.startswith(('VERSIONED_CHMOD_DIRECTORIES=','VERSIONED_CHMOD_FILE_COUNT=')):print(line)
canary=r"""
const fs=require('node:fs');
const p='/var/lib/storage/.neis-stage-access-test';
try{
 fs.writeFileSync(p,'check',{flag:'wx',mode:0o600});
 fs.unlinkSync(p);
 console.log('VERSIONED_RUNTIME_RW=PASS');
}catch(e){
 try{if(fs.existsSync(p))fs.unlinkSync(p)}catch(_){}
 console.log('VERSIONED_RUNTIME_RW=DENIED');
 process.exitCode=1;
}
"""
cmd=docker+['run',*opts,'-v',str(stage)+':/var/lib/storage:rw']
if user:cmd+=['--user',user]
cmd+=['--entrypoint','node',image,'-e',canary]
q=run(cmd,timeout=70)
if q.returncode or 'VERSIONED_RUNTIME_RW=PASS' not in q.stdout:
 print('VERSIONED_RUNTIME_RW=FAILED')
 raise SystemExit(1)
print('VERSIONED_RUNTIME_RW=PASS')
print('VERSIONED_PERMISSIONS=READY_PRIVATE_STAGE_ONLY')
print('STORAGE_PRODUCTION_SERVICE=UNCHANGED')
