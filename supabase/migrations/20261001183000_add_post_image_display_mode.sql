alter table public.posts
  add column if not exists image_display_mode text not null default 'fit';

alter table public.posts
  drop constraint if exists posts_image_display_mode_check;

alter table public.posts
  add constraint posts_image_display_mode_check
  check (image_display_mode in ('fit','fill'));
