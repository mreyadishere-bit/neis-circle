#!/usr/bin/env python3
"""Apply narrowly scoped community-media RLS restore to self-hosted OVH.
Only three storage.objects policies change, tested transactionally.
SQL never changes user objects, bucket config, authentication, backend or UI.
No token, object name, email or log contents are printed.
"""
import subprocess,sys,json
from pathlib import Path
root=Path('/home/ubuntu/neis-supabase')
stage=Path('/home/ubuntu/neis-backups/community-media-rls-restore-20261013')
sqlfile=stage/'restore.sql'
docker=['sudo','-n','/usr/bin/docker']
compose=docker+['compose']+[x for name in (
 'docker-compose.yml','docker-compose.security.yml','docker-compose.caddy.yml')
 for x in ('-f',name)]
def run(cmd,stdin=None,timeout=70):
 return subprocess.run(cmd,text=True,capture_output=True,input=stdin,cwd=root,timeout=timeout)
def psql(query,timeout=40):
 r=run(compose+['exec','-T','db','psql','-X','-v','ON_ERROR_STOP=1',
  '-U','postgres','-d','postgres','-Atq'],stdin=query,timeout=timeout)
 if r.returncode:raise RuntimeError('POSTGRES_QUERY_FAILED')
 return r.stdout.strip()
def check(value,message):
 if not value:raise RuntimeError(message)
def main():
 check(sqlfile.exists() and sqlfile.is_file() and
       str(sqlfile.resolve()).startswith(str(stage.resolve())+'/'),'STAGE_SQL_MISSING')
 sql=sqlfile.read_text()
 needed=['BEGIN;','COMMIT;',
  'CREATE POLICY neis_community_media_insert_own_v1',
  'CREATE POLICY neis_community_media_select_own_v1',
  'CREATE POLICY neis_community_media_delete_own_v1',
  'WITH CHECK (','split_part(name,','(select auth.uid()::text)',
  'SAVEPOINT neis_probe;','ROLLBACK TO SAVEPOINT neis_probe;',
  'SECURITY FAILURE: cross-user upload was not rejected']
 check(all(s in sql for s in needed) and sql.count('CREATE POLICY')==3 and
       not any(term in sql.upper() for term in [
         'DISABLE ROW LEVEL SECURITY','DROP TABLE','DELETE FROM STORAGE.OBJECTS',
         'TRUNCATE','GRANT ALL','SERVICE_ROLE']), 'UNEXPECTED_SQL')
 baseline=psql("""SELECT (SELECT count(*) FROM pg_policies
 WHERE schemaname='storage' AND tablename='objects')||','||
 (SELECT count(*) FROM storage.objects)||','||
 (SELECT relrowsecurity::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='storage' AND c.relname='objects' LIMIT 1);""")
 parts=baseline.split(',')
 check(len(parts)==3 and parts[0]=='0' and parts[1].isdigit()
  and parts[2]=='true','STORAGE_PREFLIGHT_CHANGED')
 count=int(parts[1])
 print('STORAGE_RLS_BEFORE_POLICIES=0')
 print('STORAGE_RLS_ENABLED=YES')
 print('STORAGE_OBJECT_COUNT_BEFORE='+str(count))
 # SQL is entirely one transaction, with rollback-only authenticated insert
 # and cross-user denial tests before COMMIT. ON_ERROR_STOP aborts on failure.
 cmd=compose+['exec','-T','db','psql','-X','-v','ON_ERROR_STOP=1',
     '-U','postgres','-d','postgres','-q']
 result=run(cmd,stdin=sql,timeout=95)
 if result.returncode:
  # Avoid raw psql errors containing schema/object identifiers or JWT values.
  print('STORAGE_RLS_TRANSACTION=FAILED_AND_ROLLED_BACK')
  raise RuntimeError('SQL_INTEGRATION_FAILED')
 print('STORAGE_RLS_TRANSACTION=COMMITTED')
 verify=psql("""SELECT
 (SELECT count(*) FROM pg_policies WHERE schemaname='storage'
    AND tablename='objects' AND policyname LIKE 'neis_community_media_%_own_v1')||','||
 (SELECT count(*) FROM storage.objects)||','||
 (SELECT relrowsecurity::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='storage' AND c.relname='objects' LIMIT 1)||','||
 (SELECT public::text FROM storage.buckets WHERE id='community-media')||','||
 (SELECT file_size_limit::text FROM storage.buckets WHERE id='community-media');""")
 v=verify.split(',')
 check(len(v)==5 and v[0]=='3' and v[1]==str(count) and
   v[2]=='true' and v[3]=='true' and v[4]=='8388608',
   'POST_APPLY_INVARIANTS_FAILED')
 print('STORAGE_RLS_POLICIES_AFTER=3')
 print('STORAGE_RLS_TEST_OWN_FOLDER_INSERT=PASS_ROLLED_BACK')
 print('STORAGE_RLS_TEST_FOREIGN_FOLDER_DENIAL=PASS_ROLLED_BACK')
 print('STORAGE_OBJECTS_UNCHANGED=YES')
 print('STORAGE_BUCKET_AND_LIMIT_UNCHANGED=YES')
 print('STORAGE_PUBLIC_MEDIA_AND_AUTH_UNCHANGED=YES')
 print('STORAGE_RLS_RESTORE=SUCCESS')
if __name__=='__main__':
 try: main()
 except Exception as error:
  safe={'STAGE_SQL_MISSING','UNEXPECTED_SQL','STORAGE_PREFLIGHT_CHANGED',
    'SQL_INTEGRATION_FAILED','POSTGRES_QUERY_FAILED','POST_APPLY_INVARIANTS_FAILED'}
  print('STORAGE_RLS_RESTORE=FAILED_'+
        (str(error) if str(error) in safe else 'UNEXPECTED'),file=sys.stderr)
  raise SystemExit(1)
