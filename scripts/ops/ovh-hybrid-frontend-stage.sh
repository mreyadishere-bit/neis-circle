#!/usr/bin/env bash
set -Eeuo pipefail
# No effects. Confirms frontend remains configured to use the existing Cloud backend.
grep -q 'supabase' index.html || grep -q 'supabase' scripts/01-core.js
test -s index.html
test -s manifest.webmanifest
test -d assets
test -d scripts
test -d styles
echo 'STATIC_FRONTEND_INPUTS=PASS'
