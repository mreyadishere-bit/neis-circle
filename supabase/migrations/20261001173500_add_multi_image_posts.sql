alter table public.posts
  add column if not exists image_urls text[] not null default '{}'::text[];

update public.posts
set image_urls = array[image_url]
where coalesce(image_url,'') <> ''
  and cardinality(image_urls) = 0;
