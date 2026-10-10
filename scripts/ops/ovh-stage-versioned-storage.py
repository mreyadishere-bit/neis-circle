#!/usr/bin/env python3
"""Build an isolated version-addressed Storage snapshot; never touch live media mounts."""
import json
import os
import subprocess
from pathlib import Path
root=Path('/home/ubuntu/neis-supabase')
source=Path('/home/ubuntu/neis-backups/storage-runtime-release-20261010/files')
parent=Path('/home/ubuntu/neis-backups/storage-versioned-release-20261010')
candidate=parent/'files'
building=parent/'files.building'
d=['sudo','-n','/usr/bin/docker']
base=[*d,'compose','-f','docker-compose.yml','-f','docker-compose.security.yml','-f','docker-compose.caddy.yml']
def run(command, stdin=None, timeout=70):
    return subprocess.run(command,cwd=str(root),input=stdin,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=timeout)
if not source.is_dir() or source.is_symlink() or parent.exists():
    raise SystemExit('VERSIONED_STAGE=BLOCKED_SOURCE_OR_TARGET')
query="""SELECT coalesce(json_agg(json_build_object(
 'bucket',bucket_id,'name',name,'version',version
) ORDER BY bucket_id,name),'[]'::json)::text FROM storage.objects;"""
p=run(base+['exec','-T','db','psql','-X','-U','postgres','-d','postgres','-Atqc',query])
if p.returncode:raise SystemExit('VERSIONED_STAGE=BLOCKED_DB_READ')
try:records=json.loads(p.stdout)
except Exception:raise SystemExit('VERSIONED_STAGE=BLOCKED_DB_FORMAT')
if not isinstance(records,list) or len(records)!=104:
    raise SystemExit('VERSIONED_STAGE=BLOCKED_METADATA_COUNT')
print('VERSIONED_STAGE_METADATA_OBJECTS=104')
p=run(base+['ps','-q','storage'])
if p.returncode or not p.stdout.strip():raise SystemExit('VERSIONED_STAGE=BLOCKED_STORAGE_CONTAINER')
p=run(d+['inspect','--format','{{json .}}',p.stdout.strip()])
if p.returncode:raise SystemExit('VERSIONED_STAGE=BLOCKED_IMAGE_INSPECT')
info=json.loads(p.stdout)
image=info['Config']['Image']
env=dict(i.split('=',1) for i in info['Config'].get('Env',[]) if '=' in i)
if (env.get('STORAGE_BACKEND')!='file' or
    env.get('FILE_STORAGE_BACKEND_PATH')!='/var/lib/storage' or
    env.get('TUS_USE_FILE_VERSION_SEPARATOR','false').lower()=='true'):
    raise SystemExit('VERSIONED_STAGE=BLOCKED_INCOMPATIBLE_STORAGE_LAYOUT')
print('VERSIONED_STAGE_EXPECTED_SEPARATOR=SLASH')
print('VERSIONED_STAGE_IMAGE=LOCAL_EXISTING_ONLY')
js=r"""
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const records=JSON.parse(fs.readFileSync(0,'utf8'));
const base='/source',dest='/dest';
let names=new Set(),reads=0,copies=0;
function inside(root,full){return full.startsWith(root+path.sep);}
function dig(buf){return crypto.createHash('sha256').update(buf).digest('hex');}
for(const item of records){
 if(typeof item.bucket!=='string'||!item.bucket||
    typeof item.name!=='string'||!item.name||
    typeof item.version!=='string'||!(/^[0-9a-f-]{36}$/i.test(item.version)))
    throw new Error('blocked metadata');
 const relative=item.bucket+'/'+item.name;
 if(names.has(relative))throw new Error('duplicate metadata');
 names.add(relative);
 const src=path.resolve(base,relative);
 const dst=path.resolve(dest,relative,item.version);
 if(!inside(base,src)||!inside(dest,dst)||!fs.statSync(src).isFile())
    throw new Error('invalid local object mapping');
 const b=fs.readFileSync(src);reads++;
 fs.mkdirSync(path.dirname(dst),{recursive:true,mode:0o755});
 fs.writeFileSync(dst,b,{flag:'wx',mode:0o644});
 if(dig(b)!==dig(fs.readFileSync(dst)))throw new Error('checksum mismatch');
 copies++;
}
function count(dir){
 let n=0;
 for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
  const name=path.join(dir,entry.name);
  if(entry.isSymbolicLink())throw new Error('unexpected symlink');
  if(entry.isDirectory())n+=count(name);
  else if(entry.isFile())n++;
  else throw new Error('unexpected inode');
 }
 return n;
}
if(reads!==104||copies!==104||count(dest)!==104)
 throw new Error('incomplete conversion');
process.stdout.write('VERSIONED_STAGE_OBJECTS_COPIED=104\n');
process.stdout.write('VERSIONED_STAGE_SHA256_VERIFIED=104\n');
"""
parent.mkdir(mode=0o700)
building.mkdir(mode=0o755)
try:
    args=[*d,'run','--rm','-i','--network','none','--pull','never','--read-only',
          '--cap-drop','ALL','--security-opt','no-new-privileges',
          '--user','0','-v',str(source)+':/source:ro',
          '-v',str(building)+':/dest:rw','--entrypoint','node',image,'-e',js]
    converted=run(args,stdin=json.dumps(records),timeout=130)
    if converted.returncode or 'VERSIONED_STAGE_SHA256_VERIFIED=104' not in converted.stdout:
        raise RuntimeError('candidate conversion failed')
    building.rename(candidate)
    print('VERSIONED_STAGE_OBJECTS_COPIED=104')
    print('VERSIONED_STAGE_SHA256_VERIFIED=104')
    print('VERSIONED_STAGE=READY_ISOLATED_CANDIDATE')
    print('STORAGE_LIVE_MOUNT=UNCHANGED')
except Exception:
    import shutil
    shutil.rmtree(parent,ignore_errors=True)
    raise SystemExit('VERSIONED_STAGE=BLOCKED_BUILD_FAILED')
