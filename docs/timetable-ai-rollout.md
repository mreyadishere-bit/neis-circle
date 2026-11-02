# Timetable AI — staged rollout (NEIS Circle)

Status: CODE PREPARED IN GITHUB, NOT YET INSTALLED ON PRODUCTION.

This is an additive feature for the existing OVH-hosted static frontend and self-hosted Supabase stack. The repository root index.html is a MAINTENANCE BRIDGE; do not replace OVH's working index.html with it.

## What is included

- scripts/timetable-ai-v1.js + styles/timetable-ai-v1.css: small bilingual AI button inside the existing Timetable header, compact mobile/desktop chat, PDF/image upload, contextual conversations, preview/undo and an explicit save button.
- supabase/functions/timetable-ai/index.ts: authenticated, rate-limited Groq Qwen 3.8 27B multimodal planner. No browser API key and no AI writes to the database.
- 20261102100000_timetable_ai_quota.sql: atomic 4 requests/minute and 25 requests/day and 4/min per signed-in user, plus a project-wide cap of 600 requests/day and 15/min (below Groq’s published Free Tier request caps). Groq has additional shared token limits and may return HTTP 429 sooner.
- 20261102101000_timetable_ai_atomic_save.sql: one-transaction timetable apply; checks owner, stale revisions, values and duplicates; preserves unchanged rows and reminder settings.
- qa/timetable-ai.test.mjs: mock-provider browser regression tests. They do NOT test real Gemini vision or production credentials.

## Mandatory configuration BEFORE exposing the button

1. IMPORTANT AGE/TERMS GATE: Google's Gemini API Additional Terms (effective March 23, 2026) prohibit use in apps likely to be accessed by minors. This school-facing feature **must not use the Gemini API**, even if the key belongs to an adult. The implementation uses Groq instead. Under Groq's Services Agreement (June 22, 2026), the **API account holder/customer must be 18+**, and apps accessed by minors require the customer to comply with applicable minor/privacy/consent law. An authorized adult/organization must own the Groq API account and accept the terms; do not misrepresent age or share an underage-owned account.
2. Create a GroqCloud **Free tier** API key owned by an eligible authorized adult or school. Keep the account on the Free plan with no paid billing upgrade. Groq confirms Free Plan limits return 429 instead of charges; the project quota provides an additional safeguard. This app cannot inspect or prevent a human from upgrading the provider account to a paid plan. Quotas are limited, may change, and may be exhausted. For privacy review consult https://console.groq.com/docs/your-data. Student timetable data is processed by Groq; no media is stored in NEIS Circle. Publish an adequate privacy notice and obtain parental/guardian consent if law requires. Avoid student identifiers and third-party data.
3. Store GROQ_API_KEY in the **private environment for the active self-hosted Edge Functions runtime** on OVH. Never put it into GitHub files, static JS, the browser, committed Docker Compose, or public logs. Confirm the Edge runtime sees it without printing it. This repository does not contain or configure that secret.
4. Apply the two SQL migrations in order to the **live** PostgreSQL database. Use the existing verified migration/backup workflow; take a backup and verify RLS. Do not apply to the old Supabase Cloud project or a test database by mistake.
5. Add the timetable-ai function under the active self-hosted Edge runtime function root, preserving the existing main router and all other functions. Build a new immutable release rather than modifying an active read-only bind mount. Ensure the public route /functions/v1/timetable-ai is routed by the existing gateway, with verified user JWTs enabled. Do NOT weaken the authentication policy to address a 401.
6. Run authenticated API checks on the new function using an approved TEST user, and verify 401 for missing/invalid JWT; file validation; per-user limits; a real image and PDF with legible times; correct language; and that the function cannot read another student's timetable. Confirm GROQ_API_KEY never reaches network responses.
7. Run the browser QA and a staging browser session. Only THEN append these asset tags to the **actual active OVH index.html**, leaving the rest untouched:

    <link rel="stylesheet" href="styles/timetable-ai-v1.css?v=1">
    <script defer src="scripts/timetable-ai-v1.js?v=1"></script>

   The CSS goes in <head>, JS goes near the end of <body> AFTER the existing timetable script. Publish both asset files along with the existing live frontend using a new immutable release. Prefer a repeatable versioned, rollback-capable deployment like scripts/ops/ovh-deploy-timetable-png-export-v1.py, with NO changes to unrelated functions or services.
8. Before switching the OVH release pointer, inspect the active Caddy mount and its routing; refuse to continue if the expected live timetable assets aren't present. After switching, verify the new JS/CSS load, the route works, and the existing Export PNG, notifications, other Timetable actions, sign-in and real-time updates remain intact. Roll back if verification fails.

## How the conversation works

- The original saved timetable is the baseline. The server fetches fresh rows under the user's JWT/RLS for each AI request.
- An uploaded document is read transiently in the browser and passed to the authenticated Edge Function, which passes it to Groq. Neither the PDF nor image is written to NEIS Circle Storage.
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

- The only AI inference load is Google's API; OVH handles authenticated requests, small timetable queries and the final batch write. The Groq free tier can return 429 and its project-wide quotas can be exhausted.
- Max PDF/image: 5 MB; PDFs (up to 3 pages) are rendered into images in the user browser with pinned Mozilla PDF.js loaded on demand; uploaded larger images are downscaled in-browser where appropriate. The external jsDelivr PDF.js import must be verified against live CSP and ideally self-hosted at an approved immutable URL before production. Max 80 timetable entries per plan; no OCR library or large model runs on OVH.
- All rows are per-user private under the existing timetable RLS policies. The AI key is server-side only.
- This branch does not change the repository root maintenance bridge and deliberately does not auto-deploy to production until the private key, SQL and authenticated route are checked.

## Hard $0 operating rule

The application is intended to run exclusively on a Groq Free Plan account. **Never connect a paid-tier API key or upgrade the account.** Provider billing tier is controlled on GroqCloud itself, not by client code or database SQL. Free Plan requests above the provider limit return HTTP 429 rather than incur charges. Users can still add/edit timetable entries manually if AI's free quota is reached. The account customer must be an eligible adult/authorized school representative; collect any student/guardian permissions as needed.
