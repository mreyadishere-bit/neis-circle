#!/usr/bin/env bash
set -Eeuo pipefail
# Verify OVH Supabase Auth SMTP credentials via TLS and AUTH only.
# Never send MAIL FROM, RCPT TO or DATA; no email is generated.
cd /home/ubuntu/neis-supabase
python3 - <<'PY'
import json,subprocess,smtplib,ssl,sys,socket
cmd=['sudo','-n','/usr/bin/docker','compose']
for f in ('docker-compose.yml','docker-compose.security.yml','docker-compose.caddy.yml','docker-compose.edge-integrations.yml'):
 cmd+=['-f',f]
p=subprocess.run([*cmd,'config','--format','json'],capture_output=True,text=True,timeout=35)
if p.returncode:
 print('OVH_SMTP=BLOCKED_COMPOSE');sys.exit(1)
try:
 auth=json.loads(p.stdout)['services']['auth']['environment']
 if isinstance(auth,list):auth=dict(x.split('=',1) for x in auth if '=' in x)
 host=auth['GOTRUE_SMTP_HOST']
 port=int(auth['GOTRUE_SMTP_PORT'])
 username=auth['GOTRUE_SMTP_USER']
 password=auth['GOTRUE_SMTP_PASS']
 assert all(isinstance(x,str) and x.strip() for x in (host,username,password))
 assert 0<port<65536
 assert auth.get('GOTRUE_SITE_URL')=='https://neiscircle.site'
except Exception:
 print('OVH_SMTP=BLOCKED_INVALID_CONFIG');sys.exit(1)
try:
 context=ssl.create_default_context()
 if port==465:
  session=smtplib.SMTP_SSL(host,port,timeout=18,context=context)
 else:
  session=smtplib.SMTP(host,port,timeout=18)
 with session as smtp:
  smtp.ehlo()
  if port!=465:
   if not smtp.has_extn('starttls'):
    print('OVH_SMTP=BLOCKED_NO_STARTTLS');sys.exit(1)
   smtp.starttls(context=context)
   smtp.ehlo()
  smtp.login(username,password)
  print('OVH_AUTH_SMTP_TLS=PASS')
  print('OVH_AUTH_SMTP_LOGIN=PASS')
except smtplib.SMTPAuthenticationError:
 print('OVH_AUTH_SMTP_LOGIN=REJECTED');sys.exit(1)
except ssl.SSLError:
 print('OVH_AUTH_SMTP_TLS=FAILED');sys.exit(1)
except (OSError,smtplib.SMTPException,ValueError):
 print('OVH_AUTH_SMTP_CONNECTION=FAILED');sys.exit(1)
print('OVH_SMTP_EMAILS_SENT=0')
print('OVH_SMTP_SECRET_VALUES_LOGGED=NO')
print('OVH_SMTP=PASS_AUTHENTICATION_ONLY')
PY
