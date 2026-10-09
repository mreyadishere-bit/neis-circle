# NEIS Circle — Self-hosted Supabase migration (staged, no production cutover)

## Current architecture and boundaries
- Static front-end: GitHub Pages, deployed from this repository. Keep this live unchanged while migrating.
- Current production database and functions: Supabase Cloud project `ydieijgynqlckaczalju`.
- Target: self-hosted Supabase on OVH, with HTTPS endpoint `https://supabase.neiscircle.site`.
- NEVER commit or expose database backups, personal data, passwords, service-role credentials, SMTP keys, VAPID private keys, or OAuth client secrets.
- Self-hosted Supabase is **not** managed by the Supabase Cloud plugin. After cutover, use reviewed SQL migrations, SSH deployment tooling, and Docker Compose. GitHub can manage code; a deployment workflow needs separate server credentials and explicit authorization.

## Backup snapshots already taken (initial, NOT final)
- Cloud SQL: `roles.sql`, `schema.sql`, `data.sql`, `inventory.csv`; copied to OVH and Windows and SHA-256 verified.
- Storage: 103 objects in `community-media`; object paths and SHA-256 after download compared successfully on Windows. This does not verify origin-side hashes.
- Edge Functions: 8 functions downloaded; 8 code files copied to Windows and compared with SHA-256.
- Snapshots may become stale as users keep posting. They are not a transactionally consistent, final cutover snapshot.

## Blockers before restore or DNS/app config changes
1. Identify what Supabase CLI SQL dumps actually cover: auth identities/users, storage metadata, public schema, custom roles, extension dependencies, RLS, policies, triggers, sequences, publications and grants. Do not assume a `--schema public,auth,storage` dump includes all managed internals.
2. Inspect source SQL safely. Rehearse restore in a **disposable isolated database/environment**, not in the running self-hosted `postgres` service that already contains a Google OAuth test user.
3. Preserve or rebuild extension/pg_cron/pg_net/vault jobs and their secrets; inspect scheduled outbound calls and change endpoints cautiously.
4. Inventory 15 named source secrets; reconfigure Brevo, LiveKit, Resend, web push VAPID, email worker secret and SMTP **through protected environment files or GitHub environment secrets**. Supabase-managed `SUPABASE_*` values must use the target's correct URL/key/JWT configuration. Never copy secret values into git or chat.
5. Confirm every Edge Function's deployed JWT mode and replicate it. Distinguish functions served by self-hosted stack from Supabase Cloud deployments.
6. Restore binary Storage via supported Storage interfaces and test retrieval. SQL metadata alone does not contain object bytes. Avoid overwriting active data.
7. Run full end-to-end staging smoke tests: Google auth (including returning user), RLS, circle/admin roles, notifications, Realtime, files, polls, media, timetable, push subscriptions, mailing workers, scheduled jobs, LiveKit and mobile PWA.
8. Configure a protected, **manual-only** GitHub Actions workflow for approved SQL/Functions/stack updates. Ensure offline backup, test, migration ordering, deployment health checks and rollback/restore plan; do not expose SSH privately or put production passwords in workflow logs.
9. Arrange encrypted external backups, retention, point-in-time recovery strategy and alerting. Copies on the VPS and a Windows Downloads folder are not sufficient long-term protection.
10. Final cutover: announce maintenance window and stop writes to old production, take *final* consistent database+Storage snapshots, re-run validation, deploy, verify counts/data, update application environment and OAuth allowlists, release maintenance mode. Retain old Cloud project for rollback.

## Strict deployment policies
- Never auto-deploy database migrations on every push to `main` until staged tests and manual review/approval are proven.
- No destructive migrations without an independently tested backup/restore.
- No replacement of GitHub Pages deployment or site URLs as part of a backup task.
- No direct public exposure of Postgres (5432), Supavisor (6543), Studio or Docker API.
- Branch + pull request first, with CI/static and unit checks before merge.
