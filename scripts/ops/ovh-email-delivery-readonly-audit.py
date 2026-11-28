#!/usr/bin/env python3
"""Read-only NEIS Circle email diagnostics. Never sends an email or prints secrets/recipients."""
import json, re, socket, ssl, smtplib, subprocess, sys, urllib.request, urllib.error
from collections import Counter
from pathlib import Path

ROOT=Path("/home/ubuntu/neis-supabase")
DOCKER=["sudo","-n","/usr/bin/docker"]
COMPOSE=DOCKER+["compose"]
for f in ("docker-compose.yml","docker-compose.security.yml","docker-compose.caddy.yml"):
    COMPOSE += ["-f",f]

def run(args, stdin=None, timeout=25):
    try:
        p=subprocess.run(args,input=stdin,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
            text=isinstance(stdin,str),cwd=ROOT,timeout=timeout)
        return p.returncode,p.stdout if isinstance(p.stdout,str) else p.stdout.decode("utf-8","replace"),p.stderr if isinstance(p.stderr,str) else p.stderr.decode("utf-8","replace")
    except Exception as e:
        return 99,"",type(e).__name__

def out(args,timeout=25):
    rc,stdout,_=run(args,timeout=timeout)
    return stdout.strip() if rc==0 else ""

def docker_env(container):
    raw=out(DOCKER+["inspect","--format","{{json .Config.Env}}",container])
    try:return dict(x.split("=",1) for x in json.loads(raw or "[]") if "=" in x)
    except Exception:return {}

def smtp_check(host,port,user,password):
    result={"dns":"NO","tcp":"NO","tls":"NO","auth":"NO","code":""}
    if not all(isinstance(x,str) and x for x in (host,user,password)) or not str(port).isdigit() or not (1<=int(port)<=65535):
        result["code"]="MISSING_CONFIG";return result
    try:
        socket.getaddrinfo(host,int(port),type=socket.SOCK_STREAM)
        result["dns"]="YES"
    except Exception:
        result["code"]="DNS_FAILED";return result
    try:
        context=ssl.create_default_context()
        if int(port)==465:
            with smtplib.SMTP_SSL(host,int(port),timeout=12,context=context) as smtp:
                result["tcp"]="YES";result["tls"]="YES";smtp.ehlo();smtp.login(user,password);result["auth"]="YES"
        else:
            with smtplib.SMTP(host,int(port),timeout=12) as smtp:
                result["tcp"]="YES";smtp.ehlo()
                if not smtp.has_extn("starttls"):
                    result["code"]="STARTTLS_NOT_ADVERTISED";return result
                smtp.starttls(context=context);result["tls"]="YES";smtp.ehlo()
                smtp.login(user,password);result["auth"]="YES"
    except smtplib.SMTPAuthenticationError as e: result["code"]="AUTH_"+str(e.smtp_code)
    except ssl.SSLCertVerificationError: result["code"]="TLS_CERT_INVALID"
    except ssl.SSLError: result["code"]="TLS_FAILED"
    except (socket.timeout,TimeoutError): result["code"]="TIMEOUT"
    except ConnectionRefusedError: result["code"]="CONNECTION_REFUSED"
    except Exception as e: result["code"]=type(e).__name__.upper()
    return result

def api_get(key,path):
    req=urllib.request.Request("https://api.brevo.com/v3/"+path,headers={
        "api-key":key,"accept":"application/json","user-agent":"NEIS-Email-ReadOnly-Audit/1.0"})
    try:
        with urllib.request.urlopen(req,timeout=18) as response:
            return response.status,json.loads(response.read(2_000_000))
    except urllib.error.HTTPError as e:return e.code,{}
    except Exception:return 0,{}

def main():
    supplied=json.load(sys.stdin)
    smtp_user=str(supplied.get("smtp_login") or "")
    smtp_key=str(supplied.get("smtp_key") or "")
    print("EMAIL_AUDIT=READ_ONLY_NO_EMAIL_SENT")

    auth=docker_env("supabase-auth")
    try:
        state=json.loads(out(DOCKER+["inspect","--format","{{json .State}}","supabase-auth"]) or "{}")
        print("AUTH_CONTAINER_RUNNING="+str(state.get("Running",False)).upper())
        print("AUTH_CONTAINER_HEALTH="+str((state.get("Health") or {}).get("Status","NO_HEALTHCHECK")).upper())
        print("AUTH_CONTAINER_RESTARTS="+out(DOCKER+["inspect","--format","{{.RestartCount}}","supabase-auth"]))
    except Exception:print("AUTH_CONTAINER_STATUS=UNAVAILABLE")

    keys=("GOTRUE_SMTP_HOST","GOTRUE_SMTP_PORT","GOTRUE_SMTP_USER","GOTRUE_SMTP_PASS",
          "GOTRUE_SMTP_ADMIN_EMAIL","GOTRUE_SMTP_SENDER_NAME")
    for name in keys:print("ACTIVE_"+name+"_NONEMPTY="+("YES" if auth.get(name) else "NO"))
    print("ACTIVE_SMTP_HOST_EXPECTED="+("YES" if auth.get("GOTRUE_SMTP_HOST")=="smtp-relay.brevo.com" else "NO"))
    actual={}
    if all(auth.get(k) for k in ("GOTRUE_SMTP_HOST","GOTRUE_SMTP_PORT","GOTRUE_SMTP_USER","GOTRUE_SMTP_PASS")):
        actual=smtp_check(auth["GOTRUE_SMTP_HOST"],auth["GOTRUE_SMTP_PORT"],auth["GOTRUE_SMTP_USER"],auth["GOTRUE_SMTP_PASS"])
        print("ACTIVE_SMTP_DNS="+actual["dns"]+" TCP="+actual["tcp"]+" TLS="+actual["tls"]+" AUTH="+actual["auth"]+" CODE="+actual["code"])
    else:print("ACTIVE_SMTP_TEST=SKIPPED_INCOMPLETE_CONFIG")
    if smtp_user and smtp_key:
        secret=smtp_check("smtp-relay.brevo.com",587,smtp_user,smtp_key)
        print("GITHUB_SMTP_SECRET_DNS="+secret["dns"]+" TCP="+secret["tcp"]+" TLS="+secret["tls"]+" AUTH="+secret["auth"]+" CODE="+secret["code"])
        print("ACTIVE_SMTP_MATCHES_GITHUB_SECRET="+str(bool(actual) and auth.get("GOTRUE_SMTP_USER")==smtp_user and auth.get("GOTRUE_SMTP_PASS")==smtp_key).upper())
    else:print("GITHUB_SMTP_SECRET_TEST=UNAVAILABLE")

    for url,label in (("https://supabase.neiscircle.site/auth/v1/health","PUBLIC_AUTH_V1_HEALTH"),
                      ("https://supabase.neiscircle.site/health","PUBLIC_AUTH_HEALTH")):
        try:
            req=urllib.request.Request(url,headers={"Cache-Control":"no-cache"})
            with urllib.request.urlopen(req,timeout=12) as response:print(label+"_HTTP="+str(response.status))
        except urllib.error.HTTPError as e:print(label+"_HTTP="+str(e.code))
        except Exception as e:print(label+"_HTTP=UNREACHABLE_"+type(e).__name__.upper())

    query="""select
      count(*) filter(where event_key like 'manual-content:%' and status='sent'),
      count(*) filter(where event_key like 'manual-content:%' and status='pending'),
      count(*) filter(where event_key like 'manual-content:%' and status='failed'),
      count(*) filter(where event_key like 'manual-content:%' and status='sending'),
      count(*) filter(where event_key like 'manual-content:%' and status in ('pending','failed') and attempts<5 and next_attempt_at<=now()),
      count(*) filter(where event_key not like 'manual-content:%' and status in ('pending','failed','sending')),
      coalesce(to_char(max(processed_at) filter(where event_key like 'manual-content:%' and status='sent'),'YYYY-MM-DD HH24:MI:SS'),'none'),
      count(*) filter(where event_key like 'manual-content:%' and status='failed' and last_error ilike '%Brevo rejected%'),
      count(*) filter(where event_key like 'manual-content:%' and status='failed' and last_error ilike '%Recipient email is unavailable%')
      from public.email_notification_outbox;"""
    rc,raw,_=run(COMPOSE+["exec","-T","db","psql","-X","-v","ON_ERROR_STOP=1","-U","postgres","-d","postgres","-Atq"],stdin=query,timeout=40)
    if rc==0:
        vals=raw.strip().split("|")
        if len(vals)==9:
            labels=("SENT","PENDING","FAILED","SENDING","DUE_ELIGIBLE","NONMANUAL_OPEN","LAST_SENT_UTC","FAILED_BREVO_REJECTED","FAILED_RECIPIENT_UNAVAILABLE")
            for label,value in zip(labels,vals):print("OUTBOX_"+label+"="+value)
        else:print("OUTBOX_AUDIT=UNPARSEABLE")
    else:print("OUTBOX_AUDIT=FAILED")

    guard="select count(*) from pg_trigger where tgrelid='public.email_notification_outbox'::regclass and tgname='reject_automatic_notification_email_insert' and tgenabled<>'D';"
    rc,trigger,_=run(COMPOSE+["exec","-T","db","psql","-X","-U","postgres","-d","postgres","-Atq"],stdin=guard,timeout=25)
    print("AUTOMATIC_EMAIL_GUARD="+(trigger.strip() if rc==0 else "UNKNOWN"))

    enabled=out(["sudo","-n","/usr/bin/systemctl","is-enabled","neis-manual-email-dispatch.timer"],timeout=12)
    active=out(["sudo","-n","/usr/bin/systemctl","is-active","neis-manual-email-dispatch.timer"],timeout=12)
    print("MANUAL_EMAIL_TIMER_ENABLED="+(enabled or "NO"))
    print("MANUAL_EMAIL_TIMER_ACTIVE="+(active or "NO"))
    last=out(["sudo","-n","/usr/bin/journalctl","-u","neis-manual-email-dispatch.service","--since","30 days ago","--no-pager","-n","80"],timeout=20)
    mail_lines=[line.strip().split(":",1)[-1].strip() for line in last.splitlines()
        if any(tag in line for tag in ("MANUAL_MAIL_PENDING_DUE=","MANUAL_MAIL_PROCESSED=","MANUAL_MAIL_ACCEPTED_BY_PROVIDER=","MANUAL_MAIL_WORKER="))]
    for line in mail_lines[-8:]:print("WORKER_LOG="+re.sub(r"[^A-Za-z0-9_ =./:-]","",line)[:180])

    edge=docker_env("supabase-edge-functions")
    needed=("BREVO_API_KEY","EMAIL_WORKER_SECRET","NOTIFICATION_FROM_EMAIL","NOTIFICATION_FROM_NAME","SUPABASE_SERVICE_ROLE_KEY","SUPABASE_ANON_KEY")
    for name in needed:print("EDGE_"+name+"_NONEMPTY="+("YES" if edge.get(name) else "NO"))
    api_key=edge.get("BREVO_API_KEY","")
    sender=edge.get("NOTIFICATION_FROM_EMAIL","")
    if not api_key:
        print("BREVO_API=NOT_CONFIGURED");return
    status,account=api_get(api_key,"account")
    print("BREVO_ACCOUNT_HTTP="+str(status))
    if status==200:
        plan=next((x for x in (account.get("plan") or []) if str(x.get("creditsType","")).lower()=="sendlimit"),{})
        print("BREVO_SEND_CREDITS_REMAINING="+str(plan.get("credits","UNKNOWN")))
    status,senders=api_get(api_key,"senders")
    print("BREVO_SENDERS_HTTP="+str(status))
    if status==200 and sender:
        match=next((x for x in senders.get("senders",[]) if str(x.get("email","")).lower()==sender.strip().lower()),None)
        print("BREVO_CONFIGURED_SENDER_REGISTERED="+("YES" if match else "NO"))
        print("BREVO_CONFIGURED_SENDER_ACTIVE="+(str(bool(match.get("active"))).upper() if match else "UNKNOWN"))
        domain=sender.rsplit("@",1)[-1] if "@" in sender else ""
        if domain and re.fullmatch(r"[A-Za-z0-9.-]+",domain):
            dstatus,domain_data=api_get(api_key,"senders/domains/"+domain)
            print("BREVO_SENDER_DOMAIN_HTTP="+str(dstatus))
            if dstatus==200:
                flags=[]
                def walk(obj,prefix=""):
                    if isinstance(obj,dict):
                        for k,v in obj.items():
                            key=(prefix+"_"+k).lower()
                            if isinstance(v,bool) and any(s in key for s in ("dkim","spf","auth","verif")):flags.append((key,v))
                            elif isinstance(v,(dict,list)):walk(v,key)
                    elif isinstance(obj,list):
                        for v in obj:walk(v,prefix)
                walk(domain_data)
                for k,v in flags[:12]:print("BREVO_DOMAIN_"+re.sub(r"[^a-z0-9_]+","_",k)+"="+str(v).upper())
    status,events_data=api_get(api_key,"smtp/statistics/events?days=30&limit=5000&offset=0&sort=desc")
    print("BREVO_EVENTS_HTTP="+str(status))
    events=events_data.get("events",[]) if isinstance(events_data,dict) else []
    print("BREVO_EVENTS_30D_TOTAL="+str(len(events)))
    if status==200:
        counts=Counter(str(x.get("event","unknown")).lower() for x in events)
        for event in ("request","sent","delivered","opened","unique_opened","click","deferred","soft_bounce","hard_bounce","blocked","invalid","spam"):
            if counts.get(event):print("BREVO_EVENT_"+event.upper()+"="+str(counts[event]))
        dates=[x.get("date","") for x in events if x.get("date")]
        print("BREVO_EVENTS_LATEST="+(max(dates) if dates else "none"))
    print("EMAIL_AUDIT_COMPLETE=YES")

if __name__=="__main__":
    try:main()
    except Exception as e:
        print("EMAIL_AUDIT_FATAL="+type(e).__name__,file=sys.stderr)
        raise SystemExit(1)
