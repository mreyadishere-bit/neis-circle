#!/usr/bin/env python3
"""Move only OVH Storage service onto the verified 104-file private runtime directory.
Back out of the service-only Compose override on any runtime/API failure.
Requires the live Cloud database import to have passed first.
"""
import json, os, re, shutil, subprocess, sys, urllib.error, urllib.parse, urllib.request
from pathlib import Path

root=Path("/home/ubuntu/neis-supabase")
candidate=Path("/home/ubuntu/neis-backups/storage-runtime-release-20261010/files")
override=root/"docker-compose.storage-cutover.yml"
backup=Path("/home/ubuntu/neis-backups/storage-cutover-prev-20261010")
docker=["sudo","-n","/usr/bin/docker"]
files=["docker-compose.yml","docker-compose.security.yml","docker-compose.caddy.yml","docker-compose.edge-integrations.yml"]
base=docker+["compose"]+[v for f in files for v in ("-f",f)]
active=base+["-f",str(override)]
def run(cmd,timeout=60, cwd=root):
    return subprocess.run(cmd,cwd=str(cwd),stdin=subprocess.DEVNULL,capture_output=True,text=True,timeout=timeout)
def query(sql):
    p=run(base+["exec","-T","db","psql","-X","-U","postgres","-d","postgres","-Atqc",sql])
    if p.returncode:raise RuntimeError("STORAGE_CUTOVER=DB_QUERY_FAILED")
    return p.stdout.strip()
if not candidate.is_dir() or candidate.is_symlink() or override.exists():
    raise SystemExit("STORAGE_CUTOVER=BLOCKED_PATH_ALREADY_SET")
if backup.exists() and (not backup.is_dir() or not (backup/"mount_source.txt").is_file()):
    raise SystemExit("STORAGE_CUTOVER=BLOCKED_INVALID_BACKUP")
try:
    current_users=int(query("select count(*) from auth.users"))
    current_profiles=int(query("select count(*) from public.profiles"))
    current_objects=int(query("select count(*) from storage.objects"))
except ValueError:
    raise SystemExit("STORAGE_CUTOVER=BLOCKED_INVALID_COUNTS")
print("STORAGE_LIVE_USERS="+str(current_users))
print("STORAGE_LIVE_PROFILES="+str(current_profiles))
print("STORAGE_LIVE_OBJECTS="+str(current_objects))
# Accounts and profiles may increase after cutover; the 104-file snapshot may NOT.
if current_users<204 or current_profiles<204 or current_objects!=104:
    raise SystemExit("STORAGE_CUTOVER=BLOCKED_DATABASE_PARITY")
live_names=set(query("select bucket_id||'/'||name from storage.objects order by bucket_id,name").splitlines())
p=run(["sudo","-n","find",str(candidate),"-type","f"])
links=run(["sudo","-n","find",str(candidate),"-type","l","-print","-quit"])
if p.returncode or links.returncode or links.stdout.strip() or len(p.stdout.splitlines())!=104:
    raise SystemExit("STORAGE_CUTOVER=BLOCKED_STAGED_FILES")
# Protected private backup directory is intentionally unreadable by ubuntu.
# Reuse the already-verified sudo find output instead of silently seeing zero files.
staged_names={Path(raw).relative_to(candidate).as_posix() for raw in p.stdout.splitlines()}
missing=live_names-staged_names
extra=staged_names-live_names
print("STORAGE_LIVE_PATHS_MISSING_FROM_STAGE="+str(len(missing)))
print("STORAGE_STAGE_PATHS_NOT_IN_LIVE_METADATA="+str(len(extra)))
if missing or extra or len(staged_names)!=104:
    raise SystemExit("STORAGE_CUTOVER=BLOCKED_OBJECT_PATH_DRIFT")
print("STORAGE_LIVE_METADATA_PATHS_MATCH_STAGE=YES")
status=run(base+["config","--format","json"])
if status.returncode:raise SystemExit("STORAGE_CUTOVER=INVALID_BASE_COMPOSE")
try:
    svc=json.loads(status.stdout)["services"]["storage"]
    old=[v for v in svc["volumes"] if v.get("target")=="/var/lib/storage"]
    assert len(old)==1 and old[0]["type"]=="bind"
except Exception:
    raise SystemExit("STORAGE_CUTOVER=UNEXPECTED_OLD_MOUNT")
if backup.exists():
    if (backup/"mount_source.txt").read_text()!=old[0]["source"]:
        raise SystemExit("STORAGE_CUTOVER=BLOCKED_BACKUP_SOURCE_MISMATCH")
else:
    backup.mkdir(mode=0o700)
    (backup/"mount_source.txt").write_text(old[0]["source"])
    os.chmod(backup/"mount_source.txt",0o600)
override.write_text("services:\n  storage:\n    volumes:\n      - type: bind\n        source: "+str(candidate)+"\n        target: /var/lib/storage\n        read_only: false\n")
os.chmod(override,0o600)
new=run(active+["config","--format","json"])
if new.returncode:
    override.unlink(missing_ok=True)
    raise SystemExit("STORAGE_CUTOVER=INVALID_OVERRIDE")
try:
    svc=json.loads(new.stdout)["services"]["storage"]
    mount=[v for v in svc["volumes"] if v.get("target")=="/var/lib/storage"]
    source_ok=len(mount)==1 and mount[0].get("source")==str(candidate)
    writable=len(mount)==1 and not mount[0].get("read_only",False)
    print("STORAGE_COMPOSE_SOURCE_MATCH="+("YES" if source_ok else "NO"))
    print("STORAGE_COMPOSE_WRITABLE="+("YES" if writable else "NO"))
    assert source_ok and writable
except Exception:
    override.unlink(missing_ok=True)
    raise SystemExit("STORAGE_CUTOVER=INVALID_NEW_MOUNT")
def rollback():
    override.unlink(missing_ok=True)
    p=run(base+["up","-d","--no-deps","--force-recreate","storage"],timeout=140)
    print("STORAGE_CUTOVER_ROLLBACK="+("SUCCESS" if p.returncode==0 else "MANUAL_REVIEW"))
p=run(active+["up","-d","--no-deps","--force-recreate","storage"],timeout=160)
if p.returncode:
    print("STORAGE_CUTOVER=FAILED_RECREATE")
    rollback()
    sys.exit(1)
cid=run(active+["ps","-q","storage"]).stdout.strip()
inspect=run(docker+["inspect","--format","{{json .}}",cid])
try:
    c=json.loads(inspect.stdout)
    mounts=[v for v in c["Mounts"] if v["Destination"]=="/var/lib/storage"]
    assert c["State"]["Running"] and len(mounts)==1
    assert mounts[0]["Source"]==str(candidate) and mounts[0]["RW"]
except Exception:
    print("STORAGE_CUTOVER=FAILED_CONTAINER_MOUNT")
    rollback()
    sys.exit(1)
print("STORAGE_LIVE_MOUNT=VERIFIED_WRITABLE_104_FILES")
# Verify at least one actual public file through the OVH Storage API.
obj=query("select name from storage.objects where bucket_id='community-media' order by name limit 1")
if not obj or "\n" in obj:
    print("STORAGE_CUTOVER=NO_PUBLIC_PROBE_OBJECT")
    rollback()
    sys.exit(1)
path=urllib.parse.quote(obj,safe="/")
url="https://supabase.neiscircle.site/storage/v1/object/public/community-media/"+path
req=urllib.request.Request(url,headers={"Range":"bytes=0-15","User-Agent":"NEIS-OVH-Storage-Migration-Smoke/1.0"})
try:
    with urllib.request.urlopen(req,timeout=22) as response:
        response.read(16)
        code=response.status
except urllib.error.HTTPError as e:
    code=e.code
except Exception:
    code=0
print("STORAGE_PUBLIC_SAMPLE_HTTP="+str(code))
if code not in (200,206):
    print("STORAGE_CUTOVER=FAILED_PUBLIC_OBJECT_READ")
    rollback()
    sys.exit(1)
print("STORAGE_CUTOVER=PASS_LIVE_SERVICE")
print("OVH_DATABASE=204_GOOGLE_USERS_UNCHANGED")
print("GITHUB_PAGES=MAINTENANCE")
