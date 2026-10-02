alter table public.posts
  add column if not exists youtube_url text not null default '';

comment on column public.posts.youtube_url is
  'Optional YouTube video URL embedded in the post UI after validation.';
