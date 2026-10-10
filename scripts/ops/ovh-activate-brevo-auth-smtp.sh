#!/usr/bin/env bash
set -Eeuo pipefail
# Accept private Brevo SMTP Login/Key on OVH. Validate TLS+AUTH BEFORE changing Auth.
# Recreate ONLY auth container, preserve full previous config for rollback. No messages.
cd /home/ubuntu/neis-supabase
bundle=/home/ubuntu/neis-backups/ovh-brevo-smtp-private-20261010.json
overlay=docker-compose.auth-smtp-brevo.yml
tmp="$(mktemp -d)"
chmod 700 "$tmp"
trap 'rm -rf "$tmp"; rm -f "$bundle"' EXIT
[[ -f "$bundle" && ! -L "$bundle" && "$(stat -c '%a' "$bundle")" == 600 ]] || { echo 'AUTH_SMTP=BLOCKED_PRIVATE_BUNDLE';exit 1; }
[[ ! -e "$overlay" ]] || { echo 'AUTH_SMTP=BLOCKED_EXISTING_OVERLAY_REVIEW_REQUIRED';exit 1; }
# Credentials are never logged, even in compose or SMTP diagnostics.
if ! python3 - "$bundle" "$tmp/override.yml" <<'PY'
import json,subprocess,smtplib,ssl,sys,re
from pathlib import Path
bundle=Path(sys.argv[1]);out=Path(sys.argv[2])
try:
 config=json.loads(bundle.read_text())
 assert set(config)=={'BREVO_SMTP_LOGIN','BREVO_SMTP_KEY'}
 user=config['BREVO_SMTP_LOGIN'];password=config['BREVO_SMTP_KEY']
 assert isinstance(user,str) and isinstance(password,str)
 assert 1<=len(user)<180 and 8<=len(password)<500 and all(ord(c)>=32 for c in user+password)
except Exception:
 print('AUTH_SMTP=BLOCKED_BUNDLE_FORMAT');sys.exit(1)
host='smtp-relay.brevo.com'
port=587
try:
 with smtplib.SMTP(host,port,timeout=16) as smtp:
  smtp.ehlo()
  if not smtp.has_extn('starttls'):raise RuntimeError('no tls')
  smtp.starttls(context=ssl.create_default_context())
  smtp.ehlo()
  smtp.login(user,password)
except smtplib.SMTPAuthenticationError:
 print('AUTH_SMTP=BLOCKED_BREVO_LOGIN_REJECTED');sys.exit(1)
except Exception:
 print('AUTH_SMTP=BLOCKED_BREVO_CONNECT_OR_TLS');sys.exit(1)
print('AUTH_SMTP_BREVO=TLS_AUTH_VERIFIED_WITHOUT_MAIL')
text='services:\n  auth:\n    environment:\n'
for name,value in (('GOTRUE_SMTP_HOST',host),('GOTRUE_SMTP_PORT','587'),('GOTRUE_SMTP_USER',user),('GOTRUE_SMTP_PASS',password)):
 text+='      '+name+': '+json.dumps(value.replace('$','$$'))+'\n'
out.write_text(text)
out.chmod(0o600)
# Compose config test; never print JSON or secrets.
cmd=['sudo','-n','/usr/bin/docker','compose']
for f in ('docker-compose.yml','docker-compose.security.yml','docker-compose.caddy.yml','docker-compose.edge-integrations.yml',str(out)):cmd+=['-f',f]
p=subprocess.run([*cmd,'config','--format','json'],capture_output=True,text=True,timeout=40)
if p.returncode:
 print('AUTH_SMTP=BLOCKED_COMPOSE_VALIDATION');sys.exit(1)
try:
 env=json.loads(p.stdout)['services']['auth']['environment']
 assert env['GOTRUE_SMTP_HOST']==host and str(env['GOTRUE_SMTP_PORT'])=='587'
 assert env['GOTRUE_SMTP_USER']==user and env['GOTRUE_SMTP_PASS']==password
except Exception:
 print('AUTH_SMTP=BLOCKED_CONFIG_NOT_MATCHING');sys.exit(1)
print('AUTH_SMTP_PRIVATE_OVERLAY=VALIDATED')
PY
then
 exit 1
fi
# No secrets in process command arguments; Compose reads mode-600 overlay locally.
chmod 600 "$tmp/override.yml"
mv "$tmp/override.yml" "$overlay"
compose() { sudo -n /usr/bin/docker compose -f docker-compose.yml -f docker-compose.security.yml -f docker-compose.caddy.yml -f docker-compose.edge-integrations.yml "$@"; }
activate() { sudo -n /usr/bin/docker compose -f docker-compose.yml -f docker-compose.security.yml -f docker-compose.caddy.yml -f docker-compose.edge-integrations.yml -f "$overlay" "$@"; }
rollback() {
 echo 'AUTH_SMTP=ROLLING_BACK_AUTH_ONLY'
 if compose up -d --no-deps --force-recreate auth >"$tmp/rollback.log" 2>&1; then
  echo 'AUTH_SMTP_ROLLBACK=SUCCESS'
 else
  echo 'AUTH_SMTP_ROLLBACK=FAILED_MANUAL_REVIEW_REQUIRED'
 fi
}
if ! activate up -d --no-deps --force-recreate auth >"$tmp/activate.log" 2>&1; then
 echo 'AUTH_SMTP=FAILED_RECREATE';rollback;exit 1
fi
if ! python3 - "$overlay" <<'PY'
from pathlib import Path
import json,subprocess,sys,urllib.request,urllib.error,time
p=Path(sys.argv[1]);text=p.read_text()
# Read overlay as validated private config by Compose, do not echo it.
cmd=['sudo','-n','/usr/bin/docker']
live=subprocess.run([*cmd,'inspect','--format','{{json .}}','supabase-auth'],capture_output=True,text=True,timeout=25)
if live.returncode:
 print('AUTH_SMTP_RUNTIME=INSPECT_FAILED');sys.exit(1)
try:
 obj=json.loads(live.stdout)
 assert obj['State']['Running']
 env=dict(x.split('=',1) for x in obj['Config']['Env'] if '=' in x)
 assert env['GOTRUE_SMTP_HOST']=='smtp-relay.brevo.com' and env['GOTRUE_SMTP_PORT']=='587'
 # Compare username/password against private Compose resolved values without printing.
 base=[*cmd,'compose']
 for f in ('docker-compose.yml','docker-compose.security.yml','docker-compose.caddy.yml','docker-compose.edge-integrations.yml',str(p)):base+=['-f',f]
 cfg=subprocess.run([*base,'config','--format','json'],capture_output=True,text=True,timeout=35)
 assert cfg.returncode==0
 expected=json.loads(cfg.stdout)['services']['auth']['environment']
 assert all(env.get(k)==expected.get(k) for k in ('GOTRUE_SMTP_USER','GOTRUE_SMTP_PASS'))
except Exception:
 print('AUTH_SMTP_RUNTIME=ENV_MISMATCH');sys.exit(1)
for attempt in range(4):
 try:
  with urllib.request.urlopen('https://supabase.neiscircle.site/auth/v1/health',timeout=8) as resp:
   if resp.status==200:
    print('AUTH_SMTP_RUNTIME=LIVE_AUTH_HEALTH_PASS')
    print('AUTH_SMTP_MESSAGES_SENT=0')
    sys.exit(0)
 except Exception:
  time.sleep(2)
print('AUTH_SMTP_RUNTIME=AUTH_HEALTH_FAILED');sys.exit(1)
PY
then
 rollback
 exit 1
fi
echo 'AUTH_SMTP=PASS_SERVICE_ONLY'
echo 'CLOUD_DATABASE_AND_WEBSITE=UNCHANGED'
