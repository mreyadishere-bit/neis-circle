#!/usr/bin/env python3
"""One-time OVH in-place cutover, using a fresh Supabase CLI Cloud snapshot.
SQL data/schema never reach GitHub logs. Runs during owner-approved maintenance.
"""
import json, os, re, shutil, subprocess, sys, tempfile
from pathlib import Path

BASE=Path("/home/ubuntu/neis-supabase")
ROOT=Path("/home/ubuntu/neis-backups")
RUN=sys.argv[1] if len(sys.argv)>1 else ""
if not re.fullmatch(r"[0-9]+", RUN):
    raise SystemExit("OVH_LIVE_IMPORT=BLOCKED_RUN_ID")
SOURCE=ROOT/("cloud-cli-import-"+RUN)
BACKUP=ROOT/("ovh-live-rollback-"+RUN)
FILES=["docker-compose.yml","docker-compose.security.yml","docker-compose.caddy.yml","docker-compose.edge-integrations.yml"]
DOCKER=["sudo","-n","/usr/bin/docker"]
COMPOSE=DOCKER+["compose"]+[v for f in FILES for v in ("-f",f)]
EXPECTED={"auth.users":204,"public.profiles":204,"public.posts":109,
          "public.messages":515,"public.circle_messages":2370,
          "public.notifications":9540,"storage.objects":104}
OMIT={"auth.mfa_recovery_code_sets","auth.mfa_recovery_codes","auth.scim_tokens","auth.scim_users"}
def run(args, **kw):
    return subprocess.run(args,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=kw.pop("timeout",90),**kw)
def sql(stmt):
    p=run(COMPOSE+["exec","-T","db","psql","-X","-U","postgres","-d","postgres","-Atqc",stmt],timeout=35)
    if p.returncode:raise RuntimeError("OVH_DB_QUERY_FAILED")
    return p.stdout.strip()
def pgfile(command,dest):
    with dest.open("wb") as out:
        p=subprocess.run(COMPOSE+["exec","-T","db"]+command,stdin=subprocess.DEVNULL,stdout=out,stderr=subprocess.PIPE,timeout=180)
    if p.returncode or dest.stat().st_size==0:raise RuntimeError("OVH_BACKUP_COMMAND_FAILED")
def cmd(args, label, timeout=120):
    p=run(args,timeout=timeout)
    if p.returncode:raise RuntimeError(label)
    return p.stdout.strip()
if not SOURCE.is_dir() or SOURCE.is_symlink() or BACKUP.exists():
    raise SystemExit("OVH_LIVE_IMPORT=BLOCKED_SOURCE_OR_BACKUP")
if cmd(["sha256sum","--status","-c","SHA256SUMS"],"SOURCE_HASH_FAILED") if False else False:pass
p=run(["sha256sum","--status","-c","SHA256SUMS"],cwd=str(SOURCE))
if p.returncode:raise SystemExit("OVH_LIVE_IMPORT=BLOCKED_CLOUD_HASH")
if sql("select count(*) from auth.users")!="1" or sql("select count(*) from storage.objects")!="0" or sql("select to_regclass('public.profiles') is null")!="t":
    raise SystemExit("OVH_LIVE_IMPORT=BLOCKED_LIVE_DATABASE_ALREADY_CHANGED")
for name,n in (("auth.schema_migrations",77),("realtime.schema_migrations",82),("storage.migrations",70)):
    if sql("select count(*) from "+name)!=str(n):
        raise SystemExit("OVH_LIVE_IMPORT=BLOCKED_MIGRATIONS_BASELINE")
if int(cmd(["df","-B1","--output=avail",str(ROOT)],"DISK_CHECK_FAILED").splitlines()[-1])<2147483648:
    raise SystemExit("OVH_LIVE_IMPORT=BLOCKED_DISK")
work=Path(tempfile.mkdtemp(prefix="ovh-atomic-import-",dir=str(ROOT)))
os.chmod(work,0o700)
stopped=False
live_id=None
try:
    backupdump=work/"prelive.dump"
    pgfile(["pg_dump","-U","postgres","-d","postgres","--format=custom","--no-owner","--no-acl"],backupdump)
    pgfile(["pg_dumpall","-U","postgres","--globals-only"],work/"globals.sql")
    if not run(COMPOSE+["exec","-T","db","pg_restore","--list"],timeout=30, input=None).returncode==0 if False else False:pass
    check=run(COMPOSE+["exec","-T","db","pg_restore","--list"],timeout=30)
    # pg_restore list must be given the archive on stdin (not printed).
    with backupdump.open("rb") as fd:
        check=subprocess.run(COMPOSE+["exec","-T","db","pg_restore","--list"],stdin=fd,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,timeout=60)
    if check.returncode:raise RuntimeError("OVH_LIVE_IMPORT=INVALID_BACKUP_ARCHIVE")
    checksum=run(["sha256sum","prelive.dump","globals.sql"],cwd=str(work))
    if checksum.returncode:raise RuntimeError("OVH_LIVE_IMPORT=BACKUP_HASH_GENERATION_FAILED")
    (work/"SHA256SUMS").write_text(checksum.stdout)
    BACKUP.mkdir(mode=0o700)
    for file in ("prelive.dump","globals.sql","SHA256SUMS"):
        shutil.move(str(work/file),str(BACKUP/file))
        os.chmod(BACKUP/file,0o600)
    print("OVH_LIVE_ROLLBACK_BACKUP=VERIFIED_PRIVATE")
    original=(SOURCE/"schema.sql").read_text()
    reg=r'(?im)^[ \t]*CREATE EXTENSION IF NOT EXISTS "?pg_cron"? WITH SCHEMA "?[a-z_]+"?;[ \t]*$'
    schema,removed=re.subn(reg,"-- pg_cron preserved from OVH bootstrap",original)
    old="https://ydieijgynqlckaczalju.supabase.co/functions/v1/"
    schema,replaced=re.subn(re.escape(old),"https://supabase.neiscircle.site/functions/v1/",schema)
    if removed!=1 or replaced!=2:raise RuntimeError("OVH_LIVE_IMPORT=SCHEMA_FILTER_MISMATCH")
    (work/"schema.sql").write_text(schema)
    names={}
    seen=set()
    active=None
    with (SOURCE/"data.sql").open() as inp,(work/"data.sql").open("w") as dest:
        for line in inp:
            if active is None and line.startswith("COPY "):
                match=re.match(r'^COPY\s+(?:"?([a-zA-Z_][a-zA-Z_0-9]*)"?\.)?"?([a-zA-Z_][a-zA-Z_0-9]*)"?\s+\(',line)
                if not match:raise RuntimeError("OVH_LIVE_IMPORT=INVALID_COPY_HEADER")
                active=(match.group(1) or "public")+"."+match.group(2)
                if active in names:raise RuntimeError("OVH_LIVE_IMPORT=DUPLICATE_COPY")
                names[active]=0
                if active in OMIT:seen.add(active)
                else:dest.write(line)
            elif active is not None:
                if line.strip()==r'\.':
                    if active in OMIT and names[active]:raise RuntimeError("OVH_LIVE_IMPORT=NONEMPTY_UNSUPPORTED_AUTH")
                    if active not in OMIT:dest.write(line)
                    active=None
                else:
                    names[active]+=1
                    if active not in OMIT:dest.write(line)
            else:dest.write(line)
    if active is not None or len(names)!=95 or seen!=OMIT:
        raise RuntimeError("OVH_LIVE_IMPORT=INCOMPLETE_SOURCE")
    for k,v in EXPECTED.items():
        if names.get(k)!=v:raise RuntimeError("OVH_LIVE_IMPORT=STALE_OR_UNEXPECTED_DATA")
    remaining={k:v for k,v in names.items() if k not in OMIT}
    if len(remaining)!=91:raise RuntimeError("OVH_LIVE_IMPORT=TABLE_COUNT_INVALID")
    verify=["DO $NEIS$ BEGIN"]
    for name,count in sorted(remaining.items()):
        if not re.fullmatch(r"[a-z_][a-z_0-9]*\.[a-z_][a-z_0-9]*",name):
            raise RuntimeError("OVH_LIVE_IMPORT=UNSAFE_TABLE_IDENTIFIER")
        verify.append("IF (SELECT count(*) FROM "+name+") <> "+str(count)+" THEN RAISE EXCEPTION 'row parity failed "+name+"'; END IF;")
    verify+=["IF (SELECT count(*) FROM auth.identities WHERE provider='google') <> 204 THEN RAISE EXCEPTION 'Google identity mismatch'; END IF;",
     "IF EXISTS (SELECT 1 FROM auth.identities i LEFT JOIN auth.users u ON u.id=i.user_id WHERE u.id IS NULL) THEN RAISE EXCEPTION 'orphan identity'; END IF;",
     "IF EXISTS (SELECT 1 FROM public.profiles p LEFT JOIN auth.users u ON u.id=p.id WHERE u.id IS NULL) THEN RAISE EXCEPTION 'orphan profile'; END IF;",
     "IF (SELECT count(*) FROM pg_policies WHERE schemaname='public') <> 138 THEN RAISE EXCEPTION 'RLS policy mismatch'; END IF;",
     "IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef) <> 120 THEN RAISE EXCEPTION 'definer function mismatch'; END IF;",
     "END $NEIS$;"]
    (work/"verify.sql").write_text("\n".join(verify)+"\n")
    live_id=cmd(COMPOSE+["ps","-q","db"],"OVH_LIVE_IMPORT=DB_CONTAINER_MISSING")
    for n in ("schema","data","verify"):
        cmd(DOCKER+["cp",str(work/(n+".sql")),live_id+":/tmp/neis-live-"+n+".sql"],"OVH_LIVE_IMPORT=COPY_SQL_FAILED")
    print("OVH_LIVE_IMPORT_PREFLIGHT=PASS_91_TABLES")
    cmd(COMPOSE+["stop","-t","30","functions","realtime","storage","rest","auth"],"OVH_LIVE_IMPORT=STOP_APIS_FAILED",timeout=100)
    stopped=True
    print("OVH_LIVE_WRITER_APIS=STOPPED")
    args=COMPOSE+["exec","-T","db","psql","-X","-U","postgres","-d","postgres","-v","ON_ERROR_STOP=1","--single-transaction",
      "-c","TRUNCATE TABLE auth.audit_log_entries, auth.flow_state, auth.identities, auth.mfa_amr_claims, auth.refresh_tokens, auth.sessions, auth.users RESTART IDENTITY CASCADE",
      "-f","/tmp/neis-live-schema.sql",
      "-c","ALTER TABLE auth.one_time_tokens ADD COLUMN IF NOT EXISTS expires_at timestamp with time zone",
      "-c","SET session_replication_role = replica",
      "-f","/tmp/neis-live-data.sql",
      "-c","SET session_replication_role = origin",
      "-f","/tmp/neis-live-verify.sql"]
    p=run(args,timeout=320)
    if p.returncode:
        # PostgreSQL --single-transaction rolls back all changes.
        code=re.search(r"ERROR:\s*([A-Z0-9]{5})",p.stderr)
        print("OVH_LIVE_IMPORT_SQLSTATE="+(code.group(1) if code else "UNKNOWN"))
        raise RuntimeError("OVH_LIVE_IMPORT=SQL_TRANSACTION_ROLLED_BACK")
    print("OVH_LIVE_IMPORT=PASS_ATOMIC_91_TABLES")
    print("OVH_LIVE_AUTH_GOOGLE_USERS=204")
    print("OVH_LIVE_STORAGE_METADATA=104")
    print("GITHUB_PAGES=MAINTENANCE")
finally:
    if stopped:
        r=run(COMPOSE+["up","-d","--no-deps","auth","rest","realtime","storage","functions"],timeout=180)
        print("OVH_BACKEND_RESTART="+("SUCCESS" if r.returncode==0 else "FAILED_MANUAL_REVIEW"))
    if live_id:
        for n in ("schema","data","verify"):
            run(DOCKER+["exec",live_id,"rm","-f","/tmp/neis-live-"+n+".sql"],timeout=20)
    shutil.rmtree(work,ignore_errors=True)
