#!/usr/bin/env bash
# Strictly read-only verification of already saved backup files on OVH.
set -Eeuo pipefail
DB=/home/ubuntu/neis-backups/cloud-20261009T130848Z
ST=/home/ubuntu/neis-backups/storage-20261009T133940Z
FN=/home/ubuntu/neis-backups/edge-functions-initial
for folder in "$DB" "$ST" "$FN"; do
  test -d "$folder" || exit 1
done
echo '=== SQL backup SHA-256 ==='
(cd "$DB" && sha256sum -c SHA256SUMS)
echo '=== Storage backup file hashes ==='
test -r "$ST/files-SHA256SUMS"
STORAGE="$ST" python3 - <<'PY'
from pathlib import Path
import hashlib,os,re,sys
root=Path(os.environ['STORAGE'])
manifest=root/'files-SHA256SUMS'
lines=[x for x in manifest.read_text().splitlines() if x.strip()]
if len(lines)!=103: raise SystemExit('BLOCKED: expected 103 storage checksums')
verified=0
for line in lines:
    match=re.fullmatch(r'([a-fA-F0-9]{64})\s+\*?(.+)',line)
    if not match: raise SystemExit('BLOCKED: malformed storage checksum line')
    relative=Path(match.group(2))
    if relative.is_absolute() or '..' in relative.parts:
        raise SystemExit('BLOCKED: unsafe relative file path')
    candidate=root/relative
    if not candidate.is_file() and relative.parts[0]!='files':
        candidate=root/'files'/relative
    if not candidate.is_file(): raise SystemExit('BLOCKED: missing storage file')
    actual=hashlib.file_digest(candidate.open('rb'),'sha256').hexdigest()
    if actual.lower()!=match.group(1).lower(): raise SystemExit('BLOCKED: storage checksum mismatch')
    verified+=1
print('STORAGE_FILES_SHA256_VERIFIED='+str(verified))
PY
echo '=== Edge function code SHA-256 ==='
test -r "$FN/functions-SHA256SUMS"
(cd "$FN" && sha256sum -c functions-SHA256SUMS)
echo 'BACKUP_BYTES_INTEGRITY=PASSED'
