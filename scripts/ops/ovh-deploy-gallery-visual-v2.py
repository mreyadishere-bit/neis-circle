#!/usr/bin/env python3
"""Atomic frontend-only NEIS Gallery visual release. No database or service changes."""
import json, os, re, shutil, subprocess, sys
from pathlib import Path

ROOT=Path("/home/ubuntu/neis-supabase")
BACKUPS=Path("/home/ubuntu/neis-backups")
FRONTENDS=Path("/home/ubuntu/neis-frontend/releases")
OVERLAY=ROOT/"docker-compose.frontend-public.yml"
RUN_ID=os.environ.get("NEIS_GALLERY_VISUAL_RUN_ID","")
STAGE=BACKUPS/("gallery-visual-"+RUN_ID)
TARGET=FRONTENDS/("gallery-visual-"+RUN_ID)
DOCKER=["sudo","-n","/usr/bin/docker"]
COMPOSE=DOCKER+["compose"]+[v for f in (
    "docker-compose.yml","docker-compose.security.yml","docker-compose.caddy.yml",
    "docker-compose.frontend-public.yml","docker-compose.auth-public-direct.yml")
    for v in ("-f",str(ROOT/f))]
ASSETS=(
    "scripts/gallery-pinterest-v1.js",
    "styles/gallery-pinterest-v1.css",
    "styles/navigation-accent-v1.css",
)
MIGRATION="20261128170000_main_admin_gallery_delete_storage.sql"
phase="preflight"

def run(argv,timeout=90,check=True,input_data=None):
    p=subprocess.run(argv,cwd=ROOT,input=input_data,text=True,capture_output=True,timeout=timeout)
    if check and p.returncode:
        detail=(p.stderr.strip().splitlines() or [""])[-1][:180]
        detail=re.sub(r"(?i)(password|secret|token|key)=\S+",r"\1=[redacted]",detail)
        detail=re.sub(r"(postgres(?:ql)?://)[^@\s]+@",r"\1[redacted]@",detail)
        raise RuntimeError("COMMAND_FAILED_"+str(p.returncode)+"_"+detail)
    return p.stdout

def output(argv,timeout=45):
    return run(argv,timeout=timeout).strip()

def sql(statement):
    return output(COMPOSE+["exec","-T","db","psql","-X","-U","postgres","-d","postgres","-Atqc",statement],timeout=60)

def require(ok,code):
    if not ok:
        raise RuntimeError(code)

def upsert_link(html,asset,reference):
    pattern=re.compile(
        r"""(<link\b[^>]*\bhref=["'])"""+re.escape(asset)+
        r"""(?:\?[^"']*)?(["'][^>]*>)""",re.I)
    hits=list(pattern.finditer(html))
    require(len(hits)<=1,"DUPLICATE_ASSET_LINK")
    if hits:
        return pattern.sub(lambda m:m.group(1)+reference+m.group(2),html,count=1)
    require(html.count("</head>")==1,"HEAD_ANCHOR_MISMATCH")
    return html.replace("</head>",'  <link rel="stylesheet" href="'+reference+'">\n</head>',1)

def upsert_script(html,asset,reference):
    pattern=re.compile(
        r"""(<script\b[^>]*\bsrc=["'])"""+re.escape(asset)+
        r"""(?:\?[^"']*)?(["'][^>]*></script>)""",re.I)
    hits=list(pattern.finditer(html))
    require(len(hits)<=1,"DUPLICATE_ASSET_SCRIPT")
    if hits:
        return pattern.sub(lambda m:m.group(1)+reference+m.group(2),html,count=1)
    anchor=re.compile(
        r"""(?m)^(\s*<script\b[^>]*\bsrc=["']scripts/data-coordinator-v\d+\.js[^"']*["'][^>]*></script>)"""
    )
    require(len(list(anchor.finditer(html)))==1,"DATA_COORDINATOR_ANCHOR_MISMATCH")
    tag='  <script src="'+reference+'" defer></script>\n'
    return anchor.sub(lambda m:tag+m.group(1),html,count=1)

def main():
    global phase
    require(re.fullmatch(r"[0-9]+-[0-9]+",RUN_ID) is not None,"INVALID_RUN_ID")
    for asset in ASSETS:
        source=STAGE/Path(asset).name
        require(source.is_file() and not source.is_symlink() and source.stat().st_size>0,
                "MISSING_STAGE_FILE")
    migration_path=STAGE/MIGRATION
    require(migration_path.is_file() and not migration_path.is_symlink() and migration_path.stat().st_size>0,
            "MISSING_STORAGE_MIGRATION")
    js=(STAGE/"gallery-pinterest-v1.js").read_text()
    gallery_css=(STAGE/"gallery-pinterest-v1.css").read_text()
    navigation_css=(STAGE/"navigation-accent-v1.css").read_text()
    migration=migration_path.read_text()
    require("gallery-pin-meta" in js and "item.created_at" in js and "author.branch" in js,
            "GALLERY_METADATA_CONTRACT")
    require(".gallery-masonry{columns:" in gallery_css and ".gallery-pin-meta" in gallery_css,
            "GALLERY_STYLE_CONTRACT")
    require(".nav-btn.active" in navigation_css and "background: var(--accent)" in navigation_css
            and "fill: none" in navigation_css,"NAVIGATION_ACCENT_CONTRACT")
    require("neis_community_media_select_main_admin_gallery_v1" in migration and
            "neis_community_media_delete_main_admin_gallery_v1" in migration,
            "GALLERY_STORAGE_MIGRATION_CONTRACT")
    run(["node","--check",str(STAGE/"gallery-pinterest-v1.js")],timeout=20)

    require(ROOT.is_dir() and OVERLAY.is_file() and FRONTENDS.is_dir() and BACKUPS.is_dir(),
            "OVH_FRONTEND_ROOT_MISSING")
    run(COMPOSE+["config","--quiet"],timeout=50)
    source_text=output(DOCKER+["inspect","supabase-caddy","--format",
        '{{range .Mounts}}{{if eq .Destination "/srv/neis-circle"}}{{.Source}}{{end}}{{end}}'])
    source=Path(source_text)
    require(str(source).startswith(str(FRONTENDS)+"/") and source.is_dir() and not source.is_symlink(),
            "ACTIVE_FRONTEND_MOUNT_UNEXPECTED")
    require((source/"index.html").is_file() and (source/"scripts/01-core.js").is_file(),
            "ACTIVE_FRONTEND_INCOMPLETE")
    original_overlay=OVERLAY.read_text()
    require(original_overlay.count(str(source))==1,"FRONTEND_OVERLAY_MISMATCH")
    require(not TARGET.exists() and not Path(str(TARGET)+".building").exists(),
            "TARGET_RELEASE_ALREADY_EXISTS")
    require(shutil.disk_usage(FRONTENDS).free>256*1024*1024,"LOW_FRONTEND_DISK_SPACE")

    phase="database_preflight"
    storage_ready=sql("""select
      (select relrowsecurity from pg_class where oid='storage.objects'::regclass)
      and exists(select 1 from storage.buckets where id='community-media'
        and public=true and file_size_limit=8388608)
      and has_table_privilege('authenticated','storage.objects','SELECT')
      and has_table_privilege('authenticated','storage.objects','DELETE')
      and exists(select 1 from pg_policies where schemaname='storage'
        and tablename='objects' and policyname='neis_community_media_select_own_v1')
      and exists(select 1 from pg_policies where schemaname='storage'
        and tablename='objects' and policyname='neis_community_media_delete_own_v1')
      and to_regprocedure('public.admin_delete_moderation_content(text,text)') is not null""")
    require(storage_ready=="t","GALLERY_STORAGE_BASELINE_UNEXPECTED")

    phase="database_migration"
    run(COMPOSE+["exec","-T","db","psql","-X","-v","ON_ERROR_STOP=1",
        "--single-transaction","-U","postgres","-d","postgres"],
        timeout=90,input_data=migration)
    policies=sql("""select count(*)=2 from pg_policies
      where schemaname='storage' and tablename='objects'
        and policyname in (
          'neis_community_media_select_main_admin_gallery_v1',
          'neis_community_media_delete_main_admin_gallery_v1')
        and coalesce(qual,'') like '%community-media%'
        and coalesce(qual,'') like '%/gallery/%'
        and coalesce(qual,'') like '%neis_main_admin_gallery_delete_allowed%'""")
    require(policies=="t","GALLERY_STORAGE_POLICY_VERIFY_FAILED")
    print("GALLERY_STORAGE_ADMIN_POLICIES=VERIFIED")

    phase="prepare_frontend"
    backup=BACKUPS/("gallery-visual-release-"+RUN_ID)
    backup.mkdir(mode=0o700)
    overlay_backup=backup/"frontend-overlay.before"
    overlay_backup.write_text(original_overlay)
    os.chmod(overlay_backup,0o600)

    tmp=Path(str(TARGET)+".building")
    shutil.copytree(source,tmp)
    new_files=0
    for asset in ASSETS:
        destination=tmp/asset
        if not destination.exists():
            new_files+=1
        destination.parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(STAGE/Path(asset).name,destination)

    html_path=tmp/"index.html"
    html=html_path.read_text()
    css_ref="styles/gallery-pinterest-v1.css?v=gallery-"+RUN_ID
    js_ref="scripts/gallery-pinterest-v1.js?v=gallery-"+RUN_ID
    nav_ref="styles/navigation-accent-v1.css?v=accent-nav-"+RUN_ID
    html=upsert_link(html,"styles/gallery-pinterest-v1.css",css_ref)
    html=upsert_link(html,"styles/navigation-accent-v1.css",nav_ref)
    html=upsert_script(html,"scripts/gallery-pinterest-v1.js",js_ref)
    html_path.write_text(html)
    require(sum(p.is_file() for p in tmp.rglob("*"))==
            sum(p.is_file() for p in source.rglob("*"))+new_files,
            "RELEASE_FILE_PARITY_FAILED")
    require(css_ref in html and js_ref in html and nav_ref in html,
            "RELEASE_HTML_ASSET_CONTRACT")
    tmp.rename(TARGET)

    phase="activate_frontend"
    switched=False
    try:
        OVERLAY.write_text(original_overlay.replace(str(source),str(TARGET),1))
        switched=True
        run(COMPOSE+["config","--quiet"],timeout=55)
        run(COMPOSE+["up","-d","--no-deps","caddy"],timeout=165)

        phase="verify_caddy_mount"
        info=json.loads(output(DOCKER+["inspect","supabase-caddy"],timeout=30))[0]
        mounts=[Path(m["Source"]) for m in info.get("Mounts",[])
                if m.get("Type")=="bind" and m.get("Destination")=="/srv/neis-circle"]
        require(len(mounts)==1 and mounts[0]==TARGET,"NEW_CADDY_MOUNT_NOT_ACTIVE")
        cid=output(COMPOSE+["ps","-q","caddy"],timeout=25)
        require(bool(cid),"CADDY_CONTAINER_MISSING")

        phase="verify_live_frontend"
        live_html=output(DOCKER+["exec",cid,"cat","/srv/neis-circle/index.html"],timeout=25)
        live_js=output(DOCKER+["exec",cid,"cat","/srv/neis-circle/scripts/gallery-pinterest-v1.js"],timeout=25)
        live_gallery_css=output(DOCKER+["exec",cid,"cat","/srv/neis-circle/styles/gallery-pinterest-v1.css"],timeout=25)
        live_nav_css=output(DOCKER+["exec",cid,"cat","/srv/neis-circle/styles/navigation-accent-v1.css"],timeout=25)
        require(all(ref in live_html for ref in (css_ref,js_ref,nav_ref)),
                "LIVE_FRONTEND_HTML_MISMATCH")
        require("gallery-pin-meta" in live_js and "item.created_at" in live_js,
                "LIVE_GALLERY_SCRIPT_MISMATCH")
        require(".gallery-pin-meta" in live_gallery_css and ".gallery-masonry{columns:" in live_gallery_css,
                "LIVE_GALLERY_STYLE_MISMATCH")
        require(".nav-btn.active" in live_nav_css and "background: var(--accent)" in live_nav_css
                and "fill: none" in live_nav_css,"LIVE_NAVIGATION_STYLE_MISMATCH")

        phase="verify_proxy_configuration"
        caddyfile=output(DOCKER+["exec",cid,"cat","/etc/caddy/Caddyfile"],timeout=25)
        require(all(value in caddyfile for value in
            ("reverse_proxy rest:3000","reverse_proxy auth:9999","basic_auth")),
            "CADDY_AUTH_OR_PROXY_CONFIG_CHANGED")
    except Exception:
        OVERLAY.write_text(original_overlay)
        if switched:
            run(COMPOSE+["up","-d","--no-deps","caddy"],timeout=155,check=False)
        print("GALLERY_VISUAL_FRONTEND=ROLLED_BACK")
        raise

    print("GALLERY_VISUAL_DEPLOY=SUCCESS")
    print("GALLERY_VISUAL_RELEASE="+str(TARGET))
    print("GALLERY_AUTHOR_METADATA=ACTIVE")
    print("NAV_ACCENT_AND_OUTLINE_ICONS=ACTIVE")
    print("DATABASE_AUTH_STORAGE_AND_OTHER_SERVICES=UNCHANGED")

if __name__=="__main__":
    try:
        main()
    except Exception as error:
        safe={
            "INVALID_RUN_ID","MISSING_STAGE_FILE","MISSING_STORAGE_MIGRATION","GALLERY_METADATA_CONTRACT",
            "GALLERY_STORAGE_MIGRATION_CONTRACT","GALLERY_STORAGE_BASELINE_UNEXPECTED",
            "GALLERY_STORAGE_POLICY_VERIFY_FAILED",
            "GALLERY_STYLE_CONTRACT","NAVIGATION_ACCENT_CONTRACT","OVH_FRONTEND_ROOT_MISSING",
            "ACTIVE_FRONTEND_MOUNT_UNEXPECTED","ACTIVE_FRONTEND_INCOMPLETE",
            "FRONTEND_OVERLAY_MISMATCH","TARGET_RELEASE_ALREADY_EXISTS","LOW_FRONTEND_DISK_SPACE",
            "RELEASE_FILE_PARITY_FAILED","RELEASE_HTML_ASSET_CONTRACT","NEW_CADDY_MOUNT_NOT_ACTIVE",
            "CADDY_CONTAINER_MISSING","LIVE_FRONTEND_HTML_MISMATCH","LIVE_GALLERY_SCRIPT_MISMATCH",
            "LIVE_GALLERY_STYLE_MISMATCH","LIVE_NAVIGATION_STYLE_MISMATCH",
            "CADDY_AUTH_OR_PROXY_CONFIG_CHANGED","DUPLICATE_ASSET_LINK","DUPLICATE_ASSET_SCRIPT",
            "HEAD_ANCHOR_MISMATCH","DATA_COORDINATOR_ANCHOR_MISMATCH"
        }
        message=str(error)
        code=message if message in safe else "UNEXPECTED"
        print("GALLERY_VISUAL_DEPLOY=BLOCKED_"+phase.upper(),file=sys.stderr)
        print("GALLERY_VISUAL_DEPLOY_ERROR="+type(error).__name__,file=sys.stderr)
        print("GALLERY_VISUAL_DEPLOY_DETAIL="+code,file=sys.stderr)
        raise SystemExit(1)
