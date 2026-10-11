#!/usr/bin/env python3
"""OVH hourly capacity housekeeping. No secrets or user data in output."""
import json
import re
import subprocess
import sys

ROOT="/home/ubuntu/neis-supabase"
COMPOSE=["sudo","-n","/usr/bin/docker","compose"]
for name in ("docker-compose.yml","docker-compose.security.yml","docker-compose.caddy.yml"):
    COMPOSE.extend(["-f",name])
CMD=COMPOSE+["exec","-T","db","psql","-X","-v","ON_ERROR_STOP=1",
             "-U","postgres","-d","postgres","-Atqc",
             "select public.neis_maintenance_storage_retention();"]

def main():
    proc=subprocess.run(CMD,cwd=ROOT,capture_output=True,text=True,timeout=90)
    if proc.returncode!=0:
        raise RuntimeError("MAINTENANCE_RPC_FAILED")
    result=proc.stdout.strip()
    if not result.startswith("{") or len(result)>1000:
        raise RuntimeError("MAINTENANCE_RESPONSE_UNEXPECTED")
    obj=json.loads(result)
    for key in ("detailed_pruned","accepted_outbox_pruned","database_bytes"):
        if not isinstance(obj.get(key),int) or obj[key]<0:
            raise RuntimeError("MAINTENANCE_RESPONSE_UNEXPECTED")
    # Only aggregate statistics, no recipients, emails, student IDs or content.
    print("OVH_RETENTION=SUCCESS")
    print("OVH_RETENTION_DETAIL_ROWS_PRUNED="+str(obj["detailed_pruned"]))
    print("OVH_RETENTION_OLD_ACCEPTED_EMAIL_ROWS_PRUNED="+str(obj["accepted_outbox_pruned"]))
    print("OVH_RETENTION_DATABASE_BYTES="+str(obj["database_bytes"]))
    print("OVH_RETENTION_AUTOMATIC=HOURLY")
if __name__=="__main__":
    try:main()
    except Exception as exc:
        label=str(exc)
        if label not in ("MAINTENANCE_RPC_FAILED","MAINTENANCE_RESPONSE_UNEXPECTED"):
            label="UNEXPECTED"
        print("OVH_RETENTION=FAILED_"+label,file=sys.stderr)
        raise SystemExit(1)
