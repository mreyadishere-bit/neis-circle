#!/usr/bin/env bash
set -Eeuo pipefail
# Switch only Supabase Auth SMTP from the local mail catcher to verified Brevo SMTP.
# Validate credentials before changing Auth, preserve sender identity, and rollback Auth only.
cd /home/ubuntu/neis-supabase
bundle=/home/ubuntu/neis-backups/ovh-brevo-smtp-private-20261010.json
overlay=docker-compose.auth-smtp-brevo.yml
tmp="$(mktemp -d)"
chmod 700 "$tmp"
trap 'rm -rf "$tmp"; rm -f "$bundle"' EXIT
umask 077
[[ -f "$bundle" && ! -L "$bundle" && "$(stat -c '%a' "$bundle")" == 600 ]] || { echo 'AUTH_SMTP=BLOCKED_PRIVATE_BUNDLE';exit 1; }

# Read credentials privately and authenticate to Brevo before touching production.
if ! python3 - "$bundle" "$tmp/override.yml" <<'PY'
import json,subprocess,smtplib,ssl,sys
from pathlib import Path
bundle=Path(sys.argv[1]);out=Path(sys.argv[2])
try:
 config=json.loads(bundle.read_text())
 assert set(config)=={'BREVO_SMTP_LOGIN','BREVO_SMTP_KEY'}
 user=config['BREVO_SMTP_LOGIN'];password=config['BREVO_SMTP_KEY']
 assert isinstance(user,str) and isinstance(password,str)
 assert 1<=len(user)<180 and 8<=len(password)<500
 assert all(ord(c)>=32 for c in user+password)
except Exception:
 print('AUTH_SMTP=BLOCKED_BUNDLE_FORMAT');sys.exit(1)
host='smtp-relay.brevo.com';port=587
try:
 with smtplib.SMTP(host,port,timeout=18) as smtp:
  smtp.ehlo()
  if not smtp.has_extn('starttls'):raise RuntimeError('STARTTLS unavailable')
  smtp.starttls(context=ssl.create_default_context());smtp.ehlo()
  smtp.login(user,password)
except smtplib.SMTPAuthenticationError:
 print('AUTH_SMTP=BLOCKED_BREVO_LOGIN_REJECTED');sys.exit(1)
except Exception:
 print('AUTH_SMTP=BLOCKED_BREVO_CONNECT_TLS_OR_AUTH');sys.exit(1)
print('AUTH_SMTP_BREVO=TLS_AUTH_VERIFIED_WITHOUT_MAIL')

# Only SMTP transport credentials change. Existing sender email/name and all
# signup, JWT, OAuth, URL, rate-limit and other Auth settings remain untouched.
text='services:\n  auth:\n    environment:\n'
for name,value in (('GOTRUE_SMTP_HOST',host),('GOTRUE_SMTP_PORT','587'),
                   ('GOTRUE_SMTP_USER',user),('GOTRUE_SMTP_PASS',password)):
 text+='      '+name+': '+json.dumps(value.replace('$','$$'))+'\n'
out.write_text(text);out.chmod(0o600)
cmd=['sudo','-n','/usr/bin/docker','compose']
for f in ('docker-compose.yml','docker-compose.security.yml','docker-compose.caddy.yml',
          'docker-compose.edge-integrations.yml',str(out)):
 cmd+=['-f',f]
p=subprocess.run([*cmd,'config','--format','json'],capture_output=True,text=True,timeout=45)
if p.returncode:
 print('AUTH_SMTP=BLOCKED_COMPOSE_VALIDATION');sys.exit(1)
try:
 env=json.loads(p.stdout)['services']['auth']['environment']
 assert env['GOTRUE_SMTP_HOST']==host and str(env['GOTRUE_SMTP_PORT'])=='587'
 assert env['GOTRUE_SMTP_USER']==user and env['GOTRUE_SMTP_PASS']==password
 assert env.get('GOTRUE_SMTP_ADMIN_EMAIL')
 assert env.get('GOTRUE_SMTP_SENDER_NAME')
except Exception:
 print('AUTH_SMTP=BLOCKED_CONFIG_NOT_MATCHING_OR_SENDER_MISSING');sys.exit(1)
print('AUTH_SMTP_PRIVATE_OVERLAY=VALIDATED')
PY
then exit 1; fi

compose() {
 sudo -n /usr/bin/docker compose \
  -f docker-compose.yml -f docker-compose.security.yml \
  -f docker-compose.caddy.yml -f docker-compose.edge-integrations.yml "$@"
}
activate() {
 sudo -n /usr/bin/docker compose \
  -f docker-compose.yml -f docker-compose.security.yml \
  -f docker-compose.caddy.yml -f docker-compose.edge-integrations.yml \
  -f "$overlay" "$@"
}
rollback() {
 echo 'AUTH_SMTP=ROLLING_BACK_AUTH_ONLY'
 if compose up -d --no-deps --force-recreate auth >"$tmp/rollback.log" 2>&1; then
  rm -f "$overlay"
  echo 'AUTH_SMTP_ROLLBACK=SUCCESS'
 else
  echo 'AUTH_SMTP_ROLLBACK=FAILED_MANUAL_REVIEW_REQUIRED'
 fi
}

# Keep any stale private override safely for recovery, then atomically replace it.
if [[ -e "$overlay" ]]; then
 [[ -f "$overlay" && ! -L "$overlay" ]] || { echo 'AUTH_SMTP=BLOCKED_UNSAFE_EXISTING_OVERLAY';exit 1; }
 stale="/home/ubuntu/neis-backups/ovh-brevo-auth-smtp-stale-$(date +%Y%m%d%H%M%S).yml"
 cp -- "$overlay" "$stale";chmod 600 "$stale"
 echo 'AUTH_SMTP=PREVIOUS_PRIVATE_OVERLAY_BACKED_UP'
fi
mv -f "$tmp/override.yml" "$overlay"
chmod 600 "$overlay"

if ! activate up -d --no-deps --force-recreate auth >"$tmp/activate.log" 2>&1; then
 echo 'AUTH_SMTP=FAILED_RECREATE';rollback;exit 1
fi

# Wait for the live GoTrue container to run with the exact verified settings
# and for its public health route to answer successfully.
if ! python3 - "$overlay" <<'PY'
import json,subprocess,sys,time,urllib.request,urllib.error
path=sys.argv[1]
docker=['sudo','-n','/usr/bin/docker']
expected_cmd=docker+['compose']
for f in ('docker-compose.yml','docker-compose.security.yml','docker-compose.caddy.yml',
          'docker-compose.edge-integrations.yml',path):
 expected_cmd+=['-f',f]
cfg=subprocess.run([*expected_cmd,'config','--format','json'],capture_output=True,text=True,timeout=40)
if cfg.returncode:
 print('AUTH_SMTP_RUNTIME=COMPOSE_INVALID');sys.exit(1)
expected=json.loads(cfg.stdout)['services']['auth']['environment']
matched=False
health=False
for attempt in range(36):
 inspect=subprocess.run([*docker,'inspect','--format','{{json .}}','supabase-auth'],
                         capture_output=True,text=True,timeout=20)
 if inspect.returncode==0:
  try:
   obj=json.loads(inspect.stdout)
   live=dict(x.split('=',1) for x in obj['Config'].get('Env',[]) if '=' in x)
   matched=(obj['State'].get('Running') is True and
      all(live.get(k)==str(expected.get(k,'')) for k in
       ('GOTRUE_SMTP_HOST','GOTRUE_SMTP_PORT','GOTRUE_SMTP_USER','GOTRUE_SMTP_PASS')) and
      bool(live.get('GOTRUE_SMTP_ADMIN_EMAIL')) and bool(live.get('GOTRUE_SMTP_SENDER_NAME')))
  except Exception:matched=False
 if matched:
  try:
   req=urllib.request.Request('https://supabase.neiscircle.site/auth/v1/health',
                              headers={'Cache-Control':'no-cache'})
   with urllib.request.urlopen(req,timeout=8) as response:
    health=response.status==200
  except Exception:health=False
  if health:break
 time.sleep(2)
if not matched:
 print('AUTH_SMTP_RUNTIME=LIVE_ENVIRONMENT_MISMATCH');sys.exit(1)
print('AUTH_SMTP_RUNTIME=CONFIG_MATCHES')
if not health:
 print('AUTH_SMTP_RUNTIME=HEALTH_FAILED');sys.exit(1)
print('AUTH_SMTP_RUNTIME=LIVE_AUTH_HEALTH_PASS')
print('AUTH_SMTP_MESSAGES_SENT=0')
PY
then
 rollback
 exit 1
fi

echo 'AUTH_SMTP=PASS_BREVO_TLS_AUTH_AND_LIVE_AUTH_HEALTH'
echo 'AUTH_SMTP_HOST=smtp-relay.brevo.com'
echo 'AUTH_SMTP_PORT=587'
echo 'AUTH_SMTP_SENDER_IDENTITY=PRESERVED'
echo 'AUTH_SMTP_MESSAGES_SENT=0'
echo 'AUTH_SMTP_OTHER_SERVICES=UNCHANGED'
