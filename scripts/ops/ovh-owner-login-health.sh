#!/usr/bin/env bash
set -Eeuo pipefail
cd /home/ubuntu/neis-supabase
# Admin account UUID already in first-party source as NEIS_ADMIN_ID; no identity values logged.
sudo -n /usr/bin/docker compose -f docker-compose.yml -f docker-compose.security.yml -f docker-compose.caddy.yml exec -T db psql -X -U postgres -d postgres -Atqc "
WITH self AS (SELECT * FROM auth.users WHERE id='25b556a3-ec6f-49e7-ac6c-1b09720e3bfd')
SELECT 'OWNER_AUTH_USER_PRESENT='||exists(SELECT 1 FROM self)::text
UNION ALL SELECT 'OWNER_EMAIL_CONFIRMED='||exists(SELECT 1 FROM self WHERE email_confirmed_at IS NOT NULL)::text
UNION ALL SELECT 'OWNER_NOT_DELETED='||exists(SELECT 1 FROM self WHERE deleted_at IS NULL)::text
UNION ALL SELECT 'OWNER_NOT_BANNED='||exists(SELECT 1 FROM self WHERE banned_until IS NULL OR banned_until<now())::text
UNION ALL SELECT 'OWNER_ROLE_AUTHENTICATED='||exists(SELECT 1 FROM self WHERE role='authenticated')::text
UNION ALL SELECT 'OWNER_GOOGLE_IDENTITY_PRESENT='||exists(SELECT 1 FROM auth.identities WHERE user_id='25b556a3-ec6f-49e7-ac6c-1b09720e3bfd' AND provider='google')::text
UNION ALL SELECT 'OWNER_PUBLIC_PROFILE_PRESENT='||exists(SELECT 1 FROM public.profiles WHERE id='25b556a3-ec6f-49e7-ac6c-1b09720e3bfd')::text
UNION ALL SELECT 'OWNER_OAUTH_SESSION_LAST_2H='||count(*) FROM auth.sessions WHERE user_id='25b556a3-ec6f-49e7-ac6c-1b09720e3bfd' AND created_at>now()-interval '2 hours'
UNION ALL SELECT 'OWNER_OAUTH_REFRESH_TOKENS_LAST_2H='||count(*) FROM auth.refresh_tokens WHERE user_id='25b556a3-ec6f-49e7-ac6c-1b09720e3bfd' AND created_at>now()-interval '2 hours'
UNION ALL SELECT 'OWNER_APP_METADATA_GOOGLE='||exists(SELECT 1 FROM self WHERE raw_app_meta_data->>'provider'='google')::text
ORDER BY 1;
" </dev/null
echo 'OWNER_AUTH_AUDIT=NO_IDENTIFIERS_OR_TOKENS_LOGGED'
