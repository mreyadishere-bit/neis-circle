#!/usr/bin/env bash
set -Eeuo pipefail
# Static audit of isolated release source only; no imports executed and no secret values emitted.
python3 - <<'PY'
from pathlib import Path
import re,sys,hashlib
root=Path('/home/ubuntu/neis-backups/edge-release-candidate-20261009/functions')
expected={'brevo-email-capacity','brevo-quota-diagnostic','email-signup-validate','refresh-web-push-subscription','send-mobile-push','send-notification-email','send-web-push','study-livekit-token'}
found={p.name for p in root.iterdir() if p.is_dir()} if root.is_dir() else set()
if found!=expected:
 print('EDGE_SOURCE_AUDIT=BLOCKED_FUNCTION_SET');sys.exit(1)
bad=0
for name in sorted(expected):
 p=root/name/'index.ts'
 if not p.is_file() or p.stat().st_size==0:
  print('ENTRY_'+name+'=MISSING');bad+=1;continue
 t=p.read_text(encoding='utf-8')
 # Most standalone Supabase Edge entrypoints register a Deno.serve handler.
 has_handler=bool(re.search(r'(?:Deno\\.serve|serve\\s*\\()',t))
 print('ENTRY_'+name+'='+('HANDLER_DETECTED' if has_handler else 'REVIEW_REQUIRED'))
 if not has_handler:bad+=1
print('EDGE_ENTRYPOINT_REVIEW_REQUIRED='+str(bad))
print('EDGE_SOURCE_AUDIT='+('PASS' if not bad else 'NEEDS_REVIEW'))
sys.exit(1 if bad else 0)
PY
