#!/usr/bin/env bash
# Remove only the managed NEIS retry cron line, leaving unrelated scheduled jobs untouched.
set -Eeuo pipefail
marker='# NEIS_WEBPUSH_RETRY_V1'
previous="$(crontab -l 2>/dev/null || true)"
if [[ "$previous" != *"$marker"* ]];then
 echo 'WEBPUSH_CRON_ROLLBACK=NOT_INSTALLED'
 exit 0
fi
printf '%s\n' "$previous" | awk -v marker="$marker" 'index($0,marker)==0' | crontab -
if crontab -l | grep -Fq "$marker";then
 echo 'WEBPUSH_CRON_ROLLBACK=FAILED'
 exit 1
fi
echo 'WEBPUSH_CRON_ROLLBACK=REMOVED_MANAGED_JOB_ONLY'
