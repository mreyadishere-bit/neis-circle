# OVH Edge deployment and cutover readiness

Status: NOT READY for production cutover. Non-destructive runbook.

## Confirmed on 2026-10-09
- Eight Edge Functions staged with verified SHA-256; live Edge mount unchanged.
- Only 4 of 13 referenced environment variable names are present in the running Edge container.
- Missing: BREVO_API_KEY, EMAIL_WORKER_SECRET, FIREBASE_SERVICE_ACCOUNT_JSON, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL, NOTIFICATION_FROM_EMAIL, NOTIFICATION_FROM_NAME, SITE_URL.
- Present by name only (values unverified): SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_PUBLISHABLE_KEYS, SUPABASE_SERVICE_ROLE_KEY.
- Historical snapshot is restored in staging, not current OVH production; current site uses Supabase Cloud.

## Secure secrets setup
1. Obtain missing settings from service owners using a private secret manager or restrictive server-owned env file. NEVER commit or paste secret values in GitHub issues, pull requests, workflows or action logs.
2. Verify the four Supabase variables refer to intended OVH deployment; Cloud secrets might not authenticate against OVH. Do not replace the working Cloud values in the live site.
3. Check that Firebase JSON parses; LiveKit URL, API key and secret belong to the same server; sender email is verified; SITE_URL matches approved public origin.
4. Inject values into the Edge Compose service securely; ensure correct file permissions. Be aware that docker inspect and docker compose config can reveal secret values in output; do not publish either output.
5. Preserve existing mounts and data. Before changing running containers, take a verified backup and have rollback steps. Restart only the intended service during a planned deployment.
6. Audit function routes, authorization, failure handling and non-production recipients. A missing optional service should be explicitly disabled, not configured with fake secrets.

## Tests required BEFORE cutover
- [ ] Eight functions respond at their expected routes and reject unauthorized requests.
- [ ] Brevo sends only to designated test recipients; no bulk email or queued campaign.
- [ ] Firebase push reaches consenting test devices and respects device-specific notification settings.
- [ ] LiveKit meeting token issuance, permission enforcement and token expiry pass.
- [ ] Storage object metadata AND actual object bytes verified for access and integrity.
- [ ] Realtime works on DMs, circle chat, posts, notifications, polls and timetable with RLS enforced.
- [ ] Fresh consistent backup of Cloud database/Auth, storage metadata and object bytes taken and verified with checksums.
- [ ] Fresh snapshot first restored to isolated OVH staging; compare counts, RLS, triggers, extensions, roles and user ownership.
- [ ] Two-account, two-device tests for sign-in persistence, profile, circle role persistence, chat, notifications and files pass.
- [ ] Write-freeze or catch-up plan confirmed for updates arriving between snapshot and cutover.
- [ ] Rollback for frontend endpoint, DNS, and infrastructure rehearsed while preserving Cloud production.
- [ ] Explicit go/no-go approval, monitoring and rollback thresholds established.

Never overwrite current production with the historical staging snapshot. Never perform DNS/frontend endpoint cutover based only on variable presence.
