-- New posts default to Fill. Existing rows (including explicitly selected Fit)
-- remain unchanged. The change does not backfill or rewrite any post.
begin;
alter table public.posts alter column image_display_mode set default 'fill';
commit;
