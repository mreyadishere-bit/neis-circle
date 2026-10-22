#!/usr/bin/env python3
"""Return only the public browser anon JWT if OVH production services are ready."""
import base64,json,subprocess,sys
from pathlib import Path
root=Path("/home/ubuntu/neis-supabase")
docker=["sudo","-n","/usr/bin/docker"]
compose=docker+["compose"]+[part for f in ("docker-compose.yml","docker-compose.security.yml","docker-compose.caddy.yml","docker-compose.edge-integrations.yml") for part in ("-f",f)]
def output(cmd):
 p=subprocess.run(cmd,cwd=str(root),stdin=subprocess.DEVNULL,capture_output=True,text=True,timeout=45)
 if p.returncode:raise RuntimeError("not ready")
 return p.stdout.strip()
try:
 def sql(statement):return output(compose+["exec","-T","db","psql","-X","-U","postgres","-d","postgres","-Atqc",statement])
 if sql("select count(*) from auth.users")!="204" or sql("select count(*) from public.profiles")!="204" or sql("select count(*) from storage.objects")!="104":raise RuntimeError("row counts")
 storageid=output(compose+["ps","-q","storage"])
 service=json.loads(output(docker+["inspect","--format","{{json .}}",storageid]))
 mounts=[x for x in service["Mounts"] if x.get("Destination")=="/var/lib/storage"]
 if not (service["State"]["Running"] and len(mounts)==1 and mounts[0].get("RW") and mounts[0].get("Source")=="/home/ubuntu/neis-backups/storage-runtime-release-20261010/files"):raise RuntimeError("storage")
 auth=json.loads(output(docker+["inspect","--format","{{json .}}","supabase-auth"]))
 env=dict(x.split("=",1) for x in auth["Config"]["Env"] if "=" in x)
 if not (auth["State"]["Running"] and env.get("GOTRUE_EXTERNAL_GOOGLE_ENABLED","").lower()=="true" and env.get("GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID") and env.get("GOTRUE_EXTERNAL_GOOGLE_SECRET")):raise RuntimeError("google")
 values=[line.split("=",1)[1].strip().strip('"').strip("'") for line in (root/".env").read_text().splitlines() if line.startswith("ANON_KEY=")]
 if len(values)!=1 or values[0].count(".")!=2:raise RuntimeError("public anon")
 key=values[0]
 p=key.split(".")[1]
 claims=json.loads(base64.urlsafe_b64decode(p+"="*((-len(p))%4)))
 if claims.get("role")!="anon":raise RuntimeError("wrong key role")
except Exception:
 print("SITE_GATE=BLOCKED_UNREADY_OVH_BACKEND",file=sys.stderr)
 sys.exit(1)
print(key)
