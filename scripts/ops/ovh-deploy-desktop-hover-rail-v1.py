#!/usr/bin/env python3
"""Deploy desktop-only hover sidebar as immutable OVH frontend overlay.

Does not edit application navigation, auth, database, mobile UI or existing release.
Restores Caddy mount on failure.
"""
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT=Path("/home/ubuntu/neis-supabase")
STAGE=Path("/home/ubuntu/neis-backups/desktop-hover-rail-20261012-v1")
TARGET=Path("/home/ubuntu/neis-frontend/releases/desktop-hover-rail-20261012-v1")
OVERLAY=ROOT/"docker-compose.frontend-public.yml"
DOCKER=["sudo","-n","/usr/bin/docker"]
COMPOSE=DOCKER+["compose"]+[v for f in
    ("docker-compose.yml","docker-compose.security.yml","docker-compose.caddy.yml",
     "docker-compose.frontend-public.yml","docker-compose.auth-public-direct.yml")
    for v in ("-f",f)]
CSS="styles/desktop-hover-rail-v1.css"
JS="scripts/desktop-hover-rail-v1.js"
LINK='<link rel="stylesheet" href="'+CSS+'?sidebar=20261012v1">'
SCRIPT='<script defer src="'+JS+'?sidebar=20261012v1"></script>'
phase="preflight"

def exec_cmd(args,timeout=60,check=True):
    proc=subprocess.run(args,text=True,capture_output=True,cwd=ROOT,timeout=timeout)
    if check and proc.returncode:raise RuntimeError("COMMAND_FAILED")
    return proc.stdout

def require(ok,code):
    if not ok:raise RuntimeError(code)

def main():
    global phase
    require(STAGE.is_dir() and (STAGE/"ui.js").is_file() and
        (STAGE/"ui.css").is_file() and OVERLAY.is_file(),"STAGE_MISSING")
    js=(STAGE/"ui.js").read_text()
    css=(STAGE/"ui.css").read_text()
    for marker in ("neis-hover-rail","pointerenter","pointerleave",
                   "focusin","focusout","localStorage","title",
                   "is-expanded","neis-rail-pin","MutationObserver"):
        require(marker in js,"JS_FEATURE_MISSING")
    for marker in ("@media (min-width: 1024px)","width: var(--neis-rail-open)",
                   "body.rtl .rail","prefers-reduced-motion",
                   "var(--card)","var(--line)","var(--accent)"):
        require(marker in css,"CSS_FEATURE_MISSING")
    require("data-nav" in js and "dataset.action" in js,"ORIGINAL_NAV_FEATURE_MISSING")
    exec_cmd(["node","--check",str(STAGE/"ui.js")],timeout=15)
    exec_cmd(COMPOSE+["config","--quiet"],timeout=40)

    inspected=json.loads(exec_cmd(DOCKER+["inspect","supabase-caddy"],timeout=20))[0]
    mounts=[m.get("Source") for m in inspected.get("Mounts",[])
        if m.get("Type")=="bind" and m.get("Destination")=="/srv/neis-circle"]
    require(len(mounts)==1,"LIVE_MOUNT_NOT_FOUND")
    original_release=Path(mounts[0])
    require(original_release.is_dir() and
       str(original_release).startswith("/home/ubuntu/neis-frontend/releases/"),
       "LIVE_RELEASE_UNEXPECTED")
    original_index=(original_release/"index.html").read_text()
    require(all(x in original_index for x in (
      'class="rail"', 'class="rail-nav"', 'data-nav="home"',
      'scripts/01-core.js', 'main-admin-auth-studio-v5.js',
      'main-admin-db-storage-v1.js')),
      "LIVE_SHELL_CHANGED")
    require(original_index.count("</head>")==1 and original_index.count("</body>")==1,
            "INVALID_HTML_BOUNDARY")
    require(CSS not in original_index and JS not in original_index,
            "OVERLAY_ALREADY_ADDED")
    original_overlay=OVERLAY.read_text()
    require(original_overlay.count(str(original_release))==1,
            "FRONTEND_OVERLAY_MISMATCH")
    require(not TARGET.exists() and not Path(str(TARGET)+".building").exists(),
            "TARGET_ALREADY_EXISTS")
    source_count=sum(p.is_file() for p in original_release.rglob("*"))
    require(source_count>100,"LIVE_RELEASE_INCOMPLETE")

    phase="stage_immutable_release"
    temporary=Path(str(TARGET)+".building")
    shutil.copytree(original_release,temporary)
    shutil.copy2(STAGE/"ui.js",temporary/JS)
    shutil.copy2(STAGE/"ui.css",temporary/CSS)
    index=original_index.replace("</head>",LINK+"\n</head>")
    index=index.replace("</body>",SCRIPT+"\n</body>")
    (temporary/"index.html").write_text(index)
    require(sum(p.is_file() for p in temporary.rglob("*"))==source_count+2,
            "RELEASE_FILE_COUNT_MISMATCH")
    require(index.count(LINK)==1 and index.count(SCRIPT)==1,
            "HTML_INJECTION_COUNT_BAD")
    temporary.rename(TARGET)
    (STAGE/"frontend-overlay-before-hover.yml").write_text(original_overlay)

    phase="activate_caddy"
    changed=False
    try:
        OVERLAY.write_text(original_overlay.replace(str(original_release),str(TARGET)))
        changed=True
        exec_cmd(COMPOSE+["config","--quiet"],timeout=40)
        exec_cmd(COMPOSE+["up","-d","--no-deps","caddy"],timeout=115)
        cid=exec_cmd(COMPOSE+["ps","-q","caddy"],timeout=25).strip()
        require(bool(cid),"CADDY_STOPPED")
        live_html=exec_cmd(DOCKER+["exec",cid,"cat","/srv/neis-circle/index.html"],timeout=25)
        live_css=exec_cmd(DOCKER+["exec",cid,"cat","/srv/neis-circle/"+CSS],timeout=25)
        live_js=exec_cmd(DOCKER+["exec",cid,"cat","/srv/neis-circle/"+JS],timeout=25)
        require(LINK in live_html and SCRIPT in live_html and
          "main-admin-auth-studio-v5.js" in live_html and
          "main-admin-db-storage-v1.js" in live_html and
          "@media (min-width: 1024px)" in live_css and
          "focusByKeyboard" in live_js,
          "NEW_UI_NOT_LIVE")
        caddy_config=exec_cmd(DOCKER+["exec",cid,"cat","/etc/caddy/Caddyfile"],timeout=25)
        require(all(s in caddy_config for s in
          ("reverse_proxy rest:3000","reverse_proxy auth:9999","basic_auth")),
          "AUTH_OR_PROXY_CHANGED")
    except Exception:
        if changed:
            OVERLAY.write_text(original_overlay)
            exec_cmd(COMPOSE+["up","-d","--no-deps","caddy"],timeout=100,check=False)
            print("SIDEBAR_HOVER_FRONTEND=ROLLED_BACK")
        raise

    print("SIDEBAR_HOVER_DEPLOY=SUCCESS")
    print("SIDEBAR_HOVER_RELEASE=LIVE")
    print("SIDEBAR_HOVER_DESKTOP_ONLY=YES")
    print("SIDEBAR_HOVER_LIGHT_DARK_RTL=SUPPORTED")
    print("SIDEBAR_HOVER_MOBILE_TABLET=UNCHANGED")
    print("SIDEBAR_HOVER_NAV_ROUTES=UNCHANGED")
    print("SIDEBAR_HOVER_AUTH_AND_DB=UNCHANGED")
    print("SIDEBAR_HOVER_NEW_SERVICES=NONE")
if __name__=="__main__":
    try:main()
    except Exception as exc:
        allowed={
          "STAGE_MISSING","JS_FEATURE_MISSING","CSS_FEATURE_MISSING","ORIGINAL_NAV_FEATURE_MISSING",
          "LIVE_MOUNT_NOT_FOUND","LIVE_RELEASE_UNEXPECTED","LIVE_SHELL_CHANGED",
          "INVALID_HTML_BOUNDARY","OVERLAY_ALREADY_ADDED","FRONTEND_OVERLAY_MISMATCH",
          "TARGET_ALREADY_EXISTS","LIVE_RELEASE_INCOMPLETE","RELEASE_FILE_COUNT_MISMATCH",
          "HTML_INJECTION_COUNT_BAD","CADDY_STOPPED","NEW_UI_NOT_LIVE",
          "AUTH_OR_PROXY_CHANGED","COMMAND_FAILED"
        }
        code=str(exc) if str(exc) in allowed else "UNEXPECTED"
        print("SIDEBAR_HOVER_DEPLOY=FAILED_"+phase.upper()+"_"+code,file=sys.stderr)
        raise SystemExit(1)
