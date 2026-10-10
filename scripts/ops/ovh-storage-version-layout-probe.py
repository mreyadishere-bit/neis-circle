#!/usr/bin/env python3
"""Read-only OVH Storage version layout probe. Never expose object names or secrets."""
import json,subprocess
from pathlib import Path
root=Path('/home/ubuntu/neis-supabase')
source=Path('/home/ubuntu/neis-backups/storage-runtime-release-20261010/files')
docker=['sudo','-n','/usr/bin/docker']
compose=[*docker,'compose','-f','docker-compose.yml','-f','docker-compose.security.yml','-f','docker-compose.caddy.yml']
def run(args,stdin=None,timeout=60):
 return subprocess.run(args,cwd=str(root),input=stdin,capture_output=True,text=True,timeout=timeout)
sql="""select coalesce(json_agg(json_build_object('bucket',bucket_id,'name',name,'version',version) order by bucket_id,name),'[]'::json)::text from storage.objects;"""
r=run(compose+['exec','-T','db','psql','-X','-U','postgres','-d','postgres','-Atqc',sql])
if r.returncode:raise SystemExit('STORAGE_LAYOUT=BLOCKED_DB_QUERY')
try:records=json.loads(r.stdout)
except Exception:raise SystemExit('STORAGE_LAYOUT=BLOCKED_BAD_DB_RESULT')
print('LAYOUT_METADATA_COUNT='+str(len(records)))
print('LAYOUT_NULL_VERSIONS='+str(sum(item['version'] is None for item in records)))
print('LAYOUT_NONSTRING_VERSIONS='+str(sum(item['version'] is not None and not isinstance(item['version'],str) for item in records)))
print('LAYOUT_EMPTY_VERSIONS='+str(sum(item['version']=='' for item in records)))
p=run(compose+['ps','-q','storage'])
if p.returncode or not p.stdout.strip():raise SystemExit('STORAGE_LAYOUT=BLOCKED_NO_STORAGE')
p=run(docker+['inspect','--format','{{json .}}',p.stdout.strip()])
if p.returncode:raise SystemExit('STORAGE_LAYOUT=BLOCKED_INSPECT')
image=json.loads(p.stdout)['Config']['Image']
nodejs=r"""
const fs=require('fs'),path=require('path');
const records=JSON.parse(fs.readFileSync(0,'utf8'));
let files=0,missing=0,invalidVersions=0,alreadyVersioned=0,notVersioned=0,readErrors=0;
for(const row of records){
 if(typeof row.bucket!=='string'||typeof row.name!=='string')continue;
 const dir=path.resolve('/source',row.bucket);
 const rel=path.resolve(dir,row.name);
 if(!rel.startsWith('/source/')||!rel.startsWith(dir+'/')){readErrors++;continue}
 try{
  const stat=fs.statSync(rel);
  if(stat.isFile()){files++;notVersioned++}
  else if(stat.isDirectory()){alreadyVersioned++}
  else {readErrors++}
 }catch(e){if(e.code==='ENOENT')missing++;else readErrors++}
 if(typeof row.version!=='string'||!row.version)invalidVersions++;
}
process.stdout.write('LAYOUT_SOURCE_DIRECT_FILES='+files+'\n');
process.stdout.write('LAYOUT_SOURCE_DIRECTORIES='+alreadyVersioned+'\n');
process.stdout.write('LAYOUT_SOURCE_MISSING='+missing+'\n');
process.stdout.write('LAYOUT_SOURCE_READ_ERRORS='+readErrors+'\n');
process.stdout.write('LAYOUT_INVALID_VERSION_VALUES='+invalidVersions+'\n');
"""
x=run(docker+['run','--rm','-i','--network','none','--pull','never','--read-only',
 '--cap-drop','ALL','--security-opt','no-new-privileges',
 '--user','0','-v',str(source)+':/source:ro','--entrypoint','node',image,
 '-e',nodejs],stdin=json.dumps(records),timeout=90)
if x.returncode:
 err=x.stderr.lower()
 print('LAYOUT_NODE_RUN='+('NODE_BINARY_MISSING' if 'executable file not found' in err or 'no such file or directory' in err else 'PERMISSION_OR_IMAGE' if 'permission denied' in err else 'OTHER_FAILURE'))
else:
 print('LAYOUT_NODE_RUN=SUCCESS')
 for line in x.stdout.splitlines():
  if line.startswith('LAYOUT_') and line.split('=',1)[1].isdigit():print(line)
print('STORAGE_LAYOUT=READ_ONLY_NO_OBJECT_IDENTIFIERS')
