#!/usr/bin/env bash
set -Eeuo pipefail
# Mutate only isolated Storage release candidate ownership and modes.
# No source, active Storage mount, production DB or DNS changes.
cd /home/ubuntu/neis-supabase
docker() { sudo -n /usr/bin/docker "$@"; }
candidate=/home/ubuntu/neis-backups/storage-runtime-release-20261010/files
[[ -d "$candidate" && ! -L "$candidate" ]] || { echo 'STORAGE_PERMISSION_FIX=BLOCKED_CANDIDATE';exit 1; }
[[ "$(readlink -f "$candidate")" == "$candidate" ]] || { echo 'STORAGE_PERMISSION_FIX=BLOCKED_CANONICAL_PATH';exit 1; }
[[ -z "$(sudo -n find "$candidate" -type l -print -quit)" ]] || { echo 'STORAGE_PERMISSION_FIX=BLOCKED_SYMLINK';exit 1; }
physical="$(sudo -n find "$candidate" -type f | wc -l | tr -d ' ')"
[[ "$physical" == 104 ]] || { echo 'STORAGE_PERMISSION_FIX=BLOCKED_SOURCE_COUNT';exit 1; }
id="$(docker compose -f docker-compose.yml -f docker-compose.security.yml -f docker-compose.caddy.yml ps -q storage)"
[[ -n "$id" && "$(docker inspect -f '{{.State.Running}}' "$id")" == true ]] || { echo 'STORAGE_PERMISSION_FIX=BLOCKED_LIVE_SERVICE';exit 1; }
image="$(docker inspect -f '{{.Config.Image}}' "$id")"
user="$(docker inspect -f '{{.Config.User}}' "$id")"
[[ -n "$user" ]] || user=0
get_identity() {
 docker run --rm --network none --pull never --read-only --cap-drop ALL \
 --security-opt no-new-privileges --pids-limit 50 --user "$user" \
 --entrypoint /bin/sh "$image" -c 'id -u; id -g' 2>/dev/null
}
identity="$(get_identity)" || { echo 'STORAGE_PERMISSION_FIX=BLOCKED_IMAGE_USER';exit 1; }
uid="$(printf '%s\n' "$identity" | sed -n '1p')"
gid="$(printf '%s\n' "$identity" | sed -n '2p')"
[[ "$uid" =~ ^[0-9]+$ && "$gid" =~ ^[0-9]+$ ]] || { echo 'STORAGE_PERMISSION_FIX=BLOCKED_UID_GID';exit 1; }
# Restrict to a known exact candidate subtree; ensure the service account can read.
sudo -n chown -R "$uid:$gid" "$candidate"
sudo -n find "$candidate" -type d -exec chmod 0700 {} +
sudo -n find "$candidate" -type f -exec chmod 0600 {} +
count="$(docker run --rm --network none --pull never --read-only --cap-drop ALL \
 --security-opt no-new-privileges --pids-limit 50 --user "$user" \
 -v "$candidate:/var/lib/storage:ro" --entrypoint /bin/sh "$image" \
 -c 'find /var/lib/storage -type f -readable | wc -l' 2>/dev/null)" || { echo 'STORAGE_PERMISSION_FIX=FAILED_EPHEMERAL_READ';exit 1; }
[[ "$count" =~ ^[0-9]+$ ]] || { echo 'STORAGE_PERMISSION_FIX=FAILED_COUNT_FORMAT';exit 1; }
echo "STORAGE_RUNTIME_READABLE_OBJECTS=$count"
[[ "$count" == 104 ]] || { echo 'STORAGE_PERMISSION_FIX=FAILED_ACCESS_VERIFICATION';exit 1; }
[[ "$(docker inspect -f '{{.State.Running}}' "$id")" == true ]] || { echo 'STORAGE_PERMISSION_FIX=BLOCKED_LIVE_RUNTIME_CHANGED';exit 1; }
echo 'STORAGE_PERMISSION_FIX=PASS_CANDIDATE_ONLY'
echo 'STORAGE_ACTIVE_MOUNT=UNCHANGED'
echo 'DATABASE_AND_CLOUD=UNCHANGED'
