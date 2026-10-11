#!/usr/bin/env python3
"""Install v3 server usage forecast without restarting Caddy auth or monitor services."""
from pathlib import Path
import json
import shutil
import subprocess
import sys
import urllib.request

ROOT=Path("/home/ubuntu/neis-supabase")
STAGE=Path("/home/ubuntu/neis-backups/server-usage-forecast-20261011-v3")
DEST=Path("/home/ubuntu/neis-frontend/releases/ovh-main-admin-server-usage-20261011-v3")
OVERLAY=ROOT/"docker-compose.frontend-public.yml"
AGENT=Path("/home/ubuntu/.local/share/neis-private-monitor/ingest.py")
DOCKER=["sudo","-n","/usr/bin/docker"]
COMPOSE=DOCKER+["compose"]+[x for name in (
    "docker-compose.yml","docker-compose.security.yml","docker-compose.caddy.yml",
    "docker-compose.frontend-public.yml","docker-compose.auth-public-direct.yml")
    for x in ("-f",name)]

phase="preflight"
def run(cmd,stdin=None,timeout=75,check=True):
    r=subprocess.run(cmd,cwd=ROOT,input=stdin,capture_output=True,text=True,timeout=timeout)
    if check and r.returncode:
        raise RuntimeError("COMMAND_EXIT_NONZERO")
    return r

def check(condition,reason):
    if not condition:raise RuntimeError(reason)

def sql(statement,check_result=True):
    return run(COMPOSE+["exec","-T","db","psql","-X","-v","ON_ERROR_STOP=1",
                        "-U","postgres","-d","postgres","-Atq"],
               stdin=statement,timeout=55,check=check_result)

def safe_line(s):
    # Never print SQL, stderr or secrets to public GitHub logs.
    return s if s in (
        "COMMAND_EXIT_NONZERO","FRONTEND_MOUNT","FRONTEND_SOURCE","FRONTEND_VERSION",
        "FRONTEND_OVERLAY","FRONTEND_ALREADY_CREATED","FRONTEND_COPY",
        "DATABASE_RPC_MISSING","DENIAL_CHECK_FAILED",
        "DOCKER_READINGS_MISSING","POSTGRES_READINGS_MISSING",
        "NOT_READY","NO_AGENT","CADDY_NOT_READY",
        "LIVE_FILE_MISMATCH","ROUTES_CHANGED","SERVICE_FAILED") else "UNEXPECTED_ERROR"

def main():
    global phase
    check(STAGE.is_dir() and OVERLAY.is_file() and AGENT.is_file(),"NOT_READY")
    for name in ("migration.sql","agent.py","ui.js"):
        check((STAGE/name).is_file(),"NOT_READY")
    run(COMPOSE+["config","--quiet"])
    info=json.loads(run(DOCKER+["inspect","supabase-caddy"]).stdout)[0]
    mounts=[v for v in info.get("Mounts",[]) if v.get("Type")=="bind" and v.get("Destination")=="/srv/neis-circle"]
    check(len(mounts)==1,"FRONTEND_MOUNT")
    source=Path(mounts[0]["Source"])
    check(source.is_dir() and str(source).startswith("/home/ubuntu/neis-frontend/releases/"),"FRONTEND_SOURCE")
    old_html=(source/"index.html").read_text()
    check("server-usage-admin-v1.js?usage=20261011v1" in old_html and
          "main-admin-roles-v1.js" in old_html,"FRONTEND_VERSION")
    original=OVERLAY.read_text()
    check(original.count(str(source))==1,"FRONTEND_OVERLAY")
    check(not DEST.exists() and not Path(str(DEST)+".building").exists(),"FRONTEND_ALREADY_CREATED")
    check("interval '30 days'" in (STAGE/"agent.py").read_text(),"NOT_READY")
    check("Capacity Forecast" in (STAGE/"ui.js").read_text(),"NOT_READY")
    original_agent=AGENT.read_bytes()
    (STAGE/"agent.backup.py").write_bytes(original_agent)
    (STAGE/"frontend.backup.yml").write_text(original)
    agent_changed=False
    ui_changed=False
    try:
        phase="db_migration"
        sql((STAGE/"migration.sql").read_text())
        ready=sql("select case when to_regprocedure('public.main_admin_server_usage()') is not null then 'YES' else 'NO' end;").stdout.strip()
        check(ready=="YES","DATABASE_RPC_MISSING")
        denied=sql("set role anon; select public.main_admin_server_usage();",check_result=False)
        check(denied.returncode!=0,"DENIAL_CHECK_FAILED")
        phase="ingest_install"
        new_agent=Path(str(AGENT)+".forecast-v3-new")
        shutil.copy2(STAGE/"agent.py",new_agent)
        new_agent.chmod(0o600)
        new_agent.replace(AGENT)
        agent_changed=True
        phase="live_sample"
        run(["sudo","-n","/usr/bin/systemctl","start","neis-server-usage-sample.service"],timeout=75)
        sample=sql("""select case when exists (
           select 1 from public.neis_private_server_usage_samples
             where collected_at>now()-interval '3 minutes'
               and jsonb_typeof(snapshot->'docker'->'running')='number'
               and (snapshot->'docker'->>'running')::integer>0
         ) then 'GOOD' else 'MISSING' end;""").stdout.strip()
        check(sample=="GOOD","DOCKER_READINGS_MISSING")
        db_sample=sql("""select case when exists (
          select 1 from public.neis_private_server_usage_samples
          where collected_at>now()-interval '3 minutes'
            and jsonb_typeof(snapshot->'database_bytes')='number'
            and (snapshot->>'database_bytes')::bigint>0
        ) then 'GOOD' else 'MISSING' end;""").stdout.strip()
        check(db_sample=="GOOD","POSTGRES_READINGS_MISSING")
        phase="release_copy"
        old_files=sum(p.is_file() for p in source.rglob("*"))
        check(old_files>100,"FRONTEND_COPY")
        tmp=Path(str(DEST)+".building")
        shutil.copytree(source,tmp)
        shutil.copy2(STAGE/"ui.js",tmp/"scripts/server-usage-admin-v1.js")
        (tmp/"index.html").write_text(old_html.replace(
            "server-usage-admin-v1.js?usage=20261011v1",
            "server-usage-admin-v1.js?usage=20261011v3"))
        check(sum(p.is_file() for p in tmp.rglob("*"))==old_files,"FRONTEND_COPY")
        tmp.rename(DEST)
        phase="activate"
        OVERLAY.write_text(original.replace(str(source),str(DEST)))
        ui_changed=True
        run(COMPOSE+["config","--quiet"])
        run(COMPOSE+["up","-d","--no-deps","caddy"],timeout=100)
        cid=run(COMPOSE+["ps","-q","caddy"]).stdout.strip()
        check(bool(cid),"CADDY_NOT_READY")
        index=run(DOCKER+["exec",cid,"cat","/srv/neis-circle/index.html"]).stdout
        js=run(DOCKER+["exec",cid,"cat","/srv/neis-circle/scripts/server-usage-admin-v1.js"]).stdout
        check("server-usage-admin-v1.js?usage=20261011v3" in index and
              "main-admin-roles-v1.js" in index and "Capacity Forecast" in js,
              "LIVE_FILE_MISMATCH")
        proxy=run(DOCKER+["exec",cid,"cat","/etc/caddy/Caddyfile"]).stdout
        check(all(word in proxy for word in ("reverse_proxy rest:3000","reverse_proxy auth:9999","basic_auth")),
              "ROUTES_CHANGED")
        print("FORECAST_V3_DEPLOY=SUCCESS")
        print("FORECAST_V3_DOCKER=VISIBLE")
        print("FORECAST_V3_POSTGRES_SIZE=VISIBLE")
        print("FORECAST_V3_RETENTION=30_DAYS")
        print("FORECAST_V3_OWNER_ACCESS=RESTRICTED")
        print("FORECAST_V3_LIVE_UI=YES")
        print("FORECAST_V3_AUTH_AND_CADDY_ROUTES=UNCHANGED")
    except Exception:
        if ui_changed:
            OVERLAY.write_text(original)
            run(COMPOSE+["up","-d","--no-deps","caddy"],timeout=85,check=False)
            print("FORECAST_V3_FRONTEND_ROLLED_BACK")
        if agent_changed:
            AGENT.write_bytes(original_agent)
            AGENT.chmod(0o600)
            print("FORECAST_V3_AGENT_ROLLED_BACK")
        raise

if __name__=="__main__":
    try:main()
    except Exception as error:
        print("FORECAST_V3_DEPLOY=FAILED_AT_"+phase.upper()+"_"+safe_line(str(error)),
              file=sys.stderr)
        raise SystemExit(1)
