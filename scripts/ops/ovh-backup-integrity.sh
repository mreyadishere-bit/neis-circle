#!/usr/bin/env bash
# Local backup bytes and source-code integrity only. Does not publish file contents.
set -Eeuo pipefail
storage=/home/ubuntu/neis-backups/storage-20261009T133940Z
edge=/home/ubuntu/neis-backups/edge-functions-initial
db=/home/ubuntu/neis-backups/cloud-20261009T130848Z
test -d "$storage/files"
test -d "$edge/supabase/functions"
test -f "$storage/files-SHA256SUMS"
test -f "$edge/functions-SHA256SUMS"
test -f "$db/SHA256SUMS"
files="$(find "$storage/files" -type f | wc -l)"
funcs="$(find "$edge/supabase/functions" -name index.ts -type f | wc -l)"
echo "STORAGE_BACKUP_FILES=$files"
echo "EDGE_FUNCTIONS_WITH_INDEX_TS=$funcs"
[[ "$files" == 103 && "$funcs" == 8 ]] || { echo 'INVENTORY_MISMATCH'; exit 1; }
echo '=== Checking DB file digests ==='
(cd "$db" && sha256sum -c SHA256SUMS | grep -E ': OK$' | wc -l)
echo '=== Checking Storage file digests ==='
(cd "$storage/files" && sha256sum -c ../files-SHA256SUMS | grep -E ': OK$' | wc -l)
echo '=== Checking Edge Function file digests ==='
(cd "$edge" && sha256sum -c functions-SHA256SUMS | grep -E ': OK$' | wc -l)
echo 'BACKUP_INTEGRITY=PASSED'
