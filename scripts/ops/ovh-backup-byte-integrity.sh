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
from collections import Counter
import hashlib,os,re
root=Path(os.environ['STORAGE'])
manifest=root/'files-SHA256SUMS'
lines=[x for x in manifest.read_text().splitlines() if x.strip()]
if len(lines)!=103: raise SystemExit('BLOCKED: expected 103 storage hashes')
expected=[]
for line in lines:
    match=re.fullmatch(r'([a-fA-F0-9]{64})\s+\*?(.+)',line)
    if not match: raise SystemExit('BLOCKED: malformed storage checksum line')
    expected.append(match.group(1).lower())
files=list((root/'files').rglob('*'))
files=[p for p in files if p.is_file()]
if len(files)!=103: raise SystemExit('BLOCKED: expected 103 physical stored objects')
actual=[]
for path in files:
    with path.open('rb') as stream:
        actual.append(hashlib.file_digest(stream,'sha256').hexdigest())
# The inventory manifest may store cloud object paths with a different local prefix;
# compare SHA-256 multisets, not filenames. Keep path mapping audit separate.
if Counter(expected)!=Counter(actual): raise SystemExit('BLOCKED: backed-up object bytes mismatch SHA-256 manifest')
print('STORAGE_OBJECT_BYTE_HASHES_VERIFIED=103')
print('STORAGE_PATH_MAPPING_AUDIT=SEPARATE')
PY
echo '=== Edge function code SHA-256 ==='
test -r "$FN/functions-SHA256SUMS"
(cd "$FN" && sha256sum -c functions-SHA256SUMS)
echo 'BACKUP_BYTES_INTEGRITY=PASSED'
