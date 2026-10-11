#!/usr/bin/env bash
set -Eeuo pipefail
echo "OVH_STORAGE_AUDIT=START"
df -B1 / | awk 'NR==2{printf "ROOT_DISK_TOTAL_GIB=%.2f\nROOT_DISK_USED_GIB=%.2f\nROOT_DISK_AVAILABLE_GIB=%.2f\n",$2/1073741824,$3/1073741824,$4/1073741824}'
python3 - <<'PY'
import os,subprocess,re,urllib.request,urllib.error,json
paths={
 "OS_USR":"/usr",
 "OS_BOOT":"/boot",
 "OS_ETC":"/etc",
 "DOCKER_DATA":"/var/lib/docker",
 "DOCKER_CONTAINERD":"/var/lib/containerd",
 "SYS_LOGS":"/var/log",
 "SYS_CACHE":"/var/cache",
 "HOME_NEIS_BACKUPS":"/home/ubuntu/neis-backups",
 "HOME_NEIS_RELEASES":"/home/ubuntu/neis-frontend",
 "HOME_NEIS_SUPABASE":"/home/ubuntu/neis-supabase",
 "HOME_NEIS_OTHER":"/home/ubuntu/.cache",
}
for tag,path in paths.items():
 if not os.path.exists(path):
  print("DISK_"+tag+"_GIB=ABSENT");continue
 try:
  r=subprocess.run(["sudo","-n","du","-sx","-B1",path],capture_output=True,text=True,timeout=50)
  if r.returncode: raise ValueError()
  byte_count=int(r.stdout.split()[0])
  print(f"DISK_{tag}_GIB={byte_count/1073741824:.3f}")
 except Exception:print("DISK_"+tag+"_GIB=UNAVAILABLE")
try:
 r=subprocess.run(["sudo","-n","/usr/bin/docker","system","df","--format","{{json .}}"],capture_output=True,text=True,timeout=18)
 if r.returncode==0:
  for line in r.stdout.splitlines():
   obj=json.loads(line)
   typ=obj.get("Type")
   print("DOCKER_SYSTEM_DF_TYPE="+str(typ).replace(" ","_")+";SIZE="+str(obj.get("Size"))+";RECLAIMABLE="+str(obj.get("Reclaimable")))
except Exception:pass
cmd=["sudo","-n","/usr/bin/docker","compose"]
for f in ("docker-compose.yml","docker-compose.security.yml","docker-compose.caddy.yml"):
 cmd+=["-f",f]
cmd+=["exec","-T","db","psql","-X","-v","ON_ERROR_STOP=1","-U","postgres","-d","postgres","-Atqc","select pg_database_size(current_database())"]
try:
 r=subprocess.run(cmd,cwd="/home/ubuntu/neis-supabase",capture_output=True,text=True,timeout=25)
 if r.returncode==0 and r.stdout.strip().isdigit():
  print("POSTGRES_DATABASE_GIB=%.4f"%(int(r.stdout.strip())/1073741824))
 else:print("POSTGRES_DATABASE_GIB=UNAVAILABLE")
except Exception:print("POSTGRES_DATABASE_GIB=UNAVAILABLE")
try:
 r=subprocess.run(["sudo","-n","/usr/bin/docker","ps","--format","{{.Names}}"],
                  capture_output=True,text=True,timeout=10)
 if r.returncode==0:
  names=r.stdout.lower().splitlines()
  for kind in ("auth","db","rest","storage","realtime","studio"):
   print("SUPABASE_"+kind.upper()+"_RUNNING="+str(any(kind in name for name in names)))
except Exception:pass
try:
 r=subprocess.run(["sudo","-n","/usr/bin/docker","exec","supabase-caddy","cat","/etc/caddy/Caddyfile"],
                   capture_output=True,text=True,timeout=15)
 if r.returncode==0:
  cfg=r.stdout.lower()
  print("CADDY_BASIC_AUTH_CONFIGURED="+str("basic_auth" in cfg or "basicauth" in cfg))
  print("CADDY_STUDIO_UPSTREAM_CONFIGURED="+str("studio" in cfg))
  for host in ("supabase.neiscircle.site","studio.neiscircle.site"):
   print("CADDY_"+host.replace(".","_").upper()+"_HOST_PRESENT="+str(host in cfg))
except Exception:pass
for path in ("/","/project/default/auth/users","/auth/v1/settings"):
 url="https://supabase.neiscircle.site"+path
 try:
  request=urllib.request.Request(url,headers={"User-Agent":"NEIS-OVH-ReadOnly-Audit"})
  with urllib.request.urlopen(request,timeout=10) as res:
   print("HTTPS_"+("ROOT" if path=="/" else "AUTH_USERS" if path.startswith("/project") else "AUTH_SETTINGS")+"_STATUS="+str(res.status))
 except urllib.error.HTTPError as ex:
  print("HTTPS_"+("ROOT" if path=="/" else "AUTH_USERS" if path.startswith("/project") else "AUTH_SETTINGS")+"_STATUS="+str(ex.code))
 except Exception:
  print("HTTPS_"+("ROOT" if path=="/" else "AUTH_USERS" if path.startswith("/project") else "AUTH_SETTINGS")+"_STATUS=UNAVAILABLE")
PY
echo "OVH_STORAGE_AUDIT=DONE"
