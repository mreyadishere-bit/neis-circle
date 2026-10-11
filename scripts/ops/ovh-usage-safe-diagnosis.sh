#!/usr/bin/env bash
set -Eeuo pipefail
echo 'USAGE_AUDIT_START'
systemctl is-active neis-private-monitor.service || true
systemctl is-active neis-server-usage-sample.timer || true
systemctl show neis-private-monitor.service -p NoNewPrivileges -p CapabilityBoundingSet -p MainPID --no-pager | sed -E 's/(MainPID=)[0-9]+/\1PRESENT/'
python3 - <<'PY'
import json,subprocess,urllib.request
from pathlib import Path
try:
 x=json.load(urllib.request.urlopen("http://127.0.0.1:8765/api/metrics",timeout=14))
 print("MONITOR_DOCKER_ERROR="+str(x.get("docker",{}).get("error")))
 print("MONITOR_DOCKER_RUNNING="+str(x.get("docker",{}).get("running")))
 print("MONITOR_DATABASE_BYTES_PRESENT="+str(x.get("database_bytes") is not None))
except Exception as e:
 print("MONITOR_READ=FAILED_"+type(e).__name__)
commands=[
 ("INTERACTIVE_DOCKER_PS",["sudo","-n","/usr/bin/docker","ps","--format","{{.Names}}"]),
 ("INTERACTIVE_DOCKER_STATS",["sudo","-n","/usr/bin/docker","stats","--no-stream","--format","{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}"]),
 ("MONITOR_SERVICE_SECURITY",["systemctl","show","neis-private-monitor.service","-p","NoNewPrivileges","-p","AmbientCapabilities","-p","CapabilityBoundingSet"]),
]
for label,command in commands:
 try:
  r=subprocess.run(command,capture_output=True,text=True,timeout=12)
  print(label+"_RETURN="+str(r.returncode))
  if label=="INTERACTIVE_DOCKER_PS" and r.returncode==0:
   print("DB_CONTAINER_MATCH="+str(any("db" in s.lower() for s in r.stdout.splitlines())))
   print("CONTAINER_COUNT="+str(len(r.stdout.splitlines())))
  if label=="MONITOR_SERVICE_SECURITY":print("SERVICE_SECURITY="+r.stdout.strip().replace("\n",";")[:350])
 except Exception as e:print(label+"_ERROR="+type(e).__name__)
PY
echo 'USAGE_AUDIT_DONE'
