# NEIS Circle

Private, bilingual (English / العربية) student knowledge network. Static front end hosted on
GitHub Pages (`CNAME`), Supabase for auth, data and storage.

## Layout

```
index.html                     document shell only: meta, stylesheet links, markup, script tags
styles/
  security-v11.css             layer: hardening styles
  app.css                      core application styles (dark/light theme, shell, views, components)
  image-editor.css             image editor styles
  ui-v13.css                   layer: UI polish v13
  ui-v14.css                   layer: mobile navigation + sheet + responsive rules
  private-circles-v15.css      layer: private circles
scripts/
  01-core.js                   config, app state, i18n dictionary, core views (home, discover,
                               circles, messages, library, opportunities), render/bind/nav, modal, toast
  02-content-admin.js          roles, gallery, articles, admin workspace, likes/saves persistence
  03-auth-i18n.js              auth screens, onboarding, complete UI language layer, top-bar sync
  04-permissions-ux.js         permissions UX, filters and active-state handling
  05-social.js                 conversations, replies, comments, connections, global search,
                               circles, notifications, client routing
  06-image-editor.js           in-page image editor used before uploads
  security-v11.js              layer: hardening (v11)
  replies-v12.js               layer: threaded replies (v12)
  navigation-v14.js            layer: mobile "More" sheet in #mobileNavRoot (v14)
  identity-v15.js              layer: Google-only sign-in + post-login mobile registration gate (v17)
  private-circles-v15.js       layer: private circles (v15)
supabase/                      edge functions / SQL support files
migration_*.sql                database migrations, applied in numeric order
```

> Apply `migration_v17.sql` after v16. It fixes Google OAuth sign-up
> (`Database error saving new user`), private-circle key regeneration
> (pgcrypto `extensions` schema), and message soft-delete policies, and adds
> the `register_own_phone` RPC used by the post-login mobile gate.

## Why the styles and scripts are still classic (non-module) files

The application was built as an incremental series of layers, each one wrapping the previous
entry point, for example:

```js
const baseRender = render;               // 05-social.js keeps the previous renderer
render = function(){ ...; baseRender();  // and extends it before calling through
```

Those wrappers rely on shared global scope and on load order. The refactor therefore keeps
classic `<script src>` tags in their original order instead of converting to ES modules, so the
split is behaviour-preserving; `render`, `nav` and `loadLiveData` remain the same override chain
they were before. Everything else (markup, CSS and each script layer) now lives in its own file,
and `index.html` is a readable 90-line shell.

Load order matters: `01-core.js` → `06-image-editor.js`, then `security-v11.js`, `replies-v12.js`,
`navigation-v14.js`, `identity-v15.js`, `private-circles-v15.js`. Keep it when editing `index.html`.

## Behaviour contract and smoke tests

`_tools/` contains a headless before/after test rig (see `_tools/runs/BASELINE.md`):

```
cd _tools
node run-smoke.mjs <label> ../neis-circle-*/index.html user 1 1414x1307   # desktop admin
node run-smoke.mjs <label> ../neis-circle-*/index.html user 0 1414x1307   # desktop student
node run-smoke.mjs <label> ../neis-circle-*/index.html user 1 390x844     # mobile admin
node run-smoke.mjs <label> ../neis-circle-*/index.html user 0 390x844     # mobile student
node run-smoke.mjs <label> ../neis-circle-*/index.html anon 0 390x844     # signed out
node compare.mjs runs/<a>/report.json runs/<b>/report.json               # equivalence check
```

`gen-harness.mjs` copies the page, injects `harness/mock-supabase.js` (in-memory Supabase) plus
`harness/driver.js` and renders it in headless Edge. Each run writes `report.json`, `dom.html` and
`screen.png`. Assertions only read externally observable state (DOM, class names, `location.hash`,
`localStorage`), which is what made the same suite usable before and after this refactor.

## Recent fix

`scripts/05-social.js` (`applyRoute`) now keeps the address bar in sync when a non-admin opens
`#/admin`: the route is rewritten to `#/home`, the Home view is rendered and a short notice is
shown. Previously the hash stayed `#/admin` while Home was rendered, so reloads, bookmarks and the
back button re-triggered a silent redirect and the student saw no explanation. The device-test
`admin: student route stays consistent` covers this case.
