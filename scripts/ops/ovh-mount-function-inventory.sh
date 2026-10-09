#!/usr/bin/env bash
# Read-only inventory: Docker mount destinations and backed-up Edge function names.
set -Eeuo pipefail
cd /home/ubuntu/neis-supabase
for service in supabase-storage supabase-edge-functions; do
  echo "SERVICE=$service"
  sudo -n docker inspect "$service" --format '{{range .Mounts}}{{println .Destination}}{{end}}' | while IFS= read -r destination; do
    case "$destination" in
      /var/lib/storage|/home/deno/functions|/home/deno|/app/*|/storage|/supabase/functions)
        echo "KNOWN_MOUNT_DESTINATION=$destination" ;;
      *) echo 'OTHER_MOUNT_DESTINATION_PRESENT=TRUE' ;;
    esac
  done
done
for folder in /home/ubuntu/neis-backups/edge-functions-initial/supabase/functions /home/ubuntu/neis-supabase/volumes/functions; do
  test -d "$folder" || { echo 'FUNCTION_FOLDER_MISSING'; exit 1; }
  echo '=== Edge function file inventory ==='
  find "$folder" -maxdepth 2 -type f -name index.ts -printf '%h\n' | sed 's|.*/||' | sort
done
echo 'DOCKER_MOUNTS_FUNCTION_INVENTORY=READ_ONLY_COMPLETE'
