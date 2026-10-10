#!/usr/bin/env bash
set -Eeuo pipefail
# Test official Brevo SMTP relay with existing OVH auth credentials. NO EMAIL SENT.
cd /home/ubuntu/neis-supabase
python3 - <<'PY'
import json,subprocess,smtplib,ssl,socket,sys
cmd=['sudo','-n','/usr/bin/docker','compose']
for f in ('docker-compose.yml','docker-compose.security.yml','docker-compose.caddy.yml','docker-compose.edge-integrations.yml'):cmd+=['-f',f]
p=subprocess.run([*cmd,'config','--format','json'],capture_output=True,text=True,timeout=35)
if p.returncode:print('BREVO_PROBE=BLOCKED_COMPOSE');sys.exit(1)
try:
 env=json.loads(p.stdout)['services']['auth']['environment']
 user=env['GOTRUE_SMTP_USER'];password=env['GOTRUE_SMTP_PASS']
 assert user and password
except Exception:
 print('BREVO_PROBE=BLOCKED_CREDENTIALS_MISSING');sys.exit(1)
host='smtp-relay.brevo.com'
try:
 addr=socket.getaddrinfo(host,587,type=socket.SOCK_STREAM)
 if not addr:raise OSError()
 print('BREVO_RELAY_DNS=PASS')
except OSError:
 print('BREVO_RELAY_DNS=FAIL');sys.exit(1)
context=ssl.create_default_context()
for port in (587,2525,465):
 method='SMTPS' if port==465 else 'STARTTLS'
 try:
  if port==465:client=smtplib.SMTP_SSL(host,port,timeout=11,context=context)
  else:client=smtplib.SMTP(host,port,timeout=11)
  with client as smtp:
   smtp.ehlo()
   if port!=465:
    if not smtp.has_extn('starttls'):
     print('BREVO_'+str(port)+'_TLS=NOT_SUPPORTED')
     continue
    smtp.starttls(context=context);smtp.ehlo()
   print('BREVO_'+str(port)+'_TLS=PASS')
   smtp.login(user,password)
   print('BREVO_RELAY_AUTH=PASS')
   print('BREVO_RECOMMENDED_PORT='+str(port))
   print('BREVO_PROBE=PASS_NO_EMAIL')
   print('BREVO_MESSAGES_SENT=0')
   sys.exit(0)
 except smtplib.SMTPAuthenticationError as e:
  print('BREVO_RELAY_AUTH=REJECTED')
  print('BREVO_RELAY_AUTH_CODE='+str(e.smtp_code))
  print('BREVO_PROBE=BLOCKED_SMTP_CREDENTIALS')
  sys.exit(1)
 except ssl.SSLCertVerificationError:
  print('BREVO_'+str(port)+'_TLS=CERT_INVALID')
 except ssl.SSLError:
  print('BREVO_'+str(port)+'_TLS=HANDSHAKE_FAILURE')
 except (OSError,smtplib.SMTPException,ValueError):
  print('BREVO_'+str(port)+'_CONNECT_OR_PROTOCOL=FAILED')
print('BREVO_PROBE=BLOCKED_RELAY_NETWORK')
print('BREVO_MESSAGES_SENT=0')
sys.exit(1)
PY
