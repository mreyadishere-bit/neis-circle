#!/usr/bin/env bash
set -Eeuo pipefail
cd /home/ubuntu/neis-supabase
D=(sudo -n /usr/bin/docker compose -f docker-compose.yml -f docker-compose.security.yml -f docker-compose.caddy.yml)
sql="SELECT 'USERS='||count(*) FROM auth.users UNION ALL SELECT 'PROFILES='||count(*) FROM public.profiles UNION ALL SELECT 'POSTS='||count(*) FROM public.posts UNION ALL SELECT 'MESSAGES='||count(*) FROM public.messages UNION ALL SELECT 'CIRCLE_MESSAGES='||count(*) FROM public.circle_messages UNION ALL SELECT 'NOTIFICATIONS='||count(*) FROM public.notifications UNION ALL SELECT 'STORAGE_OBJECTS='||count(*) FROM storage.objects;"
echo '=== Post-import production counts ==='
"${D[@]}" exec -T db psql -X -U postgres -d postgres -Atqc "$sql" </dev/null
echo '=== Runtime containers ==='
for n in supabase-auth supabase-rest supabase-realtime supabase-storage supabase-edge-functions; do
 v="$(sudo -n /usr/bin/docker inspect -f '{{.State.Running}}' "$n" 2>/dev/null || true)"
 echo "CONTAINER_${n}=${v:-NOT_FOUND}"
done
echo '=== Compose Realtime service status ==='
for service in realtime functions auth rest storage; do
 id="$("${D[@]}" ps -q "$service" 2>/dev/null || true)"
 if [ -z "$id" ]; then echo "COMPOSE_${service}=NOT_FOUND"; continue; fi
 running="$(sudo -n /usr/bin/docker inspect -f '{{.State.Running}}' "$id")"
 echo "COMPOSE_${service}=${running}"
done
echo '=== Edge running integration presence ==='
python3 - <<'PY'
import json,subprocess
x=subprocess.run(['sudo','-n','/usr/bin/docker','inspect','supabase-edge-functions','--format','{{json .Config.Env}}'],capture_output=True,text=True)
if x.returncode:
 print('EDGE_RUNNING_ENV=UNKNOWN')
else:
 env=dict(y.split('=',1) for y in json.loads(x.stdout) if '=' in y)
 needed=['BREVO_API_KEY','FIREBASE_SERVICE_ACCOUNT_JSON','LIVEKIT_API_KEY','LIVEKIT_API_SECRET','LIVEKIT_URL']
 print('EDGE_RUNNING_INTEGRATIONS_PRESENT='+str(sum(bool(env.get(k)) for k in needed))+'/5')
PY
echo '=== Edge integration readiness, names only ==='
python3 - <<'PY'
from pathlib import Path
root=Path('/home/ubuntu/neis-supabase')
overlay=root/'docker-compose.edge-integrations.yml'
print('EDGE_OVERLAY='+('PRESENT' if overlay.is_file() else 'MISSING'))
candidate=Path('/home/ubuntu/neis-backups/storage-runtime-release-20261010/files')
print('STORAGE_RUNTIME_CANDIDATE='+('PRESENT' if candidate.is_dir() else 'MISSING'))
PY
echo 'POST_IMPORT_AUDIT=READ_ONLY'
