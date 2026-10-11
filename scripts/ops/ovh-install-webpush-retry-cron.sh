#!/usr/bin/env bash
# Preserve the existing Ubuntu crontab. Retry jobs only with original VAPID configured.
set -Eeuo pipefail
umask 077
stage=/home/ubuntu/neis-backups
worker="$stage/ovh-webpush-retry-v1.py"
backup="$stage/crontab-before-neis-webpush-v1"
marker='# NEIS_WEBPUSH_RETRY_V1'
installed=0
test -s "$worker"
python3 -m py_compile "$worker"
test ! -e "$backup"
command -v crontab >/dev/null
flock_bin="$(command -v flock)"
test -n "$flock_bin"
if command -v systemctl >/dev/null;then
 if ! systemctl is-active --quiet cron && ! systemctl is-active --quiet crond;then
  echo 'WEBPUSH_CRON=BLOCKED_SERVICE_INACTIVE'
  exit 1
 fi
fi
had_crontab=0
if crontab -l > "$backup" 2>/dev/null;then had_crontab=1
else : > "$backup";fi
chmod 600 "$backup"
if grep -Fq "$marker" "$backup";then
 echo 'WEBPUSH_CRON=ALREADY_CONFIGURED'
 exit 0
fi
restore(){
 if [[ "$had_crontab" == 1 ]];then crontab "$backup"
 else crontab -r >/dev/null 2>&1 || true;fi
 echo 'WEBPUSH_CRON=ROLLED_BACK'
}
trap 'if [[ "$installed" != 1 ]];then restore;fi' EXIT
{
 cat "$backup"
 printf '\n* * * * * %s -n /tmp/neis-webpush-retry-v1.lock /usr/bin/python3 %s >/dev/null 2>&1 %s\n' "$flock_bin" "$worker" "$marker"
} | crontab -
test "$(crontab -l | grep -Fc "$marker")" == 1
python3 "$worker"
installed=1
echo 'WEBPUSH_CRON=INSTALLED_RATE_LIMITED'
echo 'WEBPUSH_CRON=WAITING_FOR_VAPID_IF_MISSING'
echo 'WEBPUSH_CRON=OTHER_CRONTAB_ENTRIES_PRESERVED'
