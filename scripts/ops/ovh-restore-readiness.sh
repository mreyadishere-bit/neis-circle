#!/usr/bin/env bash
# Read-only audit; deliberately does not print student records or secret values.
set -Eeuo pipefail
backup=/home/ubuntu/neis-backups/cloud-20261009T130848Z
storage=/home/ubuntu/neis-backups/storage-20261009T133940Z
functions=/home/ubuntu/neis-backups/edge-functions-initial
for path in "$backup/schema.sql" "$backup/data.sql" "$backup/SHA256SUMS" "$storage/files-SHA256SUMS" "$functions/functions-SHA256SUMS"; do
  test -r "$path" || { echo "MISSING: $(basename "$path")"; exit 1; }
done
echo "=== DB snapshot integrity ==="
(cd "$backup" && sha256sum -c SHA256SUMS)
echo "=== Backup data COPY counts (metadata only) ==="
BACKUP="$backup/data.sql" python3 - <<'PY'
import os
from pathlib import Path
targets={'"auth"."users"', '"auth"."identities"', '"public"."profiles"', '"storage"."objects"'}
counts={}
active=None
with Path(os.environ['BACKUP']).open(encoding='utf8') as f:
    for line in f:
        if line.startswith('COPY '):
            active=line.split()[1] if line.split()[1] in targets else None
            if active: counts[active]=0
        elif active and line.rstrip('\r\n') == r'\.':
            active=None
        elif active:
            counts[active]+=1
for table in sorted(targets):
    print(f'{table}: {counts.get(table, "MISSING")}')
assert set(counts)==targets, 'One or more critical tables missing'
PY
echo "=== Remote Storage backup count ==="
find "$storage/files" -type f | wc -l
echo "=== Edge code count ==="
find "$functions/supabase/functions" -type f | wc -l
echo "=== Isolated test database state ==="
sudo -n docker inspect --format '{{.Name}} {{.State.Status}} {{.HostConfig.NetworkMode}}' neis-restore-test
sudo -n docker exec neis-restore-test psql -U postgres -d neis_restore_test -Atc \
  "SELECT table_schema||':'||count(*) FROM information_schema.tables WHERE table_schema IN ('auth','storage','public','realtime') AND table_type='BASE TABLE' GROUP BY table_schema ORDER BY table_schema;"
echo "AUDIT COMPLETE: no restore or data mutation performed"
