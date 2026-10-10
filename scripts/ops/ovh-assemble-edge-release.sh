#!/usr/bin/env bash
set -Eeuo pipefail
# Build a new immutable release tree; DO NOT touch the active Edge mount.
python3 - <<'PY'
from pathlib import Path
import json,hashlib,os,shutil,subprocess,sys
base=Path('/home/ubuntu/neis-backups')
staged=base/'edge-release-candidate-20261009'/'functions'
reference=base/'edge-functions-ready-20261009'/'supabase'/'functions'
dest=base/'edge-runtime-release-20261010'/'functions'
names={'brevo-email-capacity','brevo-quota-diagnostic','email-signup-validate','refresh-web-push-subscription','send-mobile-push','send-notification-email','send-web-push','study-livekit-token'}
response=subprocess.run(['sudo','-n','/usr/bin/docker','inspect','--format','{{json .}}','supabase-edge-functions'],capture_output=True,text=True,timeout=20)
if response.returncode:print('EDGE_RELEASE=BLOCKED_INSPECT');sys.exit(1)
try:info=json.loads(response.stdout)
except ValueError:print('EDGE_RELEASE=BLOCKED_PARSE');sys.exit(1)
if info.get('State',{}).get('Running') is not True:
 print('EDGE_RELEASE=BLOCKED_RUNTIME_NOT_RUNNING');sys.exit(1)
volumes=[x.get('Source','') for x in info.get('Mounts',[]) if x.get('Destination')=='/home/deno/functions']
if len(volumes)!=1:
 print('EDGE_RELEASE=BLOCKED_MOUNT');sys.exit(1)
active=Path(volumes[0]).resolve()
if not (active/'main'/'index.ts').is_file():
 print('EDGE_RELEASE=BLOCKED_MAIN_ROUTER_ABSENT');sys.exit(1)
if not staged.is_dir() or not reference.is_dir() or dest.exists():
 print('EDGE_RELEASE=BLOCKED_INPUT_OR_EXISTING_RELEASE');sys.exit(1)
for tree in (active,staged,reference):
 if any(x.is_symlink() for x in tree.rglob('*')):
  print('EDGE_RELEASE=BLOCKED_SYMLINK');sys.exit(1)
def sha_tree(path):
 return {x.relative_to(path).as_posix():hashlib.sha256(x.read_bytes()).hexdigest() for x in path.rglob('*') if x.is_file()}
actual={x.parent.name for x in staged.glob('*/index.ts')}
if actual!=names or {x.parent.name for x in reference.glob('*/index.ts')}!=names:
 print('EDGE_RELEASE=BLOCKED_FUNCTION_SET');sys.exit(1)
for name in names:
 if sha_tree(staged/name)!=sha_tree(reference/name):
  print('EDGE_RELEASE=BLOCKED_UNVERIFIED_CODE');sys.exit(1)
dest.parent.mkdir(mode=0o700,parents=True,exist_ok=False)
try:
 shutil.copytree(active,dest,symlinks=False)
 router_fingerprint=sha_tree(active/'main')
 for name in sorted(names):
  path=dest/name
  if path.exists():shutil.rmtree(path)
  shutil.copytree(staged/name,path,symlinks=False)
 for name in names:
  if sha_tree(dest/name)!=sha_tree(staged/name):
   raise ValueError('copy integrity')
 if sha_tree(dest/'main')!=router_fingerprint:
  raise ValueError('router integrity')
 # All files are code-only; release mount will be read-only.
 for path in dest.rglob('*'):
  os.chmod(path,0o755 if path.is_dir() else 0o644)
 os.chmod(dest,0o755)
except Exception:
 shutil.rmtree(dest.parent,ignore_errors=True)
 print('EDGE_RELEASE=FAILED_PRIVATE_STAGING');sys.exit(1)
print('EDGE_RELEASE_MAIN_ROUTER=PRESERVED')
print('EDGE_RELEASE_NEW_FUNCTIONS_VERIFIED='+str(len(names)))
print('EDGE_RELEASE_ALL_HANDLER_DIRS='+str(sum(1 for x in dest.glob('*/index.ts'))))
print('EDGE_RELEASE_CANDIDATE=READY_READ_ONLY')
print('EDGE_ACTIVE_MOUNT=UNCHANGED')
print('EDGE_SECRET_VALUES_LOGGED=NO')
PY
