#!/usr/bin/env bash
set -Eeuo pipefail
# Create an isolated verified release. NEVER touch active Docker mounts or production DB.
python3 - <<'PY'
from pathlib import Path
import shutil,hashlib,os,sys
base=Path('/home/ubuntu/neis-backups')
source=base/'edge-functions-ready-20261009'/'supabase'/'functions'
target=base/'edge-release-candidate-20261009'/'functions'
names={'brevo-email-capacity','brevo-quota-diagnostic','email-signup-validate','refresh-web-push-subscription','send-mobile-push','send-notification-email','send-web-push','study-livekit-token'}
actual={p.parent.name for p in source.glob('*/index.ts')}
if actual!=names:print('RELEASE=BLOCKED_SOURCE_SET');sys.exit(1)
if target.exists():
 print('RELEASE_CANDIDATE=EXISTING_NO_OVERWRITE')
else:
 target.parent.mkdir(parents=True,exist_ok=True)
 target.mkdir(mode=0o700)
 for fn in sorted(names):
  shutil.copytree(source/fn,target/fn,symlinks=False)
 print('RELEASE_CANDIDATE=CREATED')
mismatch=0
for fn in sorted(names):
 original=source/fn
 deployed=target/fn
 def fingerprint(root):
  return {p.relative_to(root).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in root.rglob('*') if p.is_file()}
 if fingerprint(original)!=fingerprint(deployed): mismatch+=1
print('RELEASE_FUNCTIONS='+str(len(names)))
print('RELEASE_HASH_MISMATCHES='+str(mismatch))
print('RELEASE_ACTIVE_MOUNT=UNCHANGED')
print('RELEASE_STATUS='+('VERIFIED' if mismatch==0 else 'BLOCKED_MISMATCH'))
sys.exit(1 if mismatch else 0)
PY
