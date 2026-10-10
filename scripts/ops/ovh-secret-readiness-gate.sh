#!/usr/bin/env bash
set -Eeuo pipefail
# GitHub secret presence only; never print or send secret values to OVH.
required=(FIREBASE_SERVICE_ACCOUNT_JSON LIVEKIT_URL LIVEKIT_API_KEY LIVEKIT_API_SECRET BREVO_API_KEY)
missing=0
for key in "${required[@]}"; do
  case "$key" in
    FIREBASE_SERVICE_ACCOUNT_JSON) value="${FIREBASE_SERVICE_ACCOUNT_JSON:-}" ;;
    LIVEKIT_URL) value="${LIVEKIT_URL:-}" ;;
    LIVEKIT_API_KEY) value="${LIVEKIT_API_KEY:-}" ;;
    LIVEKIT_API_SECRET) value="${LIVEKIT_API_SECRET:-}" ;;
    BREVO_API_KEY) value="${BREVO_API_KEY:-}" ;;
  esac
  if [ -n "$value" ]; then echo "GITHUB_SECRET_$key=PRESENT"; else echo "GITHUB_SECRET_$key=MISSING"; missing=$((missing+1)); fi
done
echo "GITHUB_SECRET_MISSING_COUNT=$missing"
test "$missing" = 0
