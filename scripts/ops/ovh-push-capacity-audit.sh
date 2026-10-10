#!/usr/bin/env bash
set -Eeuo pipefail
cd /home/ubuntu/neis-supabase
DC=(sudo -n /usr/bin/docker compose -f docker-compose.yml -f docker-compose.security.yml -f docker-compose.caddy.yml)
echo "SERVER_CPU_THREADS=$(nproc)"
awk '/MemTotal:/ {printf "SERVER_RAM_GIB=%.2f\n",$2/1048576} /MemAvailable:/ {printf "SERVER_RAM_AVAILABLE_GIB=%.2f\n",$2/1048576}' /proc/meminfo
awk '/SwapTotal:/ {printf "SERVER_SWAP_GIB=%.2f\n",$2/1048576}' /proc/meminfo
df -B1 / | awk 'NR==2 {printf "SERVER_DISK_TOTAL_GIB=%.2f\nSERVER_DISK_USED_GIB=%.2f\nSERVER_DISK_FREE_GIB=%.2f\n",$2/1073741824,$3/1073741824,$4/1073741824}'
echo "SERVER_LOAD_AVG=$(cut -d ' ' -f1-3 /proc/loadavg)"
echo "=== Docker resource summary without environment or secrets ==="
sudo -n /usr/bin/docker stats --no-stream --format '{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}' | grep -E '^supabase-|^neis-' | head -25
echo "=== Database size and push health ==="
"${DC[@]}" exec -T db psql -X -U postgres -d postgres -Atqc "
SELECT 'DB_SIZE_BYTES='||pg_database_size(current_database())
UNION ALL SELECT 'PUSH_SUBSCRIPTION_COUNT='||count(*) FROM public.web_push_subscriptions
UNION ALL SELECT 'PUSH_ACTIVE_SUBSCRIPTIONS='||count(*) FROM public.web_push_subscriptions WHERE enabled=true
UNION ALL SELECT 'PUSH_OUTBOX_PENDING='||count(*) FROM public.web_push_outbox WHERE status IN ('pending','failed')
UNION ALL SELECT 'PUSH_RPC_'||proname||'=EXISTS' FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND proname IN ('register_web_push_subscription','get_web_push_subscription_status','get_web_push_vapid_keys')
ORDER BY 1;" </dev/null
echo 'PRIVATE_VALUES_LOGGED=NO'
