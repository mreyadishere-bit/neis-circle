-- Allow Announcement posts selected by the current composer UI.
alter table public.posts
drop constraint if exists posts_kind_check;

alter table public.posts
add constraint posts_kind_check
check (kind = any (array[
  'Discussion'::text,
  'Question'::text,
  'Resource'::text,
  'Experience'::text,
  'Poll'::text,
  'Opportunity'::text,
  'Announcement'::text
]));
