# Timetable AI — staged rollout (NEIS Circle)

Status: CODE PREPARED IN GITHUB, NOT YET INSTALLED ON PRODUCTION.

This is an additive feature for the existing OVH-hosted static frontend and self-hosted Supabase stack. The repository root index.html is a MAINTENANCE BRIDGE; do not replace OVH's working index.html with it.

## What is included

- scripts/timetable-ai-v1.js + styles/timetable-ai-v1.css: small bilingual AI button inside the existing Timetable header, compact mobile/desktop chat, PDF/image upload, contextual conversations, preview/undo and an explicit save button.
- supabase/functions/timetable-ai/index.ts: authenticated, rate-limited Google Gemini 3.1 Flash-Lite multimodal planner. No browser API key and no AI writes to the database.
- 20261102100000_timetable_ai_quota.sql: atomic 4 requests/minute and 25 requests/day per signed-in user.
- 20261102101000_timetable_ai_atomic_save.sql: one-transaction timetable apply; checks owner, stale revisions, values and duplicates; preserves unchanged rows and reminder settings.
- qa/timetable-ai.test.mjs: mock-provider browser regression tests. They do NOT test real Gemini vision or production credentials.

## Mandatory configuration BEFORE exposing the button

1. Create a separate Google AI Studio API project with **free tier and no billing enabled**. The free tier is rate-limited and is not guaranteed forever or at unlimited scale. Google's Free Tier may use content to improve products; the UI discloses it. Avoid uploading student identifiers, personal details or third-party schedules without permission.
2. Store GEMINI_API_KEY in the **private environment for the active self-hosted Edge Functions runtime** on OVH. Never put it into GitHub files, static JS, the browser, committed Docker Compose, or public logs. Confirm the Edge runtime sees it without printing it. This repository does not contain or configure that secret.
3. Apply the two SQL migrations in order to the **live** PostgreSQL database. Use the existing verified migration/backup workflow; take a backup and verify RLS. Do not apply to the old Supabase Cloud project or a test database by mistake.
4. Add the timetable-ai function under the active self-hosted Edge runtime function root, preserving the existing main router and all other functions. Build a new immutable release rather than modifying an active read-only bind mount. Ensure the public route /functions/v1/timetable-ai is routed by the existing gateway, with verified user JWTs enabled. Do NOT weaken the authentication policy to address a 401.
5. Run authenticated API checks on the new function using an approved TEST user, and verify 401 for missing/invalid JWT; file validation; per-user limits; a real image and PDF with legible times; correct language; and that the function cannot read another student's timetable. Confirm GEMINI_API_KEY never reaches network responses.
6. Run the browser QA and a staging browser session. Only THEN append these asset tags to the **actual active OVH index.html**, leaving the rest untouched:

    <link rel="stylesheet" href="styles/timetable-ai-v1.css?v=1">
    <script defer src="scripts/timetable-ai-v1.js?v=1"></script>

   The CSS goes in <head>, JS goes near the end of <body> AFTER the existing timetable script. Publish both asset files along with the existing live frontend using a new immutable release. Prefer a repeatable versioned, rollback-capable deployment like scripts/ops/ovh-deploy-timetable-png-export-v1.py, with NO changes to unrelated functions or services.
7. Before switching the OVH release pointer, inspect the active Caddy mount and its routing; refuse to continue if the expected live timetable assets aren't present. After switching, verify the new JS/CSS load, the route works, and the existing Export PNG, notifications, other Timetable actions, sign-in and real-time updates remain intact. Roll back if verification fails.

## How the conversation works

- The original saved timetable is the baseline. The server fetches fresh rows under the user's JWT/RLS for each AI request.
- An uploaded document is read transiently in the browser and passed to the authenticated Edge Function, which passes it to Gemini. Neither the PDF nor image is written to NEIS Circle Storage.
- First document upload alone is **not** a save: the assistant extracts classes, asks what to keep, and retains the extracted catalog in memory for follow-up turns.
- Chat instructions update a draft in the user's current tab. Edits, additions and deletions can be discussed and undone without affecting saved rows.
- A review lists all proposed additions, edits and deletions. No database writes occur until explicit user confirmation; one RPC transaction then saves or returns an error if the underlying timetable changed elsewhere.
- Memory of the conversation/draft is currently limited to the open browser tab. Refresh clears the unsaved draft; saved timetable rows remain intact.

## Test commands

    node --check scripts/timetable-ai-v1.js
    node --check qa/timetable-ai.test.mjs
    npm install --no-save playwright
    npx playwright install chromium
    node qa/timetable-ai.test.mjs

The separate GitHub workflow \`.github/workflows/timetable-ai-quality.yml\` runs the automated browser test on the feature branch/PR. No credentials required for mock tests. Automated QA is not a substitute for authenticated live tests.

## Operational notes

- The only AI inference load is Google's API; OVH handles authenticated requests, small timetable queries and the final batch write. The free tier can return 429 and its project-wide quotas can be exhausted.
- Max PDF/image: 5 MB; uploaded larger images are downscaled in-browser if appropriate. Max 80 timetable entries per plan; no OCR library or large model runs on OVH.
- All rows are per-user private under the existing timetable RLS policies. The AI key is server-side only.
- This branch does not change the repository root maintenance bridge and deliberately does not auto-deploy to production until the private key, SQL and authenticated route are checked.
