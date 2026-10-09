#!/usr/bin/env bash
set -Eeuo pipefail
# Read-only Deno Edge candidate import/config audit.
python3 - <<'PY'
from pathlib import Path
import re,sys
root=Path('/home/ubuntu/neis-backups/edge-release-candidate-20261009/functions')
names=['brevo-email-capacity','brevo-quota-diagnostic','email-signup-validate','refresh-web-push-subscription','send-mobile-push','send-notification-email','send-web-push','study-livekit-token']
problems=0
for name in names:
 base=root/name
 entry=base/'index.ts'
 if not entry.is_file():
  print('IMPORT_'+name+'=MISSING_ENTRY');problems+=1;continue
 source=entry.read_text()
 rels=re.findall(r'(?:from\s*|import\s*\(|import\s*)[\x22\x27](\.{1,2}/[^\x22\x27]+)[\x22\x27]',source)
 missing=[]
 for ref in rels:
  dest=(base/ref).resolve()
  if not dest.is_relative_to(root.resolve()) or not any(p.is_file() for p in (dest,Path(str(dest)+'.ts'),Path(str(dest)+'.js'),dest/'index.ts')):
   missing.append(ref)
 problems+=len(missing)
 print('IMPORT_'+name+'='+('VALID_LOCAL_REFERENCES' if not missing else 'MISSING_LOCAL_REFERENCES'))
 print('IMPORT_LOCAL_REFERENCES_'+name+'='+str(len(rels)))
print('EDGE_IMPORT_MISSING='+str(problems))
print('EDGE_IMPORT_AUDIT='+('PASS' if problems==0 else 'NEEDS_REVIEW'))
sys.exit(1 if problems else 0)
PY
