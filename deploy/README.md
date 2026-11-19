# NEIS Circle — approved social preview images

## Single upload to finish deployment

Upload the **exact ZIP** `NEIS_Circle_Complete_Share_Assets.zip` into this `deploy/` folder in GitHub, then commit it to `main`.

The workflow `.github/workflows/ovh-approved-share-images-20261119.yml` is configured to run automatically on that upload, using the existing OVH Actions environment and SSH secrets. It validates the sixteen uploaded WebP images, generates section-specific HTML social previews, publishes a guarded immutable OVH frontend release, and validates public pages externally.

**Root domain:** `https://neiscircle.site/` uses `assets/share/home-main.webp`, the revised three-student picture with warmer, natural skin tones.

**Original internal home:** Keep the existing `/home` content/assets unchanged; no home graphics are replaced.

| Social page | Exact artwork |
| --- | --- |
| `/feed.html` | `assets/share/feed.webp` |
| `/discover.html` | `assets/share/discover.webp` |
| `/study.html` | `assets/share/study.webp` |
| `/messages.html` | `assets/share/messages.webp` |
| `/connections.html` | `assets/share/connections.webp` |
| `/saved.html` | `assets/share/saved.webp` |
| `/opportunities.html` | `assets/share/opportunities.webp` |
| `/gallery.html` | `assets/share/gallery.webp` |
| `/articles.html` | `assets/share/articles.webp` |
| `/circles.html` | `assets/share/circles.webp` |
| `/timetable.html` | `assets/share/timetable.webp` |
| `/analytics.html` | `assets/share/analytics.webp` |
| `/notifications.html` | `assets/share/notifications.webp` |
| `/settings.html` | `assets/share/settings.webp` |
| `/games.html` | `assets/share/games.webp` |

Each image must be `1200 × 630` WebP. No private profile, posts, messages, authentication data, existing app JavaScript or Caddy server routing is changed. Deployment must show `NEIS_SOCIAL_SHARE_ARTWORK_EXTERNAL=PASS` to be considered confirmed. 
