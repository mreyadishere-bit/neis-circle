-- Restore the original soft-delete behavior for post comments.
-- A deleted comment may have an empty body because the UI renders the deleted marker
-- from deleted_at and keeps child replies attached to the original comment row.
alter table public.comments
  drop constraint if exists comments_body_check;

alter table public.comments
  add constraint comments_body_check
  check (
    deleted_at is not null
    or (char_length(body) >= 1 and char_length(body) <= 5000)
  );
