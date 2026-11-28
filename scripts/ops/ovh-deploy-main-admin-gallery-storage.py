#!/usr/bin/env python3
"""Add a primary-admin-only Gallery object-size RPC and isolated OVH admin panel."""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT=Path("/home/ubuntu/neis-supabase")
BACKUPS=Path("/home/ubuntu/neis-backups")
RELEASES=Path("/home/ubuntu/neis-frontend/releases")
OVERLAY=ROOT/"docker-compose.frontend-public.yml"
DOCKER=["sudo","-n","/usr/bin/docker"]
FILES=("docker-compose.yml","docker-compose.security.yml","docker-compose.caddy.yml",
       "docker-compose.frontend-public.yml","docker-compose.auth-public-direct.yml")
COMPOSE=DOCKER+["compose"]+[v for f in FILES for v in ("-f",str(ROOT/f))]
RUN_ID=os.environ.get("NEIS_GALLERY_STORAGE_RUN_ID","")
STAGE=BACKUPS/("gallery-storage-"+RUN_ID)
phase="preflight"

def run(argv, *, data=None, timeout=120, check=True):
    p=subprocess.run(argv,cwd=ROOT,input=data,stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,timeout=timeout)
    if check and p.returncode:
        diagnostic=p.stderr.decode("utf-8","replace").strip().splitlines()
        detail=diagnostic[-1][:200] if diagnostic else ""
        detail=re.sub(r"(?i)(password|secret|token|key)=\S+",r"\1=[redacted]",detail)
        detail=re.sub(r"(?i)(postgres(?:ql)?://)[^@\s]+@",r"\1[redacted]@",detail)
        raise RuntimeError("COMMAND_FAILED_"+str(p.returncode)+":"+detail)
    return p

def output(argv, timeout=60):
    return run(argv,timeout=timeout).stdout.decode("utf-8","replace").strip()

def sql(statement, timeout=60):
    command=COMPOSE+["exec","-T","db","psql","-X","-v","ON_ERROR_STOP=1",
        "-U","postgres","-d","postgres","-Atq"]
    return run(command,data=statement.encode(),timeout=timeout).stdout.decode("utf-8","replace").strip()

def require(condition,label):
    if not condition:
        raise RuntimeError("BLOCKED_"+label)

def verify_backup(dump):
    with dump.open("rb") as source:
        checked=subprocess.run(COMPOSE+["exec","-T","-u","postgres","db","pg_restore","--list"],
            cwd=ROOT,stdin=source,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,timeout=90)
    if checked.returncode:
        raise RuntimeError("DATABASE_BACKUP_INVALID")
    checksum=hashlib.sha256(dump.read_bytes()).hexdigest()
    digest_file=dump.parent/"SHA256"
    digest_file.write_text(checksum+"  pre-gallery-storage.dump\n")
    os.chmod(dump,0o600)
    os.chmod(digest_file,0o600)

def owner_probe():
    claims=(
      "BEGIN;\n"
      "SET LOCAL ROLE authenticated;\n"
      "SELECT set_config('request.jwt.claim.sub','25b556a3-ec6f-49e7-ac6c-1b09720e3bfd',true);\n"
      "SELECT set_config('request.jwt.claim.role','authenticated',true);\n"
      "SELECT set_config('request.jwt.claims','"
      "{\"sub\":\"25b556a3-ec6f-49e7-ac6c-1b09720e3bfd\","
      "\"role\":\"authenticated\",\"email\":\"mreyadishere@gmail.com\"}',true);\n"
      "SELECT public.main_admin_gallery_storage();\n"
      "ROLLBACK;\n"
    )
    result=run(COMPOSE+["exec","-T","db","psql","-X","-v","ON_ERROR_STOP=1",
        "-U","postgres","-d","postgres","-Atq"],data=claims.encode(),timeout=40)
    rows=[line.strip() for line in result.stdout.decode("utf-8","replace").splitlines()
          if line.strip().startswith("{") and "total_bytes" in line]
    require(bool(rows),"OWNER_RPC_PROBE")
    data=json.loads(rows[-1])
    require(all(key in data for key in ("total_bytes","object_count",
        "measured_object_count","unmeasured_object_count")),"OWNER_RPC_SHAPE")
    require(int(data["total_bytes"])>=0 and int(data["object_count"])>=0,"OWNER_RPC_VALUES")
    require(int(data["measured_object_count"])+int(data["unmeasured_object_count"])
        ==int(data["object_count"]),"OWNER_RPC_COUNTS")
    return data

def main():
    global phase
    require(re.fullmatch(r"[0-9]+-[0-9]+",RUN_ID) is not None,"RUN_ID")
    require(ROOT.is_dir() and BACKUPS.is_dir() and RELEASES.is_dir() and OVERLAY.is_file(),"OVH_PATHS")
    for name in ("schema.sql","ui.js","deploy.py"):
        path=STAGE/name
        require(path.is_file() and not path.is_symlink() and path.stat().st_size>0,"STAGE_FILES")
    require(all((ROOT/name).is_file() for name in FILES),"COMPOSE_FILES")
    migration=(STAGE/"schema.sql").read_text()
    ui=(STAGE/"ui.js").read_text()
    require("main_admin_gallery_storage" in migration and
        "storage.objects" in migration and "metadata->>'size'" in migration,
        "MIGRATION_CONTRACT")
    require("sb.rpc('main_admin_gallery_storage')" in ui and
        "Total Gallery storage (Photograph + Art combined)" in ui,
        "UI_CONTRACT")
    run(["node","--check",str(STAGE/"ui.js")],timeout=30)
    run(COMPOSE+["config","--quiet"],timeout=60)

    # Confirm the live Storage metadata schema and existing bucket before writing.
    shape=sql("""select data_type from information_schema.columns
      where table_schema='storage' and table_name='objects' and column_name='metadata'""")
    require(shape=="jsonb","STORAGE_OBJECT_METADATA_UNAVAILABLE")
    bucket=sql("select count(*) from storage.buckets where id='community-media'")
    require(bucket=="1","COMMUNITY_MEDIA_BUCKET_MISSING")
    require(sql("select to_regclass('public.gallery_items') is not null")=="t",
        "GALLERY_ITEMS_TABLE_MISSING")

    phase="database_backup"
    db_size=int(sql("select pg_database_size('postgres')"))
    require(shutil.disk_usage(BACKUPS).free>=int(db_size*1.3)+536870912,"LOW_DISK_SPACE")
    backup=STAGE/"database-backup"
    backup.mkdir(mode=0o700,exist_ok=True)
    dump=backup/"pre-gallery-storage.dump"
    with dump.open("wb") as stream:
        process=subprocess.run(COMPOSE+["exec","-T","-u","postgres","db","pg_dump",
            "-U","postgres","-d","postgres","--format=custom","--no-owner","--no-acl"],
            cwd=ROOT,stdin=subprocess.DEVNULL,stdout=stream,stderr=subprocess.PIPE,timeout=300)
    if process.returncode or not dump.is_file() or dump.stat().st_size==0:
        raise RuntimeError("DATABASE_BACKUP_FAILED")
    verify_backup(dump)
    print("GALLERY_STORAGE_DB_BACKUP=VERIFIED_PRIVATE")

    phase="database_migration"
    run(COMPOSE+["exec","-T","db","psql","-X","-v","ON_ERROR_STOP=1",
        "--single-transaction","-U","postgres","-d","postgres"],
        data=migration.encode(),timeout=120)
    grants=sql("""select
      to_regprocedure('public.main_admin_gallery_storage()') is not null
      and has_function_privilege('authenticated','public.main_admin_gallery_storage()','EXECUTE')
      and not has_function_privilege('anon','public.main_admin_gallery_storage()','EXECUTE')""")
    require(grants=="t","DATABASE_RPC_GRANTS")
    metrics=owner_probe()
    print("GALLERY_STORAGE_RPC=VERIFIED")
    print("GALLERY_STORAGE_OBJECTS="+str(metrics["object_count"]))
    print("GALLERY_STORAGE_BYTES="+str(metrics["total_bytes"]))

    phase="stage_frontend"
    info=json.loads(output(DOCKER+["inspect","supabase-caddy"],timeout=30))[0]
    mounts=[Path(item["Source"]) for item in info.get("Mounts",[])
        if item.get("Type")=="bind" and item.get("Destination")=="/srv/neis-circle"]
    require(len(mounts)==1,"ACTIVE_CADDY_MOUNT")
    source=mounts[0]
    require(str(source).startswith(str(RELEASES)+"/") and
        source.is_dir() and not source.is_symlink(),"ACTIVE_RELEASE_PATH")
    source_html=(source/"index.html").read_text()
    for marker in ("main-admin-db-storage-v1.js","gallery-pinterest-v1.js",
                   "main-admin-roles-v1.js"):
        require(marker in source_html,"CURRENT_FEATURE_MISSING_"+marker)
    require("gallery-storage-admin-v1.js" not in source_html,"PANEL_ALREADY_REFERENCED")
    require((source/"scripts/main-admin-db-storage-v1.js").is_file(),"DATABASE_ADMIN_SCRIPT_MISSING")
    require((source/"scripts/gallery-pinterest-v1.js").is_file(),"GALLERY_SCRIPT_MISSING")
    overlay=OVERLAY.read_text()
    require(overlay.count(str(source))==1,"FRONTEND_OVERLAY_MISMATCH")

    release=RELEASES/("gallery-storage-"+RUN_ID)
    building=Path(str(release)+".building")
    require(not release.exists() and not building.exists(),"RELEASE_PATH_EXISTS")
    source_files=sum(path.is_file() for path in source.rglob("*"))
    require(source_files>100,"ACTIVE_RELEASE_INCOMPLETE")
    shutil.copytree(source,building)
    script_path=building/"scripts/gallery-storage-admin-v1.js"
    require(not script_path.exists(),"SCRIPT_TARGET_EXISTS")
    shutil.copy2(STAGE/"ui.js",script_path)
    html_path=building/"index.html"
    html=html_path.read_text()
    anchor=re.compile(
      r'(?m)^([ \t]*<script\b(?=[^>]*\bsrc=["\']scripts/main-admin-db-storage-v1\.js(?:\?[^"\']*)?["\'])'
      r'(?=[^>]*\bdefer\b)[^>]*></script>)',re.I)
    script_tag='  <script defer src="scripts/gallery-storage-admin-v1.js?v=gallery-storage-'+RUN_ID+'"></script>'
    html,count=anchor.subn(lambda match:match.group(1)+"\n"+script_tag,html,count=1)
    require(count==1,"ADMIN_SCRIPT_ANCHOR_MISSING")
    html_path.write_text(html)
    require(sum(path.is_file() for path in building.rglob("*"))==source_files+1,
        "FRONTEND_FILE_PARITY")
    building.rename(release)
    print("GALLERY_STORAGE_FRONTEND=STAGED")

    phase="activate_frontend"
    overlay_backup=STAGE/"frontend-overlay.before"
    shutil.copy2(OVERLAY,overlay_backup)
    changed=False
    try:
        OVERLAY.write_text(overlay.replace(str(source),str(release),1))
        changed=True
        run(COMPOSE+["config","--quiet"],timeout=60)
        run(COMPOSE+["up","-d","--no-deps","caddy"],timeout=165)
        active=json.loads(output(DOCKER+["inspect","supabase-caddy"],timeout=30))[0]
        active_mounts=[Path(item["Source"]) for item in active.get("Mounts",[])
            if item.get("Type")=="bind" and item.get("Destination")=="/srv/neis-circle"]
        require(len(active_mounts)==1 and active_mounts[0]==release,"NEW_CADDY_MOUNT_NOT_ACTIVE")
        require(active.get("State",{}).get("Running") is True,"CADDY_NOT_RUNNING")
        cid=output(COMPOSE+["ps","-q","caddy"],timeout=30)
        require(bool(cid),"CADDY_CONTAINER_MISSING")
        live_html=output(DOCKER+["exec",cid,"cat","/srv/neis-circle/index.html"],timeout=30)
        require(script_tag in live_html,"GALLERY_STORAGE_HTML_NOT_ACTIVE")
        live_js=output(DOCKER+["exec",cid,"cat","/srv/neis-circle/scripts/gallery-storage-admin-v1.js"],timeout=30)
        require("sb.rpc('main_admin_gallery_storage')" in live_js and
            "Total Gallery storage (Photograph + Art combined)" in live_js,
            "GALLERY_STORAGE_SCRIPT_NOT_ACTIVE")
        caddy=output(DOCKER+["exec",cid,"cat","/etc/caddy/Caddyfile"],timeout=30)
        for signature in ("reverse_proxy rest:3000","reverse_proxy auth:9999","basic_auth"):
            require(signature in caddy,"CADDY_ROUTE_CONFIG_CHANGED")
    except Exception:
        if changed:
            OVERLAY.write_text(overlay)
            run(COMPOSE+["up","-d","--no-deps","caddy"],timeout=165,check=False)
            print("GALLERY_STORAGE_FRONTEND=ROLLED_BACK")
        raise

    print("GALLERY_STORAGE_FRONTEND=ACTIVE")
    print("GALLERY_STORAGE_RELEASE="+str(release))
    print("GALLERY_STORAGE_TOTAL_BYTES="+str(metrics["total_bytes"]))
    print("GALLERY_STORAGE_FILE_COUNT="+str(metrics["object_count"]))
    print("OTHER_SERVICES_AND_TABLES=UNCHANGED")

if __name__=="__main__":
    try:
        main()
    except Exception as exc:
        safe=re.sub(r"(?i)(password|secret|token|key)=\S+",r"\1=[redacted]",str(exc)[:260])
        safe=re.sub(r"(?i)(postgres(?:ql)?://)[^@\s]+@",r"\1[redacted]@",safe)
        print("GALLERY_STORAGE_DEPLOY=BLOCKED_"+phase.upper(),file=sys.stderr)
        print("GALLERY_STORAGE_DEPLOY_ERROR="+safe,file=sys.stderr)
        raise SystemExit(1)
