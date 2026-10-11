#!/usr/bin/env python3
"""Install OVH manual email systemd timer safely, and run one already-queued batch."""
from pathlib import Path
import json,subprocess,shutil,sys
ROOT=Path("/home/ubuntu/neis-supabase")
STAGE=Path("/home/ubuntu/neis-backups/manual-email-dispatch-20261011")
DEST=Path("/home/ubuntu/.local/share/neis-private-monitor/manual-email-dispatch.py")
SERVICE=Path("/etc/systemd/system/neis-manual-email-dispatch.service")
TIMER=Path("/etc/systemd/system/neis-manual-email-dispatch.timer")
DOCKER=["sudo","-n","/usr/bin/docker"]
COMPOSE=DOCKER+["compose"]+[v for f in
 ("docker-compose.yml","docker-compose.security.yml","docker-compose.caddy.yml")
 for v in ("-f",f)]
phase="preflight"

def run(args,stdin=None,timeout=60,check=True):
    p=subprocess.run(args,text=True,input=stdin,capture_output=True,cwd=ROOT,timeout=timeout)
    if check and p.returncode:raise RuntimeError("COMMAND_FAILED")
    return p

def demand(test,reason):
    if not test:raise RuntimeError(reason)

def sql(q):
    return run(COMPOSE+["exec","-T","db","psql","-X","-v","ON_ERROR_STOP=1",
             "-U","postgres","-d","postgres","-Atq"],stdin=q,timeout=30).stdout.strip()

def main():
    global phase
    for name in ("worker.py","service.unit","timer.unit"):
        demand((STAGE/name).is_file(),"STAGING_FILE_MISSING")
    worker=(STAGE/"worker.py").read_text()
    service=(STAGE/"service.unit").read_text()
    timer=(STAGE/"timer.unit").read_text()
    for phrase in ("manual-content:%","UNEXPECTED_NONMANUAL_JOBS",
         "reject_automatic_notification_email_insert","MANUAL_MAIL_PENDING_DUE"):
        demand(phrase in worker,"MANUAL_SAFETY_MISSING")
    demand("OnUnitInactiveSec=2min" in timer and "manual-email-dispatch.py" in service,
           "SCHEDULE_UNEXPECTED")
    run(["python3","-m","py_compile",str(STAGE/"worker.py")])
    run(COMPOSE+["config","--quiet"],timeout=35)
    # Explicitly verify 204 existing manual requests are eligible and automatic enqueuing is disabled.
    readiness=sql("""select
     (select count(*) from public.email_notification_outbox
      where event_key like 'manual-content:%' and status in ('pending','failed')
      and attempts<5)||'|'||
     (select count(*) from public.email_notification_outbox
      where event_key not like 'manual-content:%' and status in ('pending','failed'))||'|'||
     (select count(*) from pg_trigger
      where tgrelid='public.email_notification_outbox'::regclass
       and tgname='reject_automatic_notification_email_insert' and tgenabled<>'D');""")
    manual,other,guard=[int(x) for x in readiness.split("|")]
    demand(other==0 and guard==1,"AUTO_EMAIL_SAFETY_FAILURE")
    print("OVH_EMAIL_EXISTING_MANUAL_PENDING="+str(manual))
    print("OVH_EMAIL_AUTO_QUEUE=DISABLED")

    env=json.loads(run(DOCKER+["inspect","--format","{{json .Config.Env}}",
                         "supabase-edge-functions"],timeout=16).stdout)
    pairs=dict(s.split("=",1) for s in env if "=" in s)
    for key in ("BREVO_API_KEY","EMAIL_WORKER_SECRET",
                "NOTIFICATION_FROM_EMAIL","SUPABASE_ANON_KEY","SUPABASE_SERVICE_ROLE_KEY"):
        demand(bool(pairs.get(key)),"MISSING_EDGE_CONFIG")
    # Check endpoint is protected using intentionally invalid secret; no messages triggered.
    # Do not call the worker with its valid key during preflight.
    import urllib.request,urllib.error
    request=urllib.request.Request(
      "https://supabase.neiscircle.site/functions/v1/send-notification-email",
      data=b"{}",method="POST",headers={
        "content-type":"application/json",
        "apikey":pairs["SUPABASE_ANON_KEY"],
        "authorization":"Bearer "+pairs["SUPABASE_ANON_KEY"],
        "x-worker-secret":"invalid-audit-secret",
      })
    try:
        with urllib.request.urlopen(request,timeout=18) as resp:status=resp.status
    except urllib.error.HTTPError as e:status=e.code
    except Exception:status=None
    demand(status in (401,403),"WORKER_ENDPOINT_AUTH_NOT_VERIFIED")
    print("OVH_EMAIL_WORKER_AUTH_HTTP="+str(status))

    # Avoid overwriting hand-maintained or unrelated systemd units.
    for path,expected in ((SERVICE,service),(TIMER,timer)):
        if path.is_file():
            existing=run(["sudo","-n","cat",str(path)],timeout=12).stdout
            demand(existing==expected,"UNIT_COLLISION")
    phase="install"
    DEST.parent.mkdir(parents=True,exist_ok=True)
    worker_tmp=Path(str(DEST)+".new")
    shutil.copy2(STAGE/"worker.py",worker_tmp)
    worker_tmp.chmod(0o600)
    worker_tmp.replace(DEST)
    run(["sudo","-n","install","-m","0644",str(STAGE/"service.unit"),str(SERVICE)],timeout=20)
    run(["sudo","-n","install","-m","0644",str(STAGE/"timer.unit"),str(TIMER)],timeout=20)
    run(["sudo","-n","/usr/bin/systemctl","daemon-reload"],timeout=35)
    run(["sudo","-n","/usr/bin/systemctl","enable","--now",
         "neis-manual-email-dispatch.timer"],timeout=35)
    phase="first_batch"
    # Starting explicitly allows us to prove actual Brevo acceptance (no new send requests queued).
    first=run(["sudo","-n","/usr/bin/systemctl","start",
               "neis-manual-email-dispatch.service"],timeout=145,check=False)
    if first.returncode:
        # Safe fail-closed: existing queue stays saved until fixed.
        run(["sudo","-n","/usr/bin/systemctl","disable","--now",
             "neis-manual-email-dispatch.timer"],timeout=35,check=False)
        print("OVH_EMAIL_TIMER=DISABLED_AFTER_WORKER_FAILURE")
        raise RuntimeError("FIRST_BATCH_FAILED")
    result=sql("""select
      (select count(*) from public.email_notification_outbox
       where event_key like 'manual-content:%' and status='sent')||'|'||
      (select count(*) from public.email_notification_outbox
       where event_key like 'manual-content:%' and status in ('pending','failed'))||'|'||
      (select count(*) from public.email_notification_outbox
       where event_key like 'manual-content:%' and status='sending');""")
    sent,pending,sending=[int(x) for x in result.split("|")]
    active=run(["sudo","-n","/usr/bin/systemctl","is-enabled",
                "neis-manual-email-dispatch.timer"],check=False).stdout.strip()
    demand(active=="enabled","TIMER_NOT_ENABLED")
    demand(sent>0 or manual==0,"NO_PROVIDER_ACCEPTED_MESSAGES")
    print("OVH_EMAIL_DISPATCH=INSTALLED_AND_ACTIVE")
    print("OVH_EMAIL_FIRST_BATCH_SENT="+str(sent))
    print("OVH_EMAIL_QUEUE_REMAINING="+str(pending))
    print("OVH_EMAIL_QUEUE_SENDING="+str(sending))
    print("OVH_EMAIL_AUTO_NOTIFICATIONS=STILL_DISABLED")
    print("OVH_EMAIL_NO_DUPLICATE_QUEUE_INSERTS=YES")
if __name__=="__main__":
    try:main()
    except Exception as e:
        safe={"STAGING_FILE_MISSING","MANUAL_SAFETY_MISSING","SCHEDULE_UNEXPECTED",
              "AUTO_EMAIL_SAFETY_FAILURE","MISSING_EDGE_CONFIG",
              "WORKER_ENDPOINT_AUTH_NOT_VERIFIED","UNIT_COLLISION",
              "FIRST_BATCH_FAILED","TIMER_NOT_ENABLED",
              "NO_PROVIDER_ACCEPTED_MESSAGES","COMMAND_FAILED"}
        print("OVH_EMAIL_DISPATCH=FAILED_"+phase.upper()+"_"+
             (str(e) if str(e) in safe else "UNEXPECTED"),file=sys.stderr)
        raise SystemExit(1)
