#!/usr/bin/env python3
"""Only dispatch already-authorized manual NEIS content email notifications.
Secrets read in-memory from existing Edge container. No new recipient creation.
"""
import fcntl
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT=Path("/home/ubuntu/neis-supabase")
STATE=Path("/home/ubuntu/.local/share/neis-private-monitor")
DOCKER=["sudo","-n","/usr/bin/docker"]
COMPOSE=DOCKER+["compose"]+[x for f in
 ("docker-compose.yml","docker-compose.security.yml","docker-compose.caddy.yml")
 for x in ("-f",f)]

def cmd(args,stdin=None,timeout=30):
    r=subprocess.run(args,input=stdin,stdout=subprocess.PIPE,
                     stderr=subprocess.PIPE,text=True,cwd=ROOT,timeout=timeout)
    if r.returncode:raise RuntimeError("LOCAL_READ_FAILED")
    return r.stdout.strip()

def sql(q):
    return cmd(COMPOSE+["exec","-T","db","psql","-X","-v","ON_ERROR_STOP=1",
                         "-U","postgres","-d","postgres","-Atq"],stdin=q,timeout=22)

def run():
    STATE.mkdir(mode=0o700,parents=True,exist_ok=True)
    fd=os.open(STATE/"manual-email-dispatch.lock",os.O_CREAT|os.O_RDWR,0o600)
    with os.fdopen(fd,"w") as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:
            print("MANUAL_MAIL_WORKER=ALREADY_RUNNING")
            return
        # Read-only eligibility and *fail closed* if any automatic mail is queued.
        checks=sql("""select
          (select count(*) from public.email_notification_outbox
            where status in ('pending','failed') and attempts<5 and next_attempt_at<=now()
              and event_key like 'manual-content:%')||'|'||
          (select count(*) from public.email_notification_outbox
            where status in ('pending','failed') and attempts<5 and next_attempt_at<=now()
              and event_key not like 'manual-content:%')||'|'||
          (select count(*) from pg_trigger
            where tgrelid='public.email_notification_outbox'::regclass
             and tgname='reject_automatic_notification_email_insert' and tgenabled<>'D');""")
        nums=[int(x) for x in checks.split("|")]
        if len(nums)!=3:raise RuntimeError("QUEUE_STATUS_BAD")
        pending,automatic,guard=nums
        print("MANUAL_MAIL_PENDING_DUE="+str(pending))
        if automatic:
            print("MANUAL_MAIL_WORKER=STOP_UNEXPECTED_AUTOMATIC_QUEUE")
            raise RuntimeError("UNEXPECTED_NONMANUAL_JOBS")
        if guard!=1:raise RuntimeError("AUTO_EMAIL_GUARD_MISSING")
        if pending==0:
            print("MANUAL_MAIL_WORKER=IDLE")
            return

        raw=cmd(DOCKER+["inspect","--format","{{json .Config.Env}}",
                        "supabase-edge-functions"],timeout=15)
        env=dict(item.split("=",1) for item in json.loads(raw) if "=" in item)
        for key in ("EMAIL_WORKER_SECRET","SUPABASE_ANON_KEY","BREVO_API_KEY",
                    "NOTIFICATION_FROM_EMAIL","SUPABASE_SERVICE_ROLE_KEY"):
            if not env.get(key):raise RuntimeError("EDGE_EMAIL_CONFIG_INCOMPLETE")
        # No credentials in command arguments, files or journal messages.
        url="https://supabase.neiscircle.site/functions/v1/send-notification-email"
        request=urllib.request.Request(url,method="POST",data=b"{}",headers={
          "Content-Type":"application/json",
          "apikey":env["SUPABASE_ANON_KEY"],
          "Authorization":"Bearer "+env["SUPABASE_ANON_KEY"],
          "x-worker-secret":env["EMAIL_WORKER_SECRET"],
          "User-Agent":"NEIS-OVH-Manual-Email-Dispatcher/1.0",
        })
        try:
            with urllib.request.urlopen(request,timeout=95) as response:
                if response.status!=200:raise RuntimeError("UNEXPECTED_HTTP_STATUS")
                info=json.loads(response.read(2048))
        except urllib.error.HTTPError as exc:
            print("MANUAL_MAIL_WORKER=HTTP_"+str(exc.code))
            raise RuntimeError("WORKER_REQUEST_REJECTED") from None
        except urllib.error.URLError:
            raise RuntimeError("WORKER_NETWORK_ERROR") from None

        processed=int(info.get("processed",0))
        sent=int(info.get("sent",0))
        reason=info.get("reason")
        print("MANUAL_MAIL_PROCESSED="+str(processed))
        print("MANUAL_MAIL_ACCEPTED_BY_PROVIDER="+str(sent))
        if reason=="brevo_daily_limit_reached":
            print("MANUAL_MAIL_WORKER=WAIT_DAILY_RESET")
            return
        if processed<1 or sent<0 or sent>processed:
            raise RuntimeError("DISPATCH_RESPONSE_INVALID")
        if processed and not sent:raise RuntimeError("ALL_ATTEMPTS_FAILED")
        print("MANUAL_MAIL_WORKER=OK")
if __name__=="__main__":
    try:run()
    except Exception as error:
        accepted={"LOCAL_READ_FAILED","QUEUE_STATUS_BAD","UNEXPECTED_NONMANUAL_JOBS",
                  "AUTO_EMAIL_GUARD_MISSING","EDGE_EMAIL_CONFIG_INCOMPLETE",
                  "UNEXPECTED_HTTP_STATUS","WORKER_REQUEST_REJECTED","WORKER_NETWORK_ERROR",
                  "DISPATCH_RESPONSE_INVALID","ALL_ATTEMPTS_FAILED"}
        msg=str(error)
        print("MANUAL_MAIL_WORKER=FAILED_"+(msg if msg in accepted else "UNKNOWN"),
              file=sys.stderr)
        raise SystemExit(1)
