#!/usr/bin/env bash
set -Eeuo pipefail
# Read-only OVH Auth SMTP failure triage. NO MAIL FROM, RCPT TO, DATA or email.
cd /home/ubuntu/neis-supabase
python3 - <<'PY'
import json, subprocess, socket, smtplib, ssl, sys
docker=['sudo','-n','/usr/bin/docker']
cmd=[*docker,'compose']
for f in ('docker-compose.yml','docker-compose.security.yml','docker-compose.caddy.yml','docker-compose.edge-integrations.yml'):cmd+=['-f',f]
p=subprocess.run([*cmd,'config','--format','json'],capture_output=True,text=True,timeout=35)
if p.returncode:
 print('SMTP_DIAGNOSTIC=BLOCKED_COMPOSE');sys.exit(1)
try:
 auth=json.loads(p.stdout)['services']['auth']['environment']
 if isinstance(auth,list):auth=dict(x.split('=',1) for x in auth if '=' in x)
 host=auth['GOTRUE_SMTP_HOST']
 port=int(auth['GOTRUE_SMTP_PORT'])
 username=auth['GOTRUE_SMTP_USER']
 password=auth['GOTRUE_SMTP_PASS']
 assert host and 0<port<65536 and username and password
except Exception:
 print('SMTP_DIAGNOSTIC=BLOCKED_CONFIG');sys.exit(1)
# Do not print the configured host, identities, passwords or IPs.
print('SMTP_PORT_CLASS='+('IMPLICIT_TLS' if port==465 else 'STARTTLS' if port in (587,2525) else 'OTHER'))
inspect=subprocess.run([*docker,'inspect','--format','{{json .Config.Env}}','supabase-auth'],capture_output=True,text=True,timeout=20)
if inspect.returncode:
 print('SMTP_AUTH_CONTAINER_ENV=UNVERIFIED')
else:
 try:
  env=dict(x.split('=',1) for x in json.loads(inspect.stdout) if '=' in x)
  comparison=all(env.get('GOTRUE_SMTP_'+k)==auth.get('GOTRUE_SMTP_'+k) for k in ('HOST','PORT','USER','PASS'))
  print('SMTP_AUTH_CONTAINER_ENV='+('MATCHES_COMPOSE' if comparison else 'DIFFERS_FROM_COMPOSE'))
 except Exception:print('SMTP_AUTH_CONTAINER_ENV=INVALID_INSPECT')
try:
 addresses=socket.getaddrinfo(host,port,type=socket.SOCK_STREAM)
 if not addresses:raise OSError('empty DNS')
 print('SMTP_DNS=RESOLVES')
 print('SMTP_DNS_IPV4='+('YES' if any(a[0]==socket.AF_INET for a in addresses) else 'NO'))
 print('SMTP_DNS_IPV6='+('YES' if any(a[0]==socket.AF_INET6 for a in addresses) else 'NO'))
except Exception:
 print('SMTP_DNS=FAILED');sys.exit(1)
try:
 with socket.create_connection((host,port),timeout=12):
  pass
 print('SMTP_TCP=CONNECTED')
except socket.timeout:
 print('SMTP_TCP=TIMEOUT');sys.exit(1)
except ConnectionRefusedError:
 print('SMTP_TCP=REFUSED');sys.exit(1)
except OSError:
 print('SMTP_TCP=FAILED');sys.exit(1)
try:
 context=ssl.create_default_context()
 if port==465:session=smtplib.SMTP_SSL(host,port,timeout=18,context=context)
 else:session=smtplib.SMTP(host,port,timeout=18)
 with session as smtp:
  smtp.ehlo()
  if port!=465:
   if not smtp.has_extn('starttls'):
    print('SMTP_TLS=STARTTLS_NOT_ADVERTISED');sys.exit(1)
   smtp.starttls(context=context)
   smtp.ehlo()
  print('SMTP_TLS=VERIFIED')
  if not smtp.has_extn('auth'):
   print('SMTP_AUTH=NOT_ADVERTISED');sys.exit(1)
  smtp.login(username,password)
  print('SMTP_AUTH=ACCEPTED')
except smtplib.SMTPAuthenticationError as exc:
 print('SMTP_AUTH=REJECTED')
 print('SMTP_AUTH_RESPONSE_CLASS='+('CREDENTIALS_OR_POLICY' if exc.smtp_code in (534,535,538) else 'TEMPORARY' if 400<=exc.smtp_code<500 else 'OTHER'))
 sys.exit(1)
except ssl.SSLCertVerificationError:
 print('SMTP_TLS=CERTIFICATE_INVALID');sys.exit(1)
except ssl.SSLError:
 print('SMTP_TLS=HANDSHAKE_FAILED');sys.exit(1)
except (socket.timeout,TimeoutError):
 print('SMTP_PROTOCOL=TIMEOUT');sys.exit(1)
except smtplib.SMTPConnectError:
 print('SMTP_PROTOCOL=CONNECT_REJECTED');sys.exit(1)
except smtplib.SMTPServerDisconnected:
 print('SMTP_PROTOCOL=DISCONNECTED');sys.exit(1)
except (OSError,smtplib.SMTPException):
 print('SMTP_PROTOCOL=FAILED');sys.exit(1)
print('SMTP_DIAGNOSTIC=PASS')
print('SMTP_MAIL_SENT=0')
print('SMTP_SECRET_OR_IDENTITIES_LOGGED=NO')
PY
