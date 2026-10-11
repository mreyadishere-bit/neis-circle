#!/usr/bin/env python3
"""One-shot, read-only host metrics collector into locked PostgreSQL snapshots."""
import json
import subprocess
import sys
import re
import urllib.request

URL="http://127.0.0.1:8765/api/metrics"
COMPOSE=["sudo","-n","/usr/bin/docker","compose",
         "-f","docker-compose.yml",
         "-f","docker-compose.security.yml",
         "-f","docker-compose.caddy.yml"]

def main():
    with urllib.request.urlopen(URL,timeout=18) as response:
        if response.status!=200: raise ValueError("Monitor health unavailable")
        payload=json.load(response)
    if not (isinstance(payload,dict) and
            isinstance(payload.get("cpu"),(int,float)) and
            isinstance(payload.get("memory"),dict) and
            isinstance(payload.get("disk"),dict) and
            isinstance(payload.get("docker"),dict)):
        raise ValueError("Invalid metrics payload")
    # Strict whitelist: no auth data, environment contents, logs or filesystem paths.
    allowed={k:payload.get(k) for k in (
        "at","cpu","cores","load_1m","memory","disk","network",
        "uptime_seconds","docker","database_bytes")}
    docker=allowed["docker"]
    allowed["docker"]={
        "running":docker.get("running"),
        "error":docker.get("error",False),
        "services":[{
            "name":str(s.get("name",""))[:80],
            "status":str(s.get("status",""))[:80],
            "cpu":str(s.get("cpu",""))[:24],
            "memory":str(s.get("memory",""))[:64],
        } for s in docker.get("services",[])[:50] if isinstance(s,dict)]
    }
    # Use the already approved server Docker CLI as a fallback if systemd's
    # private monitor cannot elevate. No containers or DB rows are modified.
    if allowed["docker"]["error"] or allowed["docker"]["running"] is None:
        try:
            cmd=subprocess.run(["sudo","-n","/usr/bin/docker","ps","--format","{{.Names}}|{{.Status}}"],
                               capture_output=True,text=True,timeout=8,check=True)
            stats=subprocess.run(["sudo","-n","/usr/bin/docker","stats","--no-stream",
                                  "--format","{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}"],
                                 capture_output=True,text=True,timeout=12,check=True)
            states=dict(line.split("|",1) for line in cmd.stdout.splitlines() if "|" in line)
            services=[]
            for line in stats.stdout.splitlines():
                parts=line.split("|",2)
                if len(parts)!=3 or not parts[0].startswith(("neis-","supabase-")):
                    continue
                name,cpu,mem=parts
                services.append({"name":name[:80],"status":states.get(name,"Unknown")[:80],
                                 "cpu":cpu[:24],"memory":mem[:64]})
            allowed["docker"]={"running":len(states),"error":False,
                              "services":sorted(services,key=lambda item:item["name"])[:50]}
        except (OSError,subprocess.SubprocessError,ValueError):
            pass
    if not isinstance(allowed["database_bytes"],int) or allowed["database_bytes"]<0:
        try:
            size=subprocess.run(COMPOSE+["exec","-T","db","psql","-X","-v","ON_ERROR_STOP=1",
                                       "-U","postgres","-d","postgres","-Atqc",
                                       "select pg_database_size(current_database())"],
                                cwd="/home/ubuntu/neis-supabase",capture_output=True,
                                text=True,timeout=15,check=True)
            value=size.stdout.strip()
            allowed["database_bytes"]=int(value) if re.fullmatch(r"\d{1,15}",value) else None
        except (OSError,ValueError,subprocess.SubprocessError):
            allowed["database_bytes"]=None
    snapshot=json.dumps(allowed,separators=(",",":"),allow_nan=False)
    # Snapshot is JSON-encoded and quoted as a single SQL string literal.
    quoted=snapshot.replace("'","''")
    sql=("INSERT INTO public.neis_private_server_usage_samples (collected_at,snapshot) "
         f"VALUES (now(),'{quoted}'::jsonb) "
         "ON CONFLICT (collected_at) DO NOTHING; "
         "DELETE FROM public.neis_private_server_usage_samples "
         "WHERE collected_at < now() - interval '30 days'; "
         "SELECT 'SERVER_SAMPLER_OK='||count(*) FROM public.neis_private_server_usage_samples;")
    result=subprocess.run(COMPOSE+["exec","-T","db","psql","-X","-v","ON_ERROR_STOP=1",
                                      "-U","postgres","-d","postgres","-Atq"],
                          cwd="/home/ubuntu/neis-supabase",input=sql,text=True,
                          capture_output=True,timeout=28)
    if result.returncode!=0 or "SERVER_SAMPLER_OK=" not in result.stdout:
        raise RuntimeError("Metrics database write failed")
    print("SERVER_SAMPLER=SUCCESS")

if __name__=="__main__":
    try:main()
    except Exception:
        print("SERVER_SAMPLER=FAILED",file=sys.stderr)
        raise SystemExit(1)
