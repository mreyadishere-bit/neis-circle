#!/usr/bin/env bash
set -Eeuo pipefail
cd /home/ubuntu/neis-supabase
D=(sudo -n /usr/bin/docker compose -f docker-compose.yml -f docker-compose.security.yml -f docker-compose.caddy.yml)
"${D[@]}" exec -T db psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -Atq <<'SQL'
select 'EMAIL_OUTBOX_EXISTS='||to_regclass('public.email_notification_outbox') is not null;
select 'MANUAL_BROADCAST_TABLE_EXISTS='||to_regclass('public.admin_content_email_broadcasts') is not null;
select 'EMAIL_RPC_EXISTS='||(to_regprocedure('public.admin_email_content_to_audience(text,text,boolean)') is not null)::text;
select 'QUEUE_'+upper(status)||'='||count(*)
from public.email_notification_outbox
where event_key like 'manual-content:%'
group by status order by 1;
select 'QUEUE_MANUAL_LAST_24H='||count(*)
from public.email_notification_outbox
where event_key like 'manual-content:%' and created_at>now()-interval '24 hours';
select 'QUEUE_MANUAL_EXHAUSTED='||count(*)
from public.email_notification_outbox
where event_key like 'manual-content:%'
  and attempts>=5 and status<>'sent';
select 'QUEUE_MANUAL_ELIGIBLE_NOW='||count(*)
from public.email_notification_outbox
where event_key like 'manual-content:%' and status in ('pending','failed')
  and next_attempt_at<=now() and attempts<5;
select 'QUEUE_MANUAL_EARLIEST_AGE_MIN='||coalesce(extract(epoch from (now()-min(created_at)))::bigint/60,0)
from public.email_notification_outbox where event_key like 'manual-content:%'
  and status in ('pending','failed');
select 'RECENT_BROADCAST_'||row_number() over(order by b.sent_at desc)||
'='||b.content_type||';ENQUEUED='||b.recipient_count||
';AGE_MIN='||(extract(epoch from (now()-b.sent_at))::bigint/60)||
';PENDING='||(select count(*) from public.email_notification_outbox e
  where e.event_key like 'manual-content:'||b.batch_id::text||':%'
    and e.status='pending')||
';SENDING='||(select count(*) from public.email_notification_outbox e
  where e.event_key like 'manual-content:'||b.batch_id::text||':%'
    and e.status='sending')||
';SENT='||(select count(*) from public.email_notification_outbox e
  where e.event_key like 'manual-content:'||b.batch_id::text||':%'
    and e.status='sent')||
';FAILED='||(select count(*) from public.email_notification_outbox e
  where e.event_key like 'manual-content:'||b.batch_id::text||':%'
    and e.status='failed')
from (select content_type,sent_at,recipient_count,batch_id from public.admin_content_email_broadcasts
      order by sent_at desc limit 5) b;
select 'RECENT_MANUAL_ERROR_CLASS='||case
 when last_error ilike '%capacity%' or last_error ilike '%limit%' then 'LIMIT_OR_CAPACITY'
 when last_error ilike '%401%' or last_error ilike '%403%' then 'AUTH_PROVIDER_REJECTED'
 when last_error ilike '%sender%' then 'SENDER_CONFIGURATION'
 when last_error ilike '%recipient%' then 'RECIPIENT_INELIGIBLE'
 when last_error ilike '%Brevo rejected%' then 'BREVO_REJECTED'
 when last_error is null then 'NONE'
 else 'OTHER' end||';COUNT='||count(*)
from public.email_notification_outbox
where event_key like 'manual-content:%' and status='failed'
group by 1 order by 1;
SQL
python3 - <<'PY'
import json,subprocess,urllib.request,urllib.error
cmd=["sudo","-n","/usr/bin/docker","inspect","--format","{{json .Config.Env}}","supabase-edge-functions"]
r=subprocess.run(cmd,text=True,capture_output=True,timeout=15)
if r.returncode:
 print("EMAIL_EDGE_ENV=UNAVAILABLE")
else:
 env=dict(v.split("=",1) for v in json.loads(r.stdout) if "=" in v)
 for name in ("EMAIL_WORKER_SECRET","BREVO_API_KEY","NOTIFICATION_FROM_EMAIL",
              "SUPABASE_SERVICE_ROLE_KEY","SUPABASE_URL"):
  print("EDGE_"+name+"_CONFIGURED="+str(bool(env.get(name))))
 if env.get("BREVO_API_KEY"):
  request=urllib.request.Request("https://api.brevo.com/v3/account",headers={
   "api-key":env["BREVO_API_KEY"],"accept":"application/json",
   "user-agent":"NEIS-Email-ReadOnly-Audit"})
  try:
   with urllib.request.urlopen(request,timeout=14) as response:
    body=json.loads(response.read(150000))
    plan=next((p for p in body.get("plan",[]) if p.get("creditsType")=="sendLimit"),{})
    print("BREVO_ACCOUNT_HTTP="+str(response.status))
    print("BREVO_CREDITS_REMAINING="+str(plan.get("credits","UNKNOWN")))
  except urllib.error.HTTPError as e:print("BREVO_ACCOUNT_HTTP="+str(e.code))
  except Exception:print("BREVO_ACCOUNT_HTTP=UNAVAILABLE")
for label,cmd in (
 ("UBUNTU_CRONTAB",["crontab","-l"]),
 ("ROOT_CRONTAB",["sudo","-n","crontab","-l"]),
 ("SYSTEMD_UNITS",["systemctl","list-unit-files","--no-pager","--plain"]),
 ("SYSTEMD_TIMERS",["systemctl","list-timers","--all","--no-pager","--plain"]),
):
 try:
  v=subprocess.run(cmd,text=True,capture_output=True,timeout=15)
  lines=v.stdout.lower().splitlines() if v.returncode==0 else []
  matches=[x for x in lines if any(n in x for n in ("send-notification-email","email-worker","neis-email","email-dispatch"))]
  print("EMAIL_"+label+"_MATCHING_ENTRIES="+str(len(matches)))
  # Only schedule classification, not command output (can contain a secret).
 except Exception:print("EMAIL_"+label+"=UNAVAILABLE")
PY
echo EMAIL_AUDIT=READ_ONLY_DONE