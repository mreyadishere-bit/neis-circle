#!/usr/bin/env python3
"""Build isolated Storage API v1.74 locator-keyed media; never touch current mount."""
import json,subprocess,re,shutil,os
from pathlib import Path
root=Path('/home/ubuntu/neis-supabase')
src=Path('/home/ubuntu/neis-backups/storage-runtime-release-20261010/files')
parent=Path('/home/ubuntu/neis-backups/storage-locator-release-20261010')
building=parent/'files.building'
candidate=parent/'files'
docker=['sudo','-n','/usr/bin/docker']
compose=docker+['compose','-f','docker-compose.yml','-f','docker-compose.security.yml','-f','docker-compose.caddy.yml']
def run(cmd,stdin=None,timeout=150):
 return subprocess.run(cmd,input=stdin,cwd=str(root),capture_output=True,text=True,timeout=timeout)
if not src.is_dir() or src.is_symlink() or parent.exists():
 raise SystemExit('LOCATOR_STAGE=BLOCKED_SOURCE_OR_TARGET_EXISTS')
query="""select coalesce(json_agg(json_build_object(
'bucket',bucket_id,'name',name,'version',version,
'mimetype',metadata->>'mimetype','cacheControl',metadata->>'cacheControl'
) order by bucket_id,name),'[]'::json)::text from storage.objects;"""
p=run(compose+['exec','-T','db','psql','-X','-U','postgres','-d','postgres','-Atqc',query])
if p.returncode:raise SystemExit('LOCATOR_STAGE=BLOCKED_DB_READ')
try:objects=json.loads(p.stdout)
except Exception:raise SystemExit('LOCATOR_STAGE=BLOCKED_DB_PARSE')
if len(objects)!=104:raise SystemExit('LOCATOR_STAGE=BLOCKED_DB_OBJECT_DRIFT')
cid=run(compose+['ps','-q','storage']).stdout.strip()
if not cid:raise SystemExit('LOCATOR_STAGE=BLOCKED_STORAGE_CONTAINER')
p=run(docker+['inspect','--format','{{json .}}',cid])
if p.returncode:raise SystemExit('LOCATOR_STAGE=BLOCKED_INSPECT')
c=json.loads(p.stdout)['Config']
env=dict(x.split('=',1) for x in c.get('Env',[]) if '=' in x)
if env.get('STORAGE_BACKEND')!='file' or env.get('FILE_STORAGE_BACKEND_PATH')!='/var/lib/storage' or env.get('TUS_USE_FILE_VERSION_SEPARATOR','false').lower()=='true':
 raise SystemExit('LOCATOR_STAGE=BLOCKED_INCOMPATIBLE_STORAGE_CONFIG')
storage_root=env.get('STORAGE_S3_BUCKET') or env.get('GLOBAL_S3_BUCKET')
tenant=env.get('TENANT_ID')
if not storage_root or not tenant or any(not re.fullmatch(r'[A-Za-z0-9._-]{1,150}',v) for v in (storage_root,tenant)):
 raise SystemExit('LOCATOR_STAGE=BLOCKED_UNEXPECTED_TENANT_OR_STORAGE_ROOT')
image=c['Image'];user=c.get('User','')
print('LOCATOR_META_COUNT=104')
print('LOCATOR_PHYSICAL_PREFIX_LEVELS=2')
print('LOCATOR_VERSIONED_SUFFIX=SLASH_UUID')
node=r"""
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const xattr=require('fs-xattr');
const data=JSON.parse(fs.readFileSync(0,'utf8'));
const root='/source',dest='/dest';
const valid=/^[0-9a-f-]{36}$/i;
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const entries=new Set();
let copies=0,attrib=0;
function mkdirSafe(target){
 const rel=path.relative(dest,target);
 let p=dest;
 for(const component of rel.split(path.sep)){
  if(!component||component==='.')continue;
  if(component==='..')throw Error('unsafe directory');
  p=path.join(p,component);
  fs.mkdirSync(p,{recursive:true,mode:0o777});
  fs.chmodSync(p,0o777);
 }
}
for(const o of data.objects){
 if(typeof o.bucket!=='string'||typeof o.name!=='string'||!valid.test(o.version))throw Error('invalid metadata');
 const rel=o.bucket+'/'+o.name;
 if(entries.has(rel))throw Error('duplicate object');
 entries.add(rel);
 const source=path.resolve(root,rel);
 const target=path.resolve(dest,data.storageRoot,data.tenant,rel,o.version);
 if(!source.startsWith(root+path.sep)||!target.startsWith(dest+path.sep))throw Error('unsafe file path');
 if(!fs.lstatSync(source).isFile())throw Error('bad source');
 const blob=fs.readFileSync(source);
 mkdirSafe(path.dirname(target));
 fs.writeFileSync(target,blob,{flag:'wx',mode:0o644});
 if(sha(blob)!==sha(fs.readFileSync(target)))throw Error('hash mismatch');
 if(typeof o.mimetype==='string'&&o.mimetype&&o.mimetype.length<=100){
  xattr.setAttributeSync(target,'user.supabase.content-type',o.mimetype);
  attrib++;
 }
 if(typeof o.cacheControl==='string'&&o.cacheControl.length<=60&&o.cacheControl){
  xattr.setAttributeSync(target,'user.supabase.cache-control',o.cacheControl);
 }
 copies++;
}
function count(folder){
 let n=0;
 for(const e of fs.readdirSync(folder,{withFileTypes:true})){
  if(e.isSymbolicLink())throw Error('unexpected symlink');
  if(e.isDirectory())n+=count(path.join(folder,e.name));
  else if(e.isFile())n++;
  else throw Error('invalid inode');
 }
 return n;
}
if(copies!==104||count(dest)!==104)throw Error('count mismatch');
console.log('LOCATOR_COPIED=104');
console.log('LOCATOR_HASHES_VERIFIED=104');
console.log('LOCATOR_MIMETYPE_ATTRS='+attrib);
"""
parent.mkdir(mode=0o700)
building.mkdir(mode=0o700)
os.chmod(building,0o777)
try:
 args=docker+['run','--rm','-i','--network','none','--pull','never','--read-only',
  '--cap-drop','ALL','--security-opt','no-new-privileges',
  '--user','0','-v',str(src)+':/source:ro',
  '-v',str(building)+':/dest:rw','--entrypoint','node',image,
  '-e',node]
 p=run(args,stdin=json.dumps({'objects':objects,'storageRoot':storage_root,'tenant':tenant}))
 if p.returncode or 'LOCATOR_HASHES_VERIFIED=104' not in p.stdout:
  err=p.stderr.lower()
  kind='PERMISSION' if 'eacces' in err or 'eperm' in err else 'SOURCE_MISSING' if 'enoent' in err else 'XATTR' if 'xattr' in err else 'OTHER'
  print('LOCATOR_BUILD_ERROR_CLASS='+kind)
  raise RuntimeError('cannot build')
 building.rename(candidate)
 os.chmod(candidate,0o777)
 for line in p.stdout.splitlines():
  if re.fullmatch(r'LOCATOR_(?:COPIED|HASHES_VERIFIED|MIMETYPE_ATTRS)=\\d+',line):print(line)
 print('LOCATOR_STAGE=VERIFIED_ISOLATED')
 print('STORAGE_LIVE_MOUNT=UNCHANGED')
except Exception:
 shutil.rmtree(parent,ignore_errors=True)
 raise SystemExit('LOCATOR_STAGE=FAILED_NO_PRODUCTION_CHANGE')
