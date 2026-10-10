#!/usr/bin/env bash
# Restore the original cloud VAPID private key via a one-time protected stdin.
# Never write its value to logs, Git, command arguments or temporary files.
set -Eeuo pipefail
set +x
umask 077
cd /home/ubuntu/neis-supabase
IFS= read -r vapid_private || true
if [[ ! "$vapid_private" =~ ^[A-Za-z0-9_-]{43}$ ]];then
  echo 'VAPID_RESTORE=BLOCKED_INVALID_PRIVATE_KEY_FORMAT'
  exit 1
fi
public="$(python3 - <<'PY'
from pathlib import Path
import re,subprocess
p=subprocess.run(['sudo','-n','/usr/bin/docker','exec','supabase-caddy','cat','/srv/neis-circle/scripts/pwa-install-v117.js'],capture_output=True,text=True,timeout=12)
if p.returncode:raise SystemExit(1)
m=re.search(r"VAPID_PUBLIC_KEY=['\"]([A-Za-z0-9_-]{85,90})['\"]",p.stdout)
if not m:raise SystemExit(1)
print(m.group(1))
PY
)"
if [[ ! "$public" =~ ^[A-Za-z0-9_-]{85,90}$ ]];then
 echo 'VAPID_RESTORE=BLOCKED_PUBLIC_KEY_MISSING'
 exit 1
fi
dc=(sudo -n /usr/bin/docker compose -f docker-compose.yml -f docker-compose.security.yml -f docker-compose.caddy.yml)
presence="$("${dc[@]}" exec -T db psql -X -U postgres -d postgres -Atqc "SELECT count(*) FROM vault.secrets WHERE name IN ('neis_web_push_vapid_public','neis_web_push_vapid_private');" </dev/null)"
if [[ "$presence" == 2 ]];then
 echo 'VAPID_RESTORE=ALREADY_EXISTS_VERIFYING'
elif [[ "$presence" == 0 ]];then
 errorlog="$(mktemp /home/ubuntu/neis-backups/vapid-restore-error.XXXXXXXX)"
 cleanup(){ rm -f "$errorlog"; unset vapid_private; }
 trap cleanup EXIT
 if ! {
   printf 'BEGIN;\n'
   printf "SELECT vault.create_secret('%s','neis_web_push_vapid_public','Original NEIS Circle Web Push VAPID public key');\n" "$public"
   printf "SELECT vault.create_secret('%s','neis_web_push_vapid_private','Original NEIS Circle Web Push VAPID private key');\n" "$vapid_private"
   printf 'COMMIT;\n'
 } | "${dc[@]}" exec -T db psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres >/dev/null 2>"$errorlog";then
  echo 'VAPID_RESTORE=DATABASE_WRITE_FAILED'
  exit 1
 fi
 echo 'VAPID_RESTORE=ORIGINAL_PAIR_IMPORTED'
else
 echo 'VAPID_RESTORE=BLOCKED_PARTIAL_EXISTING_VAULT'
 exit 1
fi
unset vapid_private
status="$("${dc[@]}" exec -T db psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -Atqc "SELECT CASE WHEN EXISTS (SELECT 1 FROM public.get_web_push_vapid_keys() WHERE public_key='$public' AND length(private_key)>30) THEN 'PASS' ELSE 'FAIL' END;" </dev/null)"
if [[ "$status" != PASS ]];then
 echo 'VAPID_RESTORE=POSTCHECK_FAILED'
 exit 1
fi
echo 'VAPID_RESTORE=ORIGINAL_VAPID_PAIR_VALID'
echo 'VAPID_RESTORE=NO_SUBSCRIPTION_OR_USER_DATA_CHANGED'
