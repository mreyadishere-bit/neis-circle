#!/usr/bin/env python3
"""Add safe storage forecasts, repair private host Docker stats, preserve production routes."""
from pathlib import Path
import json
import re
import shutil
import subprocess
import sys
import urllib.request

ROOT=Path("/home/ubuntu/neis-supabase")
STAGE=Path("/home/ubuntu/neis-backups/server-usage-forecast-20261011")
OLD_RELEASE_ROOT="/home/ubuntu/neis-frontend/releases/"
NEW=Path(OLD_RELEASE_ROOT+"ovh-main-admin-server-usage-20261011-v2")
OVERLAY=ROOT/"docker-compose.frontend-public.yml"
MONITOR_UNIT=Path("/etc/systemd/system/neis-private-monitor.service")
AGENT=Path("/home/ubuntu/.local/share/neis-private-monitor/ingest.py")
COMPOSE=["sudo","-n","/usr/bin/docker","compose"]
for name in ("docker-compose.yml","docker-compose.security.yml","docker-compose.caddy.yml",
             "docker-compose.frontend-public.yml","docker-compose.auth-public-direct.yml"):
    COMPOSE+=["-f",name]
DOCKER=["sudo","-n","/usr/bin/docker"]

def run(args,stdin=None,timeout=75,check=True):
    r=subprocess.run(args,cwd=ROOT,input=stdin,text=True,capture_output=True,timeout=timeout)
    if check and r.returncode!=0:raise RuntimeError("FORECAST_DEPLOY=COMMAND_FAILED")
    return r

def assert_that(condition,reason):
    if not condition:raise RuntimeError("FORECAST_DEPLOY=BLOCKED_"+reason)

def sql(command):
    return run(COMPOSE+["exec","-T","db","psql","-X","-v","ON_ERROR_STOP=1",
                         "-U","postgres","-d","postgres","-Atq"],stdin=command,timeout=60).stdout.strip()

def health():
    with urllib.request.urlopen("http://127.0.0.1:8765/api/metrics",timeout=20) as stream:
        return json.load(stream)

def main():
    assert_that(STAGE.is_dir() and OVERLAY.is_file(),"PATHS")
    for filename in ("monitor.service","migration.sql","agent.py","ui.js"):
        assert_that((STAGE/filename).is_file(),"FILE_"+filename)
    assert_that(MONITOR_UNIT.is_file() and AGENT.is_file(),"EXISTING_SERVICES")
    run(COMPOSE+["config","--quiet"])
    current=json.loads(run(DOCKER+["inspect","supabase-caddy"]).stdout)[0]
    mounts=[m for m in current.get("Mounts",[]) if m.get("Destination")=="/srv/neis-circle" and m.get("Type")=="bind"]
    assert_that(len(mounts)==1,"FRONTEND_BIND")
    source=Path(mounts[0]["Source"])
    assert_that(str(source).startswith(OLD_RELEASE_ROOT) and source.is_dir(),"RELEASE_PATH")
    current_html=(source/"index.html").read_text()
    assert_that("server-usage-admin-v1.js?usage=20261011v1" in current_html
                and "main-admin-roles-v1.js" in current_html,"LIVE_EXPECTED_UI")
    assert_that(OVERLAY.read_text().count(str(source))==1,"OVERLAY_SOURCE")
    assert_that(not NEW.exists() and not Path(str(NEW)+".building").exists(),"RELEASE_ALREADY_EXISTS")
    assert_that("CapabilityBoundingSet=" not in (STAGE/"monitor.service").read_text(),
                "SERVICE_STILL_CAP_BLOCKED")
    assert_that("interval '30 days'" in (STAGE/"agent.py").read_text(),
                "AGENT_RETENTION")
    assert_that("main_admin_server_usage" in (STAGE/"migration.sql").read_text(),
                "OWNER_RPC_ABSENT")
    assert_that("Capacity Forecast" in (STAGE/"ui.js").read_text(),"FORECAST_UI_ABSENT")

    # Backup files before touching any active process. Live DB query is additive only.
    base=OVERLAY.read_text()
    (STAGE/"original.monitor.service").write_bytes(MONITOR_UNIT.read_bytes())
    (STAGE/"original.agent.py").write_bytes(AGENT.read_bytes())
    (STAGE/"original.frontend-overlay.yml").write_text(base)
    staged_ui=False
    services_changed=False
    try:
        # Removing an empty capability bounding set restores the original scoped sudo policy
        # required by approved /usr/bin/docker commands. Listener remains bound to localhost.
        run(["sudo","-n","/usr/bin/install","-m","644",str(STAGE/"monitor.service"),str(MONITOR_UNIT)])
        services_changed=True
        run(["sudo","-n","/usr/bin/systemctl","daemon-reload"])
        run(["sudo","-n","/usr/bin/systemctl","restart","neis-private-monitor.service"])
        readings=health()
        assert_that(readings.get("docker",{}).get("error") is False and
                    isinstance(readings.get("docker",{}).get("running"),int) and
                    readings["docker"]["running"]>0,"DOCKER_DATA_UNAVAILABLE")
        # DB size may still be unavailable from the HTTP monitor; ingest has an authorized
        # docker compose fallback; confirm it through the freshly collected DB record.
        sql((STAGE/"migration.sql").read_text())
        unauthorized=run(COMPOSE+["exec","-T","db","psql","-X","-v","ON_ERROR_STOP=1",
                                  "-U","postgres","-d","postgres","-Atq"],
                         stdin="set role anon; select public.main_admin_server_usage();",check=False)
        assert_that(unauthorized.returncode!=0,"ANONYMOUS_RPC_NOT_DENIED")
        shutil.copy2(STAGE/"agent.py",str(AGENT)+".new")
        Path(str(AGENT)+".new").chmod(0o600)
        Path(str(AGENT)+".new").replace(AGENT)
        run(["sudo","-n","/usr/bin/systemctl","start","neis-server-usage-sample.service"],timeout=70)
        check=sql("""select case when exists (
          select 1 from public.neis_private_server_usage_samples
          where collected_at>now()-interval '3 minutes'
            and jsonb_typeof(snapshot->'docker'->'running')='number'
            and (snapshot->'docker'->>'running')::integer>0
            and jsonb_typeof(snapshot->'database_bytes')='number'
        ) then 'LIVE_WITH_DOCKER_AND_DB' else 'DATA_MISSING' end;""")
        assert_that(check=="LIVE_WITH_DOCKER_AND_DB","SAMPLE_MISSING_DOCKER_OR_DB")
        assert_that(sql("select case when to_regprocedure('public.main_admin_server_usage()') is not null then 'OK' else 'MISSING' end;")=="OK","RPC_MISSING")
        old_count=sum(p.is_file() for p in source.rglob("*"))
        assert_that(old_count>100,"RELEASE_TOO_SMALL")
        tmp=Path(str(NEW)+".building")
        shutil.copytree(source,tmp)
        shutil.copy2(STAGE/"ui.js",tmp/"scripts/server-usage-admin-v1.js")
        updated_html=current_html.replace("server-usage-admin-v1.js?usage=20261011v1",
                                          "server-usage-admin-v1.js?usage=20261011v2")
        assert_that(updated_html!=current_html,"FRONTEND_QUERY_VERSION")
        (tmp/"index.html").write_text(updated_html)
        assert_that(sum(p.is_file() for p in tmp.rglob("*"))==old_count,"IMMUTABLE_COPY_FILE_COUNT")
        tmp.rename(NEW)
        OVERLAY.write_text(base.replace(str(source),str(NEW)))
        staged_ui=True
        run(COMPOSE+["config","--quiet"])
        run(COMPOSE+["up","-d","--no-deps","caddy"],timeout=100)
        cid=run(COMPOSE+["ps","-q","caddy"]).stdout.strip()
        assert_that(bool(cid),"CADDY_DOWN")
        deployed=run(DOCKER+["exec",cid,"cat","/srv/neis-circle/index.html"]).stdout
        assert_that("server-usage-admin-v1.js?usage=20261011v2" in deployed,"HTML_NOT_UPDATED")
        assert_that("main-admin-roles-v1.js" in deployed,"ADMIN_FEATURE_DROPPED")
        actual=run(DOCKER+["exec",cid,"cat","/srv/neis-circle/scripts/server-usage-admin-v1.js"]).stdout
        assert_that("Capacity Forecast" in actual,"SCRIPT_NOT_UPDATED")
        caddy=run(DOCKER+["exec",cid,"cat","/etc/caddy/Caddyfile"]).stdout
        for route in ("reverse_proxy rest:3000","reverse_proxy auth:9999","basic_auth"):
            assert_that(route in caddy,"ORIGINAL_ROUTE_MISSING")
        print("FORECAST_DEPLOY=SUCCESS")
        print("MONITOR_DOCKER_STATS=READY")
        print("MONITOR_POSTGRES_SIZE=READY")
        print("FORECAST_RETENTION_DAYS=30")
        print("FORECAST_PRIMARY_ADMIN_RPC=PROTECTED")
        print("FORECAST_FRONTEND=LIVE")
        print("GOOGLE_AUTH_REST_DATABASE_CONTENT=UNCHANGED")
    except Exception:
        if staged_ui:
            OVERLAY.write_text(base)
            run(COMPOSE+["up","-d","--no-deps","caddy"],timeout=90,check=False)
            print("FORECAST_DEPLOY=FRONTEND_ROLLBACK")
        if services_changed:
            run(["sudo","-n","/usr/bin/install","-m","644",str(STAGE/"original.monitor.service"),str(MONITOR_UNIT)],check=False)
            run(["sudo","-n","/usr/bin/systemctl","daemon-reload"],check=False)
            run(["sudo","-n","/usr/bin/systemctl","restart","neis-private-monitor.service"],check=False)
            shutil.copy2(STAGE/"original.agent.py",AGENT)
            print("FORECAST_DEPLOY=SERVICE_ROLLBACK")
        raise

if __name__=="__main__":
    try:main()
    except Exception as e:
        print(str(e) if str(e).startswith("FORECAST_DEPLOY=") else "FORECAST_DEPLOY=FAILED",file=sys.stderr)
        raise SystemExit(1)
