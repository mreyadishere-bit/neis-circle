#!/usr/bin/env python3
"""One-time verified OVH timetable AI free-tier optimization.
Copy current LIVE releases, modify ONLY timetable AI JS and Edge function.
No database changes, no secret rotation, automatic Compose rollback.
"""
from pathlib import Path
import json, shutil, subprocess, re, sys, urllib.request, urllib.error, time

ROOT=Path("/home/ubuntu/neis-supabase")
STAGE=Path("/home/ubuntu/neis-backups/timetable-ai-20261102-v3")
NEW_EDGE=STAGE/"edge-functions"
NEW_FRONT=Path("/home/ubuntu/neis-frontend/releases/timetable-ai-20261102-v3")
EDGE_YML=ROOT/"docker-compose.timetable-ai.yml"
FRONT_YML=ROOT/"docker-compose.frontend-public.yml"
FILES=("docker-compose.yml","docker-compose.security.yml","docker-compose.caddy.yml",
       "docker-compose.edge-integrations.yml","docker-compose.frontend-public.yml",
       "docker-compose.auth-public-direct.yml","docker-compose.timetable-ai.yml")
DOCKER=["sudo","-n","/usr/bin/docker"]
COMPOSE=DOCKER+["compose"]+[v for x in FILES for v in ("-f",x)]
phase="preflight"
activated_edge=False
activated_front=False
old_edge_yml=""
old_front_yml=""

def run(args,timeout=110):
    p=subprocess.run(args,cwd=ROOT,text=True,capture_output=True,timeout=timeout)
    if p.returncode!=0:raise RuntimeError("COMMAND_FAILED")
    return p.stdout
def require(ok,reason):
    if not ok:raise RuntimeError(reason)
def inspect(name):
    return json.loads(run(DOCKER+["inspect",name],30))[0]
def mount(name,path):
    d=inspect(name)
    require(d.get("State",{}).get("Running") is True,"SERVICE_STOPPED")
    a=[x.get("Source") for x in d.get("Mounts",[])
       if x.get("Type")=="bind" and x.get("Destination")==path]
    require(len(a)==1,"MOUNT_AMBIGUOUS")
    return Path(a[0])
def rollback():
    if activated_front:
        try:
            FRONT_YML.write_text(old_front_yml)
            run(COMPOSE+["up","-d","--no-deps","caddy"],110)
            print("AI_V3_FRONT_ROLLBACK=SUCCESS")
        except Exception:print("AI_V3_FRONT_ROLLBACK=MANUAL_REVIEW")
    if activated_edge:
        try:
            EDGE_YML.write_text(old_edge_yml)
            run(COMPOSE+["up","-d","--no-deps","--force-recreate","functions"],140)
            print("AI_V3_EDGE_ROLLBACK=SUCCESS")
        except Exception:print("AI_V3_EDGE_ROLLBACK=MANUAL_REVIEW")
def main():
    global phase,activated_edge,activated_front,old_edge_yml,old_front_yml
    require(STAGE.is_dir() and (STAGE/"ui.js").is_file() and (STAGE/"ai.ts").is_file(),
            "STAGE_MISSING")
    require(not NEW_EDGE.exists() and not NEW_FRONT.exists() and
            not Path(str(NEW_FRONT)+".building").exists(),"RELEASE_ALREADY_EXISTS")
    require(all((ROOT/x).is_file() for x in FILES),"COMPOSE_MISSING")
    require(EDGE_YML.stat().st_mode & 0o777 == 0o600,"EDGE_OVERLAY_PERMS")
    old_edge=mount("supabase-edge-functions","/home/deno/functions")
    old_front=mount("supabase-caddy","/srv/neis-circle")
    require(str(old_edge).startswith("/home/ubuntu/neis-backups/") and
            str(old_front).startswith("/home/ubuntu/neis-frontend/releases/"),
            "MOUNT_SOURCE_UNEXPECTED")
    old_edge_yml=EDGE_YML.read_text()
    old_front_yml=FRONT_YML.read_text()
    require(old_edge_yml.count(str(old_edge))==1 and
            old_front_yml.count(str(old_front))==1,"OVERLAY_SOURCE_UNEXPECTED")
    require("groq.env" in old_edge_yml and
            (old_edge/"timetable-ai/index.ts").is_file() and
            (old_edge/"study-livekit-token/index.ts").is_file(),
            "EXISTING_EDGE_MISSING")
    html=(old_front/"index.html").read_text()
    require("ttai=20261102v2" in html and
            "oauthlogout=20261102v1" in html and
            "timetable-export-png-v1.js" in html and
            "scripts/timetable-v147.js" in html,"FRONTEND_FEATURES_MISSING")
    js=(STAGE/"ui.js").read_text()
    ts=(STAGE/"ai.ts").read_text()
    require("documentText" in js and "getTextContent" in js and
            "completionLimit" in ts and "retryAfterSeconds" in ts and
            'Deno.env.get("GROQ_API_KEY")' in ts and
            'Deno.env.get("GEMINI_API_KEY")' not in ts,
            "NEW_AI_BUILD_INVALID")
    run(COMPOSE+["config","--quiet"],40)
    print("AI_V3_PREFLIGHT=PASS_LIVE_CONTENT_AND_PRIVATE_KEY_PRESERVED")
    phase="build"
    shutil.copytree(old_edge,NEW_EDGE,symlinks=False)
    shutil.copy2(STAGE/"ai.ts",NEW_EDGE/"timetable-ai/index.ts")
    require((NEW_EDGE/"main/index.ts").read_bytes()==
            (old_edge/"main/index.ts").read_bytes(),"EDGE_ROUTER_CHANGED")
    temp=Path(str(NEW_FRONT)+".building")
    shutil.copytree(old_front,temp)
    shutil.copy2(STAGE/"ui.js",temp/"scripts/timetable-ai-v1.js")
    updated=html.replace("ttai=20261102v2","ttai=20261102v3")
    require(updated.count("ttai=20261102v3")==2,"FRONT_ASSET_VERSION_UNEXPECTED")
    (temp/"index.html").write_text(updated)
    require((temp/"scripts/identity-v15.js").read_bytes()==
            (old_front/"scripts/identity-v15.js").read_bytes(),"AUTH_CHANGED")
    require((temp/"scripts/timetable-v147.js").read_bytes()==
            (old_front/"scripts/timetable-v147.js").read_bytes(),"NATIVE_TIMETABLE_CHANGED")
    require((temp/"scripts/timetable-export-png-v1.js").read_bytes()==
            (old_front/"scripts/timetable-export-png-v1.js").read_bytes(),
            "PNG_EXPORT_CHANGED")
    require(sum(x.is_file() for x in temp.rglob("*"))==
            sum(x.is_file() for x in old_front.rglob("*")),
            "FRONTEND_ASSET_COUNT_CHANGED")
    run(["node","--check",str(temp/"scripts/timetable-ai-v1.js")],15)
    temp.rename(NEW_FRONT)
    (STAGE/"prior-edge-overlay.yml").write_text(old_edge_yml)
    (STAGE/"prior-front-overlay.yml").write_text(old_front_yml)
    print("AI_V3_RELEASES=IMMUTABLE_COPIES_CREATED")
    phase="edge"
    EDGE_YML.write_text(old_edge_yml.replace(str(old_edge),str(NEW_EDGE)))
    activated_edge=True
    run(COMPOSE+["config","--quiet"],50)
    run(COMPOSE+["up","-d","--no-deps","--force-recreate","functions"],150)
    require(mount("supabase-edge-functions","/home/deno/functions")==NEW_EDGE,
            "EDGE_RELEASE_NOT_ACTIVE")
    # Missing user JWT should be rejected, not run expensive model inference.
    request=urllib.request.Request(
       "https://supabase.neiscircle.site/functions/v1/timetable-ai",
       data=b'{"message":"private unauthenticated smoke"}',method="POST",
       headers={"Origin":"https://www.neiscircle.site","Content-Type":"application/json"})
    try:
        with urllib.request.urlopen(request,timeout=18) as r:status=r.status
    except urllib.error.HTTPError as e:status=e.code
    require(status==401,"EDGE_AUTH_NEGATIVE_CHECK_FAILED")
    print("AI_V3_EDGE=LIVE_ANON_401")
    phase="frontend"
    FRONT_YML.write_text(old_front_yml.replace(str(old_front),str(NEW_FRONT)))
    activated_front=True
    run(COMPOSE+["config","--quiet"],45)
    run(COMPOSE+["up","-d","--no-deps","caddy"],125)
    require(mount("supabase-caddy","/srv/neis-circle")==NEW_FRONT,
            "FRONT_RELEASE_NOT_ACTIVE")
    actual=run(DOCKER+["exec","supabase-caddy","cat",
                      "/srv/neis-circle/index.html"],20)
    require(actual.count("ttai=20261102v3")==2 and
            "oauthlogout=20261102v1" in actual,"LIVE_VERSION_NOT_UPDATED")
    print("AI_V3_DEPLOY=SUCCESS")
    print("AI_V3_PDF=LOCAL_TEXT_FIRST_VISION_FALLBACK")
    print("AI_V3_GROQ=REDUCED_MAX_OUTPUT_TOKENS")
    print("AI_V3_EXISTING_USER_DATA=UNCHANGED")
    print("AI_V3_OTHERS=UNCHANGED")
if __name__=="__main__":
    try: main()
    except Exception as e:
        label=str(e)
        if not re.fullmatch(r"[A-Z_]{3,75}",label):label="UNKNOWN"
        print("AI_V3_DEPLOY=FAILED_"+phase.upper()+"_"+label,file=sys.stderr)
        rollback()
        sys.exit(1)
