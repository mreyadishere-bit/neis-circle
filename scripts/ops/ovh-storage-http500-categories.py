#!/usr/bin/env python3
"""Read-only diagnostic of OVH Storage; output categorical results, never logs or PII."""
import json,re,subprocess,urllib.error,urllib.request
from pathlib import Path
root=Path("/home/ubuntu/neis-supabase")
d=["sudo","-n","/usr/bin/docker"]
c=[*d,"compose","-f","docker-compose.yml","-f","docker-compose.security.yml","-f","docker-compose.caddy.yml"]
def cmd(args,timeout=35):
    return subprocess.run(args,cwd=str(root),stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=timeout)
s=cmd(c+["ps","-q","storage"])
if s.returncode or not s.stdout.strip():
    raise SystemExit("STORAGE_DIAGNOSTIC=BLOCKED_NO_SERVICE")
cid=s.stdout.strip()
ins=cmd(d+["inspect","--format","{{json .}}",cid])
if ins.returncode:raise SystemExit("STORAGE_DIAGNOSTIC=BLOCKED_INSPECT")
data=json.loads(ins.stdout)
env=dict(x.split("=",1) for x in data["Config"].get("Env",[]) if "=" in x)
print("STORAGE_CONTAINER_RUNNING="+str(bool(data.get("State",{}).get("Running"))).upper())
for k in ["STORAGE_BACKEND","FILE_STORAGE_BACKEND_PATH","DATABASE_URL","POSTGREST_URL","ANON_KEY","SERVICE_KEY","TENANT_ID"]:
    print("STORAGE_ENV_"+k+"_PRESENT="+str(bool(env.get(k))).upper())
print("STORAGE_BACKEND_LOCAL_FILE="+str(env.get("STORAGE_BACKEND","")=="file").upper())
mnt=[x for x in data.get("Mounts",[]) if x.get("Destination")=="/var/lib/storage"]
print("STORAGE_MOUNT_PRESENT="+str(len(mnt)==1).upper())
print("STORAGE_MOUNT_WRITABLE="+str(len(mnt)==1 and mnt[0].get("RW")).upper())
for kind,path in [
    ("STATUS","https://supabase.neiscircle.site/storage/v1/status"),
    ("HEALTH","https://supabase.neiscircle.site/storage/v1/health")
]:
    try:
        with urllib.request.urlopen(urllib.request.Request(path,headers={"User-Agent":"NEIS-Storage-ReadOnly-Diagnostic"}),timeout=9) as response:
            status=response.status
    except urllib.error.HTTPError as ex:status=ex.code
    except Exception:status=0
    print("STORAGE_PUBLIC_"+kind+"_HTTP="+str(status))
logs=cmd(d+["logs","--since","40m",cid],timeout=40)
if logs.returncode:print("STORAGE_LOG_CATEGORIES=UNAVAILABLE")
else:
    t=(logs.stdout+"\n"+logs.stderr).lower()
    terms={
      "FILESYSTEM_MISSING":r"enoent|no such file or directory|filenotfound",
      "FILESYSTEM_PERMISSION":r"eacces|permission denied|operation not permitted",
      "DATABASE_CONNECTION":r"econnrefused|connection refused|database connection|connect etimedout|timeout connecting",
      "OBJECT_NOT_FOUND":r"objectnotfound|object not found|bucketnotfound|no such key",
      "POSTGREST_ERROR":r"postgrest|pgrst[0-9]{2,4}",
      "TENANT_CONFIG":r"tenant.*not found|tenant.*missing|tenant.*error",
      "INTERNAL_HTTP500":r"internalservererror|http 500|statuscode[^\n]{0,30}500|status[^\n]{0,20}500",
      "KEYS_OR_JWT":r"jwt.*(invalid|expired)|invalid.*jwt|invalid.*api.key",
      "STORAGE_UNAVAILABLE":r"storage.*unavailable|storage.*error|backend.*error",
    }
    for name,pat in terms.items():
        print("STORAGE_LOG_"+name+"="+str(bool(re.search(pat,t))).upper())
    print("STORAGE_LOG_LINES_READ="+str(min(len(t.splitlines()),99999)))
print("STORAGE_DIAGNOSTIC=COMPLETE_READ_ONLY_NO_LOG_CONTENT")
