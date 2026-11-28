#!/usr/bin/env python3
"""Atomic OVH frontend-only release for the isolated Pinterest Gallery patch.

The only database change is an additive category column/check/index. A private
verified pg_dump is captured before the migration. Caddy is switched only after
the release copy and asset checks pass; the old release remains untouched.
"""
import hashlib, os, re, shutil, subprocess, sys, tempfile
from pathlib import Path

ROOT=Path("/home/ubuntu/neis-supabase")
BACKUPS=Path("/home/ubuntu/neis-backups")
FRONTENDS=Path("/home/ubuntu/neis-frontend/releases")
OVERLAY=ROOT/"docker-compose.frontend-public.yml"
STAGE=BACKUPS/("gallery-pinterest-"+os.environ.get("NEIS_GALLERY_RUN_ID",""))
FILES=("docker-compose.yml","docker-compose.security.yml","docker-compose.caddy.yml",
       "docker-compose.frontend-public.yml","docker-compose.auth-public-direct.yml")
DOCKER=["sudo","-n","/usr/bin/docker"]
COMPOSE=DOCKER+["compose"]+[v for f in FILES for v in ("-f",f)]
phase="preflight"

def run(argv, *, data=None, timeout=120, check=True):
    p=subprocess.run(argv,cwd=ROOT,input=data,stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,timeout=timeout)
    if check and p.returncode:
        raise RuntimeError("COMMAND_FAILED_"+str(argv[-1])[:35])
    return p

def output(argv, timeout=45):
    return run(argv,timeout=timeout).stdout.decode("utf-8","replace").strip()

def sql(statement):
    return output(COMPOSE+["exec","-T","db","psql","-X","-U","postgres","-d","postgres","-Atqc",statement],timeout=60)

def main():
    global phase
    run_id=os.environ.get("NEIS_GALLERY_RUN_ID","")
    if not re.fullmatch(r"[0-9]+-[0-9]+",run_id):
        raise RuntimeError("INVALID_RUN_ID")
    for name in ("gallery-pinterest-v1.js","gallery-pinterest-v1.css",
                 "20261128120000_gallery_categories.sql","ovh-deploy-pinterest-gallery-v1.py"):
        p=STAGE/name
        if not p.is_file() or p.is_symlink() or p.stat().st_size==0:
            raise RuntimeError("MISSING_STAGE_FILE")
    js=(STAGE/"gallery-pinterest-v1.js").read_text()
    css=(STAGE/"gallery-pinterest-v1.css").read_text()
    migration=(STAGE/"20261128120000_gallery_categories.sql").read_text()
    if "id:'photograph'" not in js or "id:'art'" not in js or "category:selectedCategory" not in js:
        raise RuntimeError("GALLERY_SCRIPT_CONTRACT")
    if ".gallery-masonry{columns:" not in css or "height:auto" not in css:
        raise RuntimeError("GALLERY_STYLE_CONTRACT")
    if "add column if not exists category text not null default 'photograph'" not in migration.lower():
        raise RuntimeError("GALLERY_MIGRATION_CONTRACT")
    if not ROOT.is_dir() or not OVERLAY.is_file():
        raise RuntimeError("OVH_ROOT_MISSING")
    run(COMPOSE+["config","--quiet"],timeout=45)
    info=output(DOCKER+["inspect","supabase-caddy","--format",
        '{{range .Mounts}}{{if eq .Destination "/srv/neis-circle"}}{{.Source}}{{end}}{{end}}'])
    source=Path(info)
    if not str(source).startswith(str(FRONTENDS)+"/") or not source.is_dir() or source.is_symlink():
        raise RuntimeError("ACTIVE_FRONTEND_MOUNT_UNEXPECTED")
    if not (source/"index.html").is_file() or not (source/"scripts/01-core.js").is_file():
        raise RuntimeError("ACTIVE_RELEASE_INCOMPLETE")
    overlay=OVERLAY.read_text()
    if overlay.count(str(source))!=1:
        raise RuntimeError("FRONTEND_OVERLAY_MISMATCH")
    target=FRONTENDS/("gallery-pinterest-"+run_id)
    if target.exists() or Path(str(target)+".building").exists():
        raise RuntimeError("TARGET_RELEASE_ALREADY_EXISTS")
    if len(list(source.glob("scripts/*"))) < 20:
        raise RuntimeError("SOURCE_RELEASE_TOO_SMALL")
    if shutil.disk_usage(BACKUPS).free < 1073741824:
        raise RuntimeError("LOW_DISK_SPACE")

    # Database preflight is read-only. Existing category column is accepted only
    # when its type/default and check constraint already match this migration.
    table=sql("select to_regclass('public.gallery_items') is not null")
    if table!="t":
        raise RuntimeError("GALLERY_TABLE_MISSING")
    col=sql("""select data_type||'|'||is_nullable||'|'||coalesce(column_default,'')
      from information_schema.columns where table_schema='public'
      and table_name='gallery_items' and column_name='category'""")
    if col and not (col.startswith("text|NO|") and "photograph" in col):
        raise RuntimeError("CATEGORY_COLUMN_CONFLICT")
    phase="database_backup"
    backup=BACKUPS/("gallery-pinterest-db-"+run_id)
    backup.mkdir(mode=0o700)
    dump=backup/"pre-gallery.dump"
    with dump.open("wb") as f:
        p=subprocess.run(COMPOSE+["exec","-T","db","pg_dump","-U","postgres","-d","postgres",
          "--format=custom","--no-owner","--no-acl"],stdin=subprocess.DEVNULL,
          stdout=f,stderr=subprocess.PIPE,timeout=240)
    if p.returncode or not dump.is_file() or dump.stat().st_size==0:
        raise RuntimeError("DATABASE_BACKUP_FAILED")
    check=subprocess.run(COMPOSE+["exec","-T","db","pg_restore","--list"],
        stdin=dump.open("rb"),stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,timeout=90)
    if check.returncode:
        raise RuntimeError("DATABASE_BACKUP_INVALID")
    digest=hashlib.sha256(dump.read_bytes()).hexdigest()
    (backup/"SHA256").write_text(digest+"  pre-gallery.dump\n")
    os.chmod(dump,0o600);os.chmod(backup/"SHA256",0o600)
    print("GALLERY_DB_BACKUP=VERIFIED_PRIVATE")

    phase="database_migration"
    run(COMPOSE+["exec","-T","db","psql","-X","-v","ON_ERROR_STOP=1",
       "--single-transaction","-U","postgres","-d","postgres"],
       data=migration.encode(),timeout=120)
    verified=sql("""select
      (select data_type='text' and is_nullable='NO' and column_default like '%photograph%'
       from information_schema.columns where table_schema='public' and table_name='gallery_items' and column_name='category')
      and exists(select 1 from pg_constraint where conrelid='public.gallery_items'::regclass
       and conname='gallery_items_category_check' and convalidated)
      and exists(select 1 from pg_indexes where schemaname='public' and tablename='gallery_items'
       and indexname='gallery_items_category_created_at_idx')""")
    if verified!="t":
        raise RuntimeError("DATABASE_MIGRATION_VERIFY_FAILED")
    print("GALLERY_DB_MIGRATION=VERIFIED")

    phase="stage_frontend"
    tmp=Path(str(target)+".building")
    shutil.copytree(source,tmp)
    shutil.copy2(STAGE/"gallery-pinterest-v1.js",tmp/"scripts/gallery-pinterest-v1.js")
    shutil.copy2(STAGE/"gallery-pinterest-v1.css",tmp/"styles/gallery-pinterest-v1.css")
    html_path=tmp/"index.html"
    html=html_path.read_text()
    css_ref="styles/gallery-pinterest-v1.css?v=gallery-"+run_id
    js_ref="scripts/gallery-pinterest-v1.js?v=gallery-"+run_id
    if "gallery-pinterest-v1.css" in html or "gallery-pinterest-v1.js" in html:
        raise RuntimeError("GALLERY_ASSETS_ALREADY_REFERENCED")
    if html.count("</head>")!=1:
        raise RuntimeError("HEAD_ANCHOR_MISMATCH")
    if len(re.findall(r"""<script[^>]+src=["']scripts/data-coordinator-v\d+\.js[^"']*["'][^>]*></script>""",html))!=1:
        raise RuntimeError("DATA_COORDINATOR_ANCHOR_MISMATCH")
    html=html.replace("</head>",'  <link rel="stylesheet" href="'+css_ref+'">'+chr(10)+'</head>')
    html,n=re.subn(r"""(?m)^(\s*<script[^>]+src=["']scripts/data-coordinator-v\d+\.js[^"']*["'][^>]*></script>)""",
       '  <script src="'+js_ref+'" defer></script>'+chr(10)+r'\1',html)
    if n!=1:
        raise RuntimeError("GALLERY_SCRIPT_INSERT_FAILED")
    html_path.write_text(html)
    if not (tmp/"scripts/gallery-pinterest-v1.js").is_file() or not (tmp/"styles/gallery-pinterest-v1.css").is_file():
        raise RuntimeError("GALLERY_ASSET_COPY_FAILED")
    if sum(p.is_file() for p in tmp.rglob("*"))!=sum(p.is_file() for p in source.rglob("*"))+2:
        raise RuntimeError("RELEASE_FILE_PARITY_FAILED")
    tmp.rename(target)
    print("GALLERY_FRONTEND_RELEASE=STAGED")

    phase="activate_frontend"
    overlay_backup=backup/"frontend-overlay.before"
    shutil.copy2(OVERLAY,overlay_backup)
    OVERLAY.write_text(overlay.replace(str(source),str(target)))
    switched=False
    try:
        run(COMPOSE+["config","--quiet"],timeout=45)
        run(COMPOSE+["up","-d","--no-deps","caddy"],timeout=120)
        switched=True
        cid=output(COMPOSE+["ps","-q","caddy"])
        if not cid:
            raise RuntimeError("CADDY_CONTAINER_MISSING")
        for path,needle in [
          ("/srv/neis-circle/index.html","gallery-pinterest-"+run_id),
          ("/srv/neis-circle/scripts/gallery-pinterest-v1.js","id:'art'"),
          ("/srv/neis-circle/styles/gallery-pinterest-v1.css",".gallery-masonry")]:
            run(DOCKER+["exec",cid,"grep","-Fq",needle,path],timeout=25)
    except Exception:
        OVERLAY.write_text(overlay_backup.read_text())
        if switched:
            run(COMPOSE+["up","-d","--no-deps","caddy"],timeout=120,check=False)
        print("GALLERY_FRONTEND=ROLLED_BACK")
        raise
    print("GALLERY_FRONTEND=ACTIVE")
    print("GALLERY_RELEASE="+str(target))
    print("GALLERY_DB_BACKUP="+str(backup))
    print("OTHER_SERVICES_AND_TABLES=UNCHANGED")

if __name__=="__main__":
    try:
        main()
    except Exception as e:
        allowed={"INVALID_RUN_ID","MISSING_STAGE_FILE","GALLERY_SCRIPT_CONTRACT",
          "GALLERY_STYLE_CONTRACT","GALLERY_MIGRATION_CONTRACT","OVH_ROOT_MISSING",
          "ACTIVE_FRONTEND_MOUNT_UNEXPECTED","ACTIVE_RELEASE_INCOMPLETE",
          "FRONTEND_OVERLAY_MISMATCH","TARGET_RELEASE_ALREADY_EXISTS","SOURCE_RELEASE_TOO_SMALL",
          "LOW_DISK_SPACE","GALLERY_TABLE_MISSING","CATEGORY_COLUMN_CONFLICT",
          "DATABASE_BACKUP_FAILED","DATABASE_BACKUP_INVALID","DATABASE_MIGRATION_VERIFY_FAILED",
          "HEAD_ANCHOR_MISMATCH","DATA_COORDINATOR_ANCHOR_MISMATCH",
          "GALLERY_ASSETS_ALREADY_REFERENCED","GALLERY_SCRIPT_INSERT_FAILED",
          "GALLERY_ASSET_COPY_FAILED","RELEASE_FILE_PARITY_FAILED","CADDY_CONTAINER_MISSING",
          "COMMAND_FAILED"}
        message=str(e)
        print("GALLERY_DEPLOY=BLOCKED_"+(message if message in allowed else phase.upper()+"_UNEXPECTED"),file=sys.stderr)
        raise SystemExit(1)
