#!/usr/bin/env bash
set -Eeuo pipefail
# Check candidate files with the actual Storage image/runtime user in a networkless container.
cd /home/ubuntu/neis-supabase
docker() { sudo -n /usr/bin/docker "$@"; }
candidate=/home/ubuntu/neis-backups/storage-runtime-release-20261010/files
[[ -d "$candidate" && ! -L "$candidate" ]] || { echo 'STORAGE_ACCESS=BLOCKED_CANDIDATE';exit 1; }
id="$(docker compose -f docker-compose.yml -f docker-compose.security.yml -f docker-compose.caddy.yml ps -q storage)"
[[ -n "$id" ]] || { echo 'STORAGE_ACCESS=BLOCKED_STORAGE_CONTAINER';exit 1; }
image="$(docker inspect -f '{{.Config.Image}}' "$id")"
user="$(docker inspect -f '{{.Config.User}}' "$id")"
running="$(docker inspect -f '{{.State.Running}}' "$id")"
[[ "$running" == true && -n "$image" ]] || { echo 'STORAGE_ACCESS=BLOCKED_RUNTIME';exit 1; }
docker image inspect "$image" >/dev/null 2>&1 || { echo 'STORAGE_ACCESS=BLOCKED_IMAGE_NOT_LOCAL';exit 1; }
[[ -n "$user" ]] || user=0
if ! report="$(docker run --rm --network none --pull never --read-only --cap-drop ALL \
 --security-opt no-new-privileges --pids-limit 50 --user "$user" \
 -v "$candidate:/var/lib/storage:ro" --entrypoint /bin/sh "$image" \
 -c "printf 'FILES='; find /var/lib/storage -type f -exec sh -c 'printf x' sh {} \; | wc -c; printf 'READABLE='; find /var/lib/storage -type f -exec sh -c 'test -r \"\$1\" && printf x' sh {} \; | wc -c" 2>/dev/null)";then
 echo 'STORAGE_ACCESS=FAILED_EPHEMERAL_CONTAINER';exit 1
fi
files="$(printf '%s\n' "$report" | sed -n 's/^FILES=[[:space:]]*//p' | tr -d ' ')"
count="$(printf '%s\n' "$report" | sed -n 's/^READABLE=[[:space:]]*//p' | tr -d ' ')"
[[ "$files" =~ ^[0-9]+$ && "$count" =~ ^[0-9]+$ ]] || { echo 'STORAGE_ACCESS=FAILED_COUNT_FORMAT';exit 1; }
echo "STORAGE_RUNTIME_DISCOVERED_OBJECTS=$files"
echo "STORAGE_RUNTIME_READABLE_OBJECTS=$count"
[[ "$files" == 104 && "$count" == 104 ]] || { echo 'STORAGE_ACCESS=FAILED_OBJECT_READABILITY';exit 1; }
[[ "$(docker inspect -f '{{.State.Running}}' "$id")" == true ]] || { echo 'STORAGE_ACCESS=BLOCKED_RUNTIME_CHANGED';exit 1; }
echo 'STORAGE_ACCESS=PASS_EPHEMERAL_SAME_IMAGE_USER'
echo 'STORAGE_ACTIVE_MOUNT=UNCHANGED'
echo 'OVH_DB_AND_CLOUD=UNCHANGED'
