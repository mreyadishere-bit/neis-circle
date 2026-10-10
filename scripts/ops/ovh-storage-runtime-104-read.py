#!/usr/bin/env python3
"""Check exact 104 versioned media reads inside isolated Storage runtime container."""
import subprocess,json
from pathlib import Path
root=Path('/home/ubuntu/neis-supabase')
stage=Path('/home/ubuntu/neis-backups/storage-versioned-release-20261010/files')
docker=['sudo','-n','/usr/bin/docker']
compose=docker+['compose','-f','docker-compose.yml','-f','docker-compose.security.yml','-f','docker-compose.caddy.yml']
def run(args,stdin=None,timeout=95):
 return subprocess.run(args,cwd=str(root),input=stdin,capture_output=True,text=True,timeout=timeout)
sql="""select coalesce(json_agg(json_build_object('bucket',bucket_id,'name',name,'version',version) order by bucket_id,name),'[]'::json)::text from storage.objects;"""
p=run(compose+['exec','-T','db','psql','-X','-U','postgres','-d','postgres','-Atqc',sql])
if p.returncode:raise SystemExit('FILE_READ=DB_UNAVAILABLE')
rows=json.loads(p.stdout)
if len(rows)!=104 or not stage.is_dir():raise SystemExit('FILE_READ=STAGE_MISSING_OR_COUNT_DRIFT')
cid=run(compose+['ps','-q','storage']).stdout.strip()
r=run(docker+['inspect','--format','{{json .}}',cid])
if r.returncode:raise SystemExit('FILE_READ=INSPECT_FAILED')
data=json.loads(r.stdout)
image=data['Config']['Image'];user=data['Config'].get('User','')
backend_etag=data['Config'].get('Env',[])
alg=next((entry.split('=',1)[1] for entry in backend_etag if entry.startswith('FILE_STORAGE_ETAG_ALGORITHM=')),'UNSET')
print('STORAGE_ETAG_CONFIG='+str(alg if alg in ('mtime','md5') else 'UNSET_OR_OTHER'))
js=r"""
const fs=require('node:fs'),path=require('node:path');
const records=JSON.parse(fs.readFileSync(0,'utf8'));
const root='/var/lib/storage';
let attrs;
try { attrs=require('fs-xattr') } catch(e) { attrs=null }
let xattrSupported=0,xattrMissing=0,xattrUnsupported=0,xattrPermission=0,xattrOther=0;

let good=0,missing=0,denied=0,other=0,dirs=0,badLength=0,bytes=0;
for(const o of records){
 const f=path.resolve(root,o.bucket,o.name,o.version);
 if(!f.startsWith(root+'/')){other++;continue}
 try{
  const st=fs.statSync(f);
  if(st.isDirectory()){dirs++;continue}
  if(!st.isFile()){other++;continue}
  const handle=fs.openSync(f,'r'),buf=Buffer.alloc(16);
  const n=fs.readSync(handle,buf,0,16,0);
  fs.closeSync(handle);
  bytes+=n;
  if(st.size>0&&n===0)badLength++;
  good++;
  if(attrs){
   try{
    attrs.getAttributeSync(f,'user.supabase.content-type');
    xattrSupported++;
   }catch(e){
    if(e.code==='ENODATA'||e.code==='ENOATTR')xattrMissing++;
    else if(e.code==='ENOTSUP'||e.code==='EOPNOTSUPP')xattrUnsupported++;
    else if(e.code==='EACCES'||e.code==='EPERM')xattrPermission++;
    else xattrOther++;
   }
  }
 }catch(err){if(err.code==='ENOENT')missing++;else if(err.code==='EACCES'||err.code==='EPERM')denied++;else other++}
}
console.log('FILE_READ_OK='+good);
console.log('FILE_READ_MISSING='+missing);
console.log('FILE_READ_PERMISSION_DENIED='+denied);
console.log('FILE_READ_UNEXPECTED_DIRECTORY='+dirs);
console.log('FILE_READ_OTHER_ERROR='+other);
console.log('FILE_READ_BAD_LENGTH='+badLength);
console.log('FILE_READ_PROBED_BYTES='+bytes);
console.log('FILE_XATTR_MODULE='+ (attrs?'AVAILABLE':'MISSING'));
console.log('FILE_XATTR_PRESENT='+xattrSupported);
console.log('FILE_XATTR_MISSING_EXPECTED='+xattrMissing);
console.log('FILE_XATTR_UNSUPPORTED='+xattrUnsupported);
console.log('FILE_XATTR_PERMISSION='+xattrPermission);
console.log('FILE_XATTR_OTHER='+xattrOther);
if(good!==records.length||missing||denied||dirs||other||badLength)process.exitCode=1;
"""
args=docker+['run','--rm','-i','--network','none','--pull','never','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','-v',str(stage)+':/var/lib/storage:ro']
if user:args+=['--user',user]
args+=['--entrypoint','node',image,'-e',js]
q=run(args,stdin=json.dumps(rows))
for line in q.stdout.splitlines():
 if line.startswith(('FILE_READ_','FILE_XATTR_')) and (line.split('=',1)[1].isdigit() or line.startswith('FILE_XATTR_MODULE=')):print(line)
if q.returncode:raise SystemExit('FILE_READ=FAILED_RUNTIME_ISOLATED')
print('FILE_READ=PASS_RUNTIME_USER_104_OF_104')
print('LIVE_STORAGE_MOUNT=UNCHANGED')
