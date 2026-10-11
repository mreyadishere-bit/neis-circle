#!/usr/bin/env bash
# Independent monitor: never touches NEIS web, Supabase containers, DB data or Caddy routing.
set -Eeuo pipefail
umask 077
[[ "$(id -un)" == ubuntu ]] || { echo 'MONITOR_INSTALL=BLOCKED_WRONG_USER'; exit 1; }
STAGE=/home/ubuntu/neis-private-monitor-20261011.py
STAGE_UNIT=/home/ubuntu/neis-private-monitor-20261011.service
DEST_DIR=/home/ubuntu/.local/share/neis-private-monitor
DEST="$DEST_DIR/monitor.py"
UNIT=/etc/systemd/system/neis-private-monitor.service
mkdir -p "$DEST_DIR"
chmod 700 "$DEST_DIR"
test -s "$STAGE" && test -s "$STAGE_UNIT" || { echo 'MONITOR_INSTALL=BLOCKED_NO_STAGING';exit 1; }
python3 -m py_compile "$STAGE"
grep -q '^HOST = "127.0.0.1"$' "$STAGE" || { echo 'MONITOR_INSTALL=BLOCKED_NON_LOCAL_BIND';exit 1; }
grep -q 'PORT = 8765' "$STAGE" || { echo 'MONITOR_INSTALL=BLOCKED_PORT';exit 1; }
# Must not collide with an unrelated listener.
if curl -fsS --max-time 2 http://127.0.0.1:8765/health >/tmp/neis-mon-health-check.$$ 2>/dev/null; then
  grep -Fq '"service":"neis-private-monitor"' /tmp/neis-mon-health-check.$$ || { rm -f /tmp/neis-mon-health-check.$$; echo 'MONITOR_INSTALL=BLOCKED_PORT_OCCUPIED';exit 1; }
fi
rm -f /tmp/neis-mon-health-check.$$
if [[ -f "$DEST" ]];then
  cp -p "$DEST" "$DEST.previous.py"
fi
install -m 600 "$STAGE" "$DEST.new"
mv -f "$DEST.new" "$DEST"
# Prefer persistent, sandboxed systemd service when passwordless sudo allows it.
if sudo -n /usr/bin/install -m 644 "$STAGE_UNIT" "$UNIT" >/dev/null 2>&1 && sudo -n /usr/bin/systemctl daemon-reload >/dev/null 2>&1 && sudo -n /usr/bin/systemctl enable --now neis-private-monitor.service >/dev/null 2>&1;then
  sudo -n /usr/bin/systemctl restart neis-private-monitor.service >/dev/null
  echo 'MONITOR_PERSISTENCE=SYSTEMD'
else
  # Some OVH users only have sudo permission for Docker; no privileged fallback.
  if ! command -v crontab >/dev/null 2>&1;then
    echo 'MONITOR_INSTALL=BLOCKED_NO_SERVICE_MANAGER'
    exit 1
  fi
  crontab -l 2>/dev/null | grep -vF '# NEIS_PRIVATE_MONITOR_V1' > "$DEST_DIR/crontab.prev" || true
  { cat "$DEST_DIR/crontab.prev"; echo "@reboot /usr/bin/python3 -B $DEST >/dev/null 2>&1 # NEIS_PRIVATE_MONITOR_V1"; } | crontab -
  # Only stop our own previous process (never kill a process by port).
  pgrep -f "^/usr/bin/python3 -B $DEST$" | while read -r pid;do kill "$pid" 2>/dev/null || true;done || true
  nohup /usr/bin/python3 -B "$DEST" </dev/null >/dev/null 2>&1 &
  echo 'MONITOR_PERSISTENCE=CRON'
fi
ready=no
for i in $(seq 1 20);do
  if curl -fsS --max-time 2 http://127.0.0.1:8765/health 2>/dev/null | grep -Fq '"service":"neis-private-monitor"';then ready=yes;break;fi
  sleep 1
done
[[ "$ready" == yes ]] || { echo 'MONITOR_INSTALL=FAILED_HEALTH_CHECK';exit 1; }
# Loopback-only check: no process bound to 0.0.0.0/:: on private dashboard port.
if command -v ss >/dev/null 2>&1;then
  if ss -H -lnt | awk '$4 ~ /:8765$/ {print $4}' | grep -qvE '^(127\.0\.0\.1|localhost):8765$';then
    echo 'MONITOR_INSTALL=BLOCKED_PUBLIC_BIND'
    exit 1
  fi
fi
rm -f "$STAGE" "$STAGE_UNIT"
echo 'MONITOR_INSTALL=SUCCESS'
echo 'MONITOR_ENDPOINT=127.0.0.1:8765_ONLY'
echo 'MONITOR_CONTAINS_USER_OR_AUTH_RECORDS=NO'
echo 'NEIS_WEB_SUPABASE_CADDY=UNCHANGED'
