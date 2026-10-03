# NEIS Circle Stability Roadmap

This refactor is intentionally incremental. The rule is: **no feature removal, no visual downgrade, no big-bang rewrite**.

## Phase 0 — Safety net (this branch)

- Static JavaScript and inline-script syntax checks.
- Duplicate/missing asset checks for `index.html`.
- Guard against loading obsolete Home Poll modules.
- Browser boot smoke test in Chromium.
- GitHub Actions quality gate on pull requests to `main`.
- Architecture baseline reporting for global function overrides.

## Phase 1 — One data/realtime coordinator

Goal: realtime changes update only the affected UI.

- One subscription registry.
- One request-deduplication layer.
- One cache for profiles/posts/notifications.
- No feature-specific full-page `render()` after realtime events.
- Preserve active inputs, media players, scroll state, and modals.

## Phase 2 — Split the social monolith

Break `scripts/05-social.js` into stable modules without changing behavior:

- `social/feed.js`
- `social/posts.js`
- `social/comments.js`
- `social/messages.js`
- `social/circles.js`
- `social/polls.js`
- `social/notifications.js`
- `social/realtime.js`

Each module gets one public API. Modules must not replace another module's global functions.

## Phase 3 — Build pipeline

Move to Vite/ES modules while keeping GitHub Pages:

- minification
- tree-shaking
- hashed assets
- automatic cache busting
- route/feature code splitting
- source maps for production debugging

## Phase 4 — Supabase efficiency and security

Do this only after automated regression coverage is green.

- Add indexes for verified hot foreign-key/query paths.
- Replace per-row `auth.*` RLS calls with init-plan-safe forms where appropriate.
- Consolidate duplicate permissive policies.
- Remove confirmed duplicate indexes.
- Review SECURITY DEFINER RPC execution grants function-by-function.
- Keep private Circle and admin behavior unchanged.

## Release rule

A production change should not merge unless:

1. static quality gate passes,
2. browser boot smoke passes,
3. feature-specific regression tests pass,
4. no unexpected Supabase schema/RLS change is included.
