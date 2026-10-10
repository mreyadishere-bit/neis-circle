#!/usr/bin/env python3
"""Restore original VAPID keys over pinned SSH; never persist or log key values."""
import json
import os
import re
import shlex
import subprocess
import sys

SOURCE_QUERY = """SELECT json_object_agg(name,decrypted_secret)::text
FROM vault.decrypted_secrets
WHERE name IN ('neis_web_push_vapid_public','neis_web_push_vapid_private');"""
REMOTE_CODE = r'''
import json,re,sys,subprocess
from pathlib import Path
keys=json.loads(sys.stdin.buffer.read(4096))
public=keys.get("neis_web_push_vapid_public","")
private=keys.get("neis_web_push_vapid_private","")
if not re.fullmatch(r"[A-Za-z0-9_-]{85,90}", public) or not re.fullmatch(r"[A-Za-z0-9_-]{40,60}", private):
    raise SystemExit("VAPID_RESTORE=BLOCKED_INVALID_FORMAT")
release=Path("/home/ubuntu/neis-frontend/releases/ovh-selfhosted-20261010-google-pkce")
worker=(release/"neis-pwa-sw.js").read_text()
push=(release/"scripts/pwa-install-v117.js").read_text()
m=re.search(r'VAPID_PUBLIC_KEY\s*=\s*[\x27\x22]([A-Za-z0-9_-]+)[\x27\x22]',worker)
if not m or public!=m.group(1) or public not in push:
    raise SystemExit("VAPID_RESTORE=BLOCKED_FRONTEND_KEY_MISMATCH")
print("VAPID_SOURCE_MATCHES_LIVE_FRONTEND=YES")
base=["sudo","-n","/usr/bin/docker","compose","-f","docker-compose.yml","-f","docker-compose.security.yml","-f","docker-compose.caddy.yml","exec","-T","db","psql","-X","-q","-U","postgres","-d","postgres","-At","-v","ON_ERROR_STOP=1"]
def sql(query):
    r=subprocess.run(base,input=query,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=40)
    if r.returncode!=0:raise SystemExit("VAPID_RESTORE=BLOCKED_DATABASE_ERROR")
    return r.stdout.strip()
import os
os.chdir("/home/ubuntu/neis-supabase")
flags=sql("SELECT (to_regclass('vault.decrypted_secrets') IS NOT NULL)::int || ',' || (to_regprocedure('vault.create_secret(text,text,text,uuid)') IS NOT NULL)::int || ',' || (to_regclass('cron.job') IS NOT NULL)::int;")
if len(flags.split(","))!=3 or flags.split(",")[0:2]!=["1","1"]:
    raise SystemExit("VAPID_RESTORE=BLOCKED_VAULT_NOT_READY")
print("OVH_VAULT_CREATE_SECRET_4ARG=YES")
print("OVH_PUSH_CRON_TABLE_PRESENT="+("YES" if flags.split(",")[2]=="1" else "NO"))
def quote(v):return "'"+v.replace("'","''")+"'"
qpub=quote(public);qpriv=quote(private)
statement="""BEGIN;
DO $neis_restore$
DECLARE p_public text := %s; p_private text := %s;
BEGIN
 IF EXISTS(SELECT 1 FROM vault.decrypted_secrets WHERE name='neis_web_push_vapid_public') THEN
  IF NOT EXISTS(SELECT 1 FROM vault.decrypted_secrets WHERE name='neis_web_push_vapid_public' AND decrypted_secret=p_public)
   THEN RAISE EXCEPTION 'existing VAPID public key differs'; END IF;
 ELSE
  PERFORM vault.create_secret(p_public,'neis_web_push_vapid_public','Original NEIS Circle Web Push public key',null::uuid);
 END IF;
 IF EXISTS(SELECT 1 FROM vault.decrypted_secrets WHERE name='neis_web_push_vapid_private') THEN
  IF NOT EXISTS(SELECT 1 FROM vault.decrypted_secrets WHERE name='neis_web_push_vapid_private' AND decrypted_secret=p_private)
   THEN RAISE EXCEPTION 'existing VAPID private key differs'; END IF;
 ELSE
  PERFORM vault.create_secret(p_private,'neis_web_push_vapid_private','Original NEIS Circle Web Push private key',null::uuid);
 END IF;
END $neis_restore$;
COMMIT;
""" % (qpub,qpriv)
if sys.argv[1]=="--check":
    print("VAPID_RESTORE=READ_ONLY_PREFLIGHT_PASS")
    raise SystemExit(0)
if sys.argv[1]!="--apply":raise SystemExit("VAPID_RESTORE=BLOCKED_MODE")
sql(statement)
status=sql("SELECT (COUNT(*)=1 AND bool_and(length(public_key)>80 AND length(private_key)>30))::int FROM public.get_web_push_vapid_keys();")
if status!="1":raise SystemExit("VAPID_RESTORE=VERIFICATION_FAILED")
print("VAPID_RESTORE=ORIGINAL_KEYS_VERIFIED_IN_OVH_VAULT")
print("VAPID_SECRET_VALUES_EXPOSED=NO")
'''
def main():
    if len(sys.argv)!=2 or sys.argv[1] not in ("--check","--apply"):
        raise SystemExit("VAPID_RESTORE=BLOCKED_MODE")
    host=os.getenv("OVH_HOST","")
    if not host or not os.getenv("CLOUD_DATABASE_URL"):
        raise SystemExit("VAPID_RESTORE=BLOCKED_CONNECTIONS_MISSING")
    env={**os.environ,"PGSSLMODE":"require","PGCONNECT_TIMEOUT":"15"}
    cmd=["docker","run","--rm","--network","bridge","-e","CLOUD_DATABASE_URL","-e","PGSSLMODE","-e","PGCONNECT_TIMEOUT","postgres:17","sh","-c",
         "exec psql -X -q -A -t -v ON_ERROR_STOP=1 --dbname=\"$CLOUD_DATABASE_URL\" -c "+shlex.quote(SOURCE_QUERY)]
    result=subprocess.run(cmd,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=105)
    if result.returncode:
        raise SystemExit("VAPID_RESTORE=BLOCKED_CLOUD_VAULT_READ")
    try:keys=json.loads(result.stdout)
    except (json.JSONDecodeError,TypeError):
        raise SystemExit("VAPID_RESTORE=BLOCKED_CLOUD_VAULT_EMPTY")
    if not isinstance(keys,dict) or set(keys)!={"neis_web_push_vapid_public","neis_web_push_vapid_private"}:
        raise SystemExit("VAPID_RESTORE=BLOCKED_ORIGINAL_PAIR_MISSING")
    print("ORIGINAL_CLOUD_VAPID_PAIR=AVAILABLE")
    # Secrets travel in SSH stdin only; not command arguments, logs, repo, or temporary files.
    remote="python3 -c "+shlex.quote(REMOTE_CODE)+" "+sys.argv[1]
    command=["ssh","-o","BatchMode=yes","-o","StrictHostKeyChecking=yes","ubuntu@"+host,remote]
    dest=subprocess.run(command,input=json.dumps(keys),stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=105)
    # Only emit predefined status lines. Never include raw stderr or DB errors.
    for line in dest.stdout.splitlines():
        if re.fullmatch(r"(VAPID_SOURCE_MATCHES_LIVE_FRONTEND|OVH_VAULT_CREATE_SECRET_4ARG|OVH_PUSH_CRON_TABLE_PRESENT|VAPID_RESTORE|VAPID_SECRET_VALUES_EXPOSED)=[A-Z0-9_]+",line):
            print(line)
    if dest.returncode:raise SystemExit("VAPID_RESTORE=BLOCKED_REMOTE_PREFLIGHT_OR_TRANSACTION")
if __name__=="__main__":
    main()
