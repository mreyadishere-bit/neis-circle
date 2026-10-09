#!/usr/bin/env bash
# Prepare Edge function code in a separate, non-mounted staging directory.
set -Eeuo pipefail
SRC=/home/ubuntu/neis-backups/edge-functions-initial
DST=/home/ubuntu/neis-backups/edge-functions-ready-20261009
test -d "$SRC/supabase/functions"
test -r "$SRC/functions-SHA256SUMS"
(cd "$SRC" && sha256sum -c functions-SHA256SUMS >/dev/null)
if test -e "$DST"; then
  echo 'FUNCTION_STAGING_DESTINATION=ALREADY_EXISTS'
  (cd "$DST" && sha256sum -c functions-SHA256SUMS >/dev/null) || { echo 'BLOCKED: prior staged source mismatch'; exit 1; }
else
  stage="$(mktemp -d /home/ubuntu/neis-backups/.edge-prep-XXXXXX)"
  trap 'rm -rf -- "$stage"' EXIT
  install -d -m 700 "$stage/supabase"
  cp -a "$SRC/supabase/functions" "$stage/supabase/functions"
  cp "$SRC/functions-SHA256SUMS" "$stage/functions-SHA256SUMS"
  (cd "$stage" && sha256sum -c functions-SHA256SUMS >/dev/null)
  mv -- "$stage" "$DST"
  trap - EXIT
  echo 'FUNCTION_STAGING_DESTINATION=CREATED'
fi
count="$(find "$DST/supabase/functions" -mindepth 2 -maxdepth 2 -type f -name index.ts | wc -l)"
test "$count" -eq 8
echo "EDGE_FUNCTIONS_STAGED_AND_SHA256_VERIFIED=$count"
echo 'RUNNING_EDGE_MOUNT=UNCHANGED'
