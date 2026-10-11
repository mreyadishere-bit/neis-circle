#!/usr/bin/env python3
"""Backoff-aware Web Push retry. No action until original VAPID keys exist."""
import subprocess
from pathlib import Path
ROOT=Path("/home/ubuntu/neis-supabase")
DC=["sudo","-n","/usr/bin/docker","compose",
    "-f","docker-compose.yml","-f","docker-compose.security.yml",
    "-f","docker-compose.caddy.yml",
    "exec","-T","db","psql","-X","-v","ON_ERROR_STOP=1",
    "-U","postgres","-d","postgres","-Atqc"]
def sql(command):
    p=subprocess.run(DC+[command],cwd=ROOT,stdin=subprocess.DEVNULL,
                     capture_output=True,text=True,timeout=30)
    if p.returncode:
        raise RuntimeError("WEBPUSH_RETRY=DATABASE_UNAVAILABLE")
    return p.stdout.strip()
try:
    ready=sql("""select exists(
        select 1 from public.get_web_push_vapid_keys()
        where length(public_key)>80 and length(private_key)>30
    )""")
    if ready!="t":
        print("WEBPUSH_RETRY=WAITING_FOR_ORIGINAL_VAPID")
        raise SystemExit(0)
    due=sql("""select count(*) from public.web_push_outbox
        where status in ('pending','failed')
        and next_attempt_at<=now() and attempts<5""")
    if not due.isdigit():raise RuntimeError("WEBPUSH_RETRY=INVALID_COUNT")
    if int(due)==0:
        print("WEBPUSH_RETRY=NO_DUE_JOBS")
        raise SystemExit(0)
    submitted=sql("""with due as (
      select id,dispatch_token from public.web_push_outbox
      where status in ('pending','failed') and next_attempt_at<=now() and attempts<5
      order by created_at limit 20
    ), queued as (
      select net.http_post(
        url:='https://supabase.neiscircle.site/functions/v1/send-web-push',
        body:=jsonb_build_object('job_id',due.id,'dispatch_token',due.dispatch_token),
        params:='{}'::jsonb,
        headers:='{"Content-Type":"application/json"}'::jsonb,
        timeout_milliseconds:=7000
      ) as request_id from due
    ) select count(request_id) from queued""")
    if not submitted.isdigit() or int(submitted)>20:
        raise RuntimeError("WEBPUSH_RETRY=QUEUE_COUNT_INVALID")
    print("WEBPUSH_RETRY=QUEUED_"+submitted)
except SystemExit:
    raise
except Exception as exc:
    print(str(exc) if str(exc).startswith("WEBPUSH_RETRY=") else "WEBPUSH_RETRY=UNEXPECTED_ERROR")
    raise SystemExit(1)
