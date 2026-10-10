# NEIS Circle maintenance switch — 2026-10-10

Maintenance was explicitly approved by the site owner to support the Cloud → OVH migration.

Original GitHub main commit: `78e89de3acd637622d8faabd91b7beffa1b6171f`.
Original `index.html` and `404.html` are preserved in that Git revision.
Restore only after confirming OVH readiness or deciding to roll back. Use GitHub file restore from original commit for both files, or a new PR from `git show 78e89de3acd637622d8faabd91b7beffa1b6171f:index.html` and `git show 78e89de3acd637622d8faabd91b7beffa1b6171f:404.html`.

This is **a user-facing maintenance page, not a server-side Supabase write freeze**. Previously opened browser tabs and direct API clients might still write to the Cloud project. Verify write-quiescence and perform final catch-up before any cutover; never claim an exact point-in-time snapshot while Cloud accepts writes.

Never publish secrets, student data, or private backups to this repository.
