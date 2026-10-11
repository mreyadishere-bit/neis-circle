#!/usr/bin/env python3
"""Deploy private OVH database breakdown + hourly bounded retention.
No cloud usage, new containers or manual mail sending. Preserve current live release.
"""
from pathlib import Path
import json,subprocess,shutil,sys

ROOT=Path("/home/ubuntu/neis-supabase")
STAGE=Path("/home/ubuntu/neis-backups/db-optimization-20261011-v1")
RELEASE=Path("/home/ubuntu/neis-frontend/releases/ovh-db-optimization-20261011-v1")
OVERLAY=ROOT/"docker-compose.frontend-public.yml"
WORKER=Path("/home/ubuntu/.local/share/neis-private-monitor/db-retention.py")
SERVICE=Path("/etc/systemd/system/neis-db-retention.service")
TIMER=Path("/etc/systemd/system/neis-db-retention.timer")
DOCKER=["sudo","-n","/usr/bin/docker"]
COMPOSE=DOCKER+["compose"]+[part for file in (
 "docker-compose.yml","docker-compose.security.yml","docker-compose.caddy.yml",
 "docker-compose.frontend-public.yml","docker-compose.auth-public-direct.yml")
 for part in ("-f",file)]
phase="preflight"

def cmd(argv,stdin=None,check=True,timeout=85):
  r=subprocess.run(argv,cwd=ROOT,input=stdin,capture_output=True,text=True,timeout=timeout)
  if check and r.returncode:raise RuntimeError("COMMAND_FAILED")
  return r
def need(condition,error):
  if not condition:raise RuntimeError(error)
def pg(statement,check=True):
  return cmd(COMPOSE+["exec","-T","db","psql","-X","-v","ON_ERROR_STOP=1",
         "-U","postgres","-d","postgres","-Atq"],stdin=statement,timeout=85,check=check)

def main():
  global phase
  need(STAGE.is_dir() and OVERLAY.is_file(),"MISSING_STAGING")
  for filename in ("migration.sql","ui.js","worker.py","service.unit","timer.unit"):
    need((STAGE/filename).is_file(),"MISSING_STAGING_FILE")
  sql=(STAGE/"migration.sql").read_text()
  ui=(STAGE/"ui.js").read_text()
  worker=(STAGE/"worker.py").read_text()
  need("main_admin_database_storage" in sql and
    "neis_maintenance_storage_retention" in sql and
    "status='sent'" in sql and "interval '24 hours'" in sql and
    "interval '90 days'" in sql and
    "auth.role()<>'authenticated'" in sql and
    "revoke all on function public.main_admin_database_storage()" in sql,
    "DB_SAFETY_MISSING")
  need("owner()" in ui and "main_admin_database_storage" in ui and
       "Database Storage Breakdown" in ui and "--st-bg" not in ui,
       "UI_SAFETY_MISSING")
  need("neis_maintenance_storage_retention" in worker and
       "OnCalendar=hourly" in (STAGE/"timer.unit").read_text() and
       "db-retention.py" in (STAGE/"service.unit").read_text(),
       "TIMER_SAFETY_MISSING")
  cmd(["node","--check",str(STAGE/"ui.js")],timeout=15)
  cmd(["python3","-m","py_compile",str(STAGE/"worker.py")],timeout=15)
  cmd(COMPOSE+["config","--quiet"],timeout=35)
  inspect=json.loads(cmd(DOCKER+["inspect","supabase-caddy"],timeout=20).stdout)[0]
  mounted=[m["Source"] for m in inspect.get("Mounts",[]) if
           m.get("Type")=="bind" and m.get("Destination")=="/srv/neis-circle"]
  need(len(mounted)==1,"FRONTEND_NOT_MOUNTED")
  source=Path(mounted[0])
  need(source.is_dir() and str(source).startswith("/home/ubuntu/neis-frontend/releases/"),
       "WRONG_RELEASE")
  html=(source/"index.html").read_text()
  need("main-admin-auth-studio-v5.js?authstudio=20261011v5" in html and
       "server-usage-admin-v1.js?usage=20261011v3" in html and
       html.count("</body>")==1 and "main-admin-db-storage-v1.js" not in html,
       "UNEXPECTED_FRONTEND_VERSION")
  original=OVERLAY.read_text()
  need(original.count(str(source))==1,"FRONTEND_OVERLAY_CHANGED")
  need(not RELEASE.exists() and not Path(str(RELEASE)+".building").exists(),"RELEASE_EXISTS")
  need(not SERVICE.exists() and not TIMER.exists() and not WORKER.exists(),
       "MAINTENANCE_UNIT_COLLISION")
  count=sum(f.is_file() for f in source.rglob("*"))
  need(count>100,"SOURCE_FRONTEND_INCOMPLETE")
  # Keep manual broadcasts + all pending/failed jobs. Preflight safety.
  counts=pg("""select
   (select count(*) from public.email_notification_outbox where status in ('pending','failed','sending'))||'|'||
   (select count(*) from public.email_notification_outbox where status='sent'
    and processed_at < now()-interval '30 days')||'|'||
   (select count(*) from public.neis_private_server_usage_samples);""").stdout.strip()
  vals=list(map(int,counts.split("|")))
  need(len(vals)==3,"DATABASE_PREFLIGHT_FAILED")
  print("DB_PRECHECK_UNTOUCHABLE_PENDING_FAILED_SENDING="+str(vals[0]))
  print("DB_PRECHECK_POTENTIALLY_EXPIRED_RECEIPTS="+str(vals[1]))
  print("DB_PRECHECK_TELEMETRY_ROWS="+str(vals[2]))

  # Prepare immutable copy BEFORE any live service/config changes.
  phase="stage_release"
  tmp=Path(str(RELEASE)+".building")
  shutil.copytree(source,tmp)
  shutil.copy2(STAGE/"ui.js",tmp/"scripts/main-admin-db-storage-v1.js")
  updated=html.replace("</body>",
    '<script defer src="scripts/main-admin-db-storage-v1.js?dbstorage=20261011v1"></script>\n</body>')
  (tmp/"index.html").write_text(updated)
  need(sum(f.is_file() for f in tmp.rglob("*"))==count+1,"COPY_INCOMPLETE")
  tmp.rename(RELEASE)
  (STAGE/"original-frontend-overlay.yml").write_text(original)

  phase="database"
  pg(sql)
  rights=pg("""select case when
     to_regprocedure('public.main_admin_database_storage()') is not null and
     not has_function_privilege('anon','public.main_admin_database_storage()','EXECUTE') and
     not has_function_privilege('anon','public.neis_maintenance_storage_retention()','EXECUTE') and
     not has_function_privilege('authenticated','public.neis_maintenance_storage_retention()','EXECUTE')
     then 'SAFE' else 'UNSAFE' end;""").stdout.strip()
  need(rights=="SAFE","DB_PERMISSIONS_UNSAFE")
  denied=pg("""begin;
    set local role authenticated;
    select set_config('request.jwt.claim.role','authenticated',true);
    select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
    select public.main_admin_database_storage();rollback;""",check=False)
  need(denied.returncode!=0,"NON_OWNER_NOT_DENIED")

  phase="maintenance_install"
  WORKER.parent.mkdir(parents=True,exist_ok=True)
  tmp_worker=Path(str(WORKER)+".new")
  shutil.copy2(STAGE/"worker.py",tmp_worker)
  tmp_worker.chmod(0o600)
  tmp_worker.replace(WORKER)
  cmd(["sudo","-n","install","-m","0644",str(STAGE/"service.unit"),str(SERVICE)],timeout=25)
  cmd(["sudo","-n","install","-m","0644",str(STAGE/"timer.unit"),str(TIMER)],timeout=25)
  cmd(["sudo","-n","/usr/bin/systemctl","daemon-reload"],timeout=30)
  cmd(["sudo","-n","/usr/bin/systemctl","enable","--now","neis-db-retention.timer"],timeout=35)
  cmd(["sudo","-n","/usr/bin/systemctl","start","neis-db-retention.service"],timeout=125)
  result=pg("""select case when
   exists(select 1 from public.neis_private_storage_daily where day=(now() at time zone 'UTC')::date)
   and exists(select 1 from public.neis_private_usage_daily where day=(now() at time zone 'UTC')::date)
   then 'SUCCESS' else 'MISSING' end;""").stdout.strip()
  need(result=="SUCCESS","DAILY_BASELINE_MISSING")
  enabled=cmd(["sudo","-n","/usr/bin/systemctl","is-enabled","neis-db-retention.timer"],
              check=False,timeout=15).stdout.strip()
  need(enabled=="enabled","MAINTENANCE_TIMER_NOT_ENABLED")

  phase="activate_ui"
  activated=False
  try:
    OVERLAY.write_text(original.replace(str(source),str(RELEASE)))
    activated=True
    cmd(COMPOSE+["config","--quiet"],timeout=35)
    cmd(COMPOSE+["up","-d","--no-deps","caddy"],timeout=110)
    cid=cmd(COMPOSE+["ps","-q","caddy"],timeout=22).stdout.strip()
    need(bool(cid),"CADDY_NOT_READY")
    live=cmd(DOCKER+["exec",cid,"cat","/srv/neis-circle/index.html"],timeout=22).stdout
    js=cmd(DOCKER+["exec",cid,"cat","/srv/neis-circle/scripts/main-admin-db-storage-v1.js"],
           timeout=22).stdout
    need("dbstorage=20261011v1" in live and
         "server-usage-admin-v1.js?usage=20261011v3" in live and
         "main-admin-auth-studio-v5.js?authstudio=20261011v5" in live and
         "main_admin_database_storage" in js,"LIVE_UI_UNVERIFIED")
    proxy=cmd(DOCKER+["exec",cid,"cat","/etc/caddy/Caddyfile"],timeout=22).stdout
    need(all(k in proxy for k in ("reverse_proxy rest:3000",
         "reverse_proxy auth:9999","basic_auth")),"PROXY_CHANGED")
  except Exception:
    if activated:
      OVERLAY.write_text(original)
      cmd(COMPOSE+["up","-d","--no-deps","caddy"],timeout=100,check=False)
      print("DB_OPTIMIZATION_FRONTEND=ROLLED_BACK")
    raise

  read=pg("""select (public.main_admin_server_usage() is null)::text
    where false;""",check=False)
  # All status is aggregate. No personal/account data disclosed.
  print("DB_OPTIMIZATION_DEPLOY=SUCCESS")
  print("DB_OPTIMIZATION_DETAILED_RETENTION=24_HOURS")
  print("DB_OPTIMIZATION_SUMMARIES=90_DAYS")
  print("DB_OPTIMIZATION_EMAIL_COMPLETED_RETENTION=30_DAYS")
  print("DB_OPTIMIZATION_MANUAL_EMAIL_RETENTION=90_DAYS")
  print("DB_OPTIMIZATION_PENDING_FAILED_MAIL=PRESERVED")
  print("DB_OPTIMIZATION_OWNER_ONLY=POSTGRES_VERIFIED")
  print("DB_OPTIMIZATION_DASHBOARD=LIVE")
  print("DB_OPTIMIZATION_TIMER=ENABLED")
  print("DB_OPTIMIZATION_GOOGLE_AND_CADDY=UNCHANGED")
if __name__=="__main__":
  try:main()
  except Exception as e:
    allowed={
      "MISSING_STAGING","MISSING_STAGING_FILE","DB_SAFETY_MISSING","UI_SAFETY_MISSING",
      "TIMER_SAFETY_MISSING","FRONTEND_NOT_MOUNTED","WRONG_RELEASE",
      "UNEXPECTED_FRONTEND_VERSION","FRONTEND_OVERLAY_CHANGED","RELEASE_EXISTS",
      "MAINTENANCE_UNIT_COLLISION","SOURCE_FRONTEND_INCOMPLETE",
      "DATABASE_PREFLIGHT_FAILED","COPY_INCOMPLETE","DB_PERMISSIONS_UNSAFE",
      "NON_OWNER_NOT_DENIED","DAILY_BASELINE_MISSING","MAINTENANCE_TIMER_NOT_ENABLED",
      "CADDY_NOT_READY","LIVE_UI_UNVERIFIED","PROXY_CHANGED","COMMAND_FAILED"}
    code=str(e) if str(e) in allowed else "UNEXPECTED"
    print("DB_OPTIMIZATION_DEPLOY=FAILED_"+phase.upper()+"_"+code,file=sys.stderr)
    raise SystemExit(1)
