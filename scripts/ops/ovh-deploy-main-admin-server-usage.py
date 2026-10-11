#!/usr/bin/env python3
"""Safely install server telemetry and a primary-admin-only panel into the current OVH release."""
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

STAGE=Path("/home/ubuntu/neis-backups/server-usage-20261011")
ROOT=Path("/home/ubuntu/neis-supabase")
DEST=Path("/home/ubuntu/neis-frontend/releases/ovh-main-admin-server-usage-20261011-v1")
OVERLAY=ROOT/"docker-compose.frontend-public.yml"
BACKUP=STAGE/"frontend-public.before-server-usage.yml"
AGENT=Path("/home/ubuntu/.local/share/neis-private-monitor/ingest.py")
DOCKER=["sudo","-n","/usr/bin/docker"]
COMPOSE=DOCKER+["compose"]
for name in ("docker-compose.yml","docker-compose.security.yml","docker-compose.caddy.yml",
             "docker-compose.frontend-public.yml","docker-compose.auth-public-direct.yml"):
    COMPOSE+=["-f",name]

def execute(cmd, *, stdin=None, timeout=80, check=True):
    r=subprocess.run(cmd,cwd=ROOT,input=stdin,text=True,capture_output=True,timeout=timeout)
    if check and r.returncode:
        raise RuntimeError("SERVER_USAGE_DEPLOY=COMMAND_FAILED")
    return r

def require(cond,label):
    if not cond:
        raise RuntimeError("SERVER_USAGE_DEPLOY=BLOCKED_"+label)

def query(sql,timeout=50):
    return execute(COMPOSE+["exec","-T","db","psql","-X","-v","ON_ERROR_STOP=1",
                            "-U","postgres","-d","postgres","-Atq"],
                   stdin=sql,timeout=timeout).stdout.strip()

def rollback():
    if BACKUP.is_file():
        shutil.copy2(BACKUP,OVERLAY)
        execute(COMPOSE+["up","-d","--no-deps","caddy"],check=False,timeout=70)
        print("SERVER_USAGE_DEPLOY=FRONTEND_ROLLED_BACK")

def main():
    require(STAGE.is_dir() and ROOT.is_dir() and OVERLAY.is_file(),"PATHS")
    require(all((STAGE/f).is_file() for f in (
        "schema.sql","agent.py","ui.js","agent.service","agent.timer")),"STAGE_FILES")
    require((Path("/home/ubuntu/.local/share/neis-private-monitor/monitor.py")).is_file(),
            "PRIVATE_MONITOR_NOT_INSTALLED")
    execute(["python3","-m","py_compile",str(STAGE/"agent.py")])
    execute(["node","--check",str(STAGE/"ui.js")],check=False)
    execute(COMPOSE+["config","--quiet"])
    # Apply the single additive transaction to existing production database. Never migrate the user data.
    schema=(STAGE/"schema.sql").read_text()
    require("main_admin_server_usage" in schema and
            "revoke all on public.neis_private_server_usage_samples" in schema,
            "EXPECTED_MIGRATION")
    query(schema,timeout=60)
    ready=query("select case when to_regprocedure('public.main_admin_server_usage()') is not null "
                "and to_regclass('public.neis_private_server_usage_samples') is not null "
                "then 'READY' else 'MISSING' end;")
    require(ready=="READY","DATABASE_SCHEMA")
    # Deny anonymous requests at the DB layer even if the UI is bypassed.
    denied=execute(COMPOSE+["exec","-T","db","psql","-X","-v","ON_ERROR_STOP=1",
                             "-U","postgres","-d","postgres","-Atq"],
                   stdin="set role anon; select public.main_admin_server_usage();",
                   timeout=30,check=False)
    require(denied.returncode!=0,"ANONYMOUS_ACCESS_NOT_DENIED")
    # Install timer using the same privileged systemd mechanism as private monitoring.
    AGENT.parent.mkdir(parents=True,exist_ok=True)
    if AGENT.exists():
        shutil.copy2(AGENT,str(AGENT)+".previous")
    shutil.copy2(STAGE/"agent.py",AGENT)
    AGENT.chmod(0o600)
    execute(["sudo","-n","/usr/bin/install","-m","644",str(STAGE/"agent.service"),
             "/etc/systemd/system/neis-server-usage-sample.service"])
    execute(["sudo","-n","/usr/bin/install","-m","644",str(STAGE/"agent.timer"),
             "/etc/systemd/system/neis-server-usage-sample.timer"])
    execute(["sudo","-n","/usr/bin/systemctl","daemon-reload"])
    execute(["sudo","-n","/usr/bin/systemctl","enable","--now","neis-server-usage-sample.timer"])
    execute(["sudo","-n","/usr/bin/systemctl","start","neis-server-usage-sample.service"],timeout=60)
    row=query("select case when exists (select 1 from public.neis_private_server_usage_samples "
              "where collected_at > now()-interval '3 minutes') then 'FRESH' else 'EMPTY' end;")
    require(row=="FRESH","FIRST_SAMPLE_MISSING")
    # Only after DB and first sample succeed: stage immutable copy of currently mounted live release.
    info=json.loads(execute(DOCKER+["inspect","supabase-caddy"]).stdout)[0]
    mounts=[m for m in info.get("Mounts",[]) if m.get("Type")=="bind"
            and m.get("Destination")=="/srv/neis-circle"]
    require(len(mounts)==1,"FRONTEND_MOUNT")
    source=Path(mounts[0]["Source"])
    require(source.is_dir() and str(source).startswith("/home/ubuntu/neis-frontend/releases/"),
            "CURRENT_RELEASE")
    old_html=(source/"index.html").read_text()
    require("</body>" in old_html.lower() and
            (source/"scripts/main-admin-roles-v1.js").is_file() and
            "scripts/main-admin-roles-v1.js" in old_html,
            "MAIN_ADMIN_FEATURE_NOT_PRESENT")
    current=OVERLAY.read_text()
    if source==DEST:
        require((DEST/"scripts/server-usage-admin-v1.js").is_file() and
                "server-usage-admin-v1.js?usage=20261011v1" in old_html,
                "ALREADY_DEPLOYED_BUT_UNEXPECTED")
        print("SERVER_USAGE_DEPLOY=ALREADY_INSTALLED")
        return
    require(current.count(str(source))==1,"MOUNT_TARGET_UNEXPECTED")
    require(not DEST.exists() and not Path(str(DEST)+".building").exists(),"DEST_EXISTS")
    num_files=sum(p.is_file() for p in source.rglob("*"))
    require(num_files>100,"CURRENT_RELEASE_INCOMPLETE")
    temporary=Path(str(DEST)+".building")
    shutil.copytree(source,temporary)
    target=temporary/"scripts/server-usage-admin-v1.js"
    require(not target.exists(),"FRONTEND_SCRIPT_ALREADY_PRESENT")
    shutil.copy2(STAGE/"ui.js",target)
    html=(temporary/"index.html").read_text()
    require("server-usage-admin-v1.js" not in html,"DUPLICATE_SCRIPT")
    script='<script defer src="scripts/server-usage-admin-v1.js?usage=20261011v1"></script>\n'
    html=re.sub(r"</body>",lambda m:script+m.group(0),html,count=1,flags=re.I)
    (temporary/"index.html").write_text(html)
    require(sum(p.is_file() for p in temporary.rglob("*"))==num_files+1,
            "FRONTEND_RELEASE_FILES")
    temporary.rename(DEST)
    BACKUP.write_text(current)
    OVERLAY.write_text(current.replace(str(source),str(DEST)))
    try:
        execute(COMPOSE+["config","--quiet"])
        execute(COMPOSE+["up","-d","--no-deps","caddy"],timeout=85)
        cid=execute(COMPOSE+["ps","-q","caddy"]).stdout.strip()
        require(bool(cid),"CADDY_STOPPED")
        actual=execute(DOCKER+["exec",cid,"cat","/srv/neis-circle/index.html"]).stdout
        require("server-usage-admin-v1.js?usage=20261011v1" in actual,
                "FRONTEND_NOT_LIVE")
        require("main-admin-roles-v1.js" in actual,"ADMIN_ROLES_REMOVED")
        # Read all route paths instead of replacing/reloading Caddy config.
        caddy=execute(DOCKER+["exec",cid,"cat","/etc/caddy/Caddyfile"]).stdout
        for signature in ("reverse_proxy rest:3000","reverse_proxy auth:9999","basic_auth"):
            require(signature in caddy,"ORIGINAL_ROUTES")
        print("SERVER_USAGE_DEPLOY=SUCCESS")
        print("SERVER_USAGE_ADMIN_RPC=PRIMARY_ACCOUNT_ONLY")
        print("SERVER_USAGE_SAMPLE=FRESH")
        print("SERVER_USAGE_FRONTEND=UPDATED")
        print("SERVER_USAGE_AUTH_REST_CADDY_CONFIG=UNCHANGED")
    except Exception:
        rollback()
        raise

if __name__=="__main__":
    try:main()
    except Exception as exc:
        msg=str(exc)
        print(msg if msg.startswith("SERVER_USAGE_DEPLOY=") else
              "SERVER_USAGE_DEPLOY=FAILED",file=sys.stderr)
        raise SystemExit(1)
