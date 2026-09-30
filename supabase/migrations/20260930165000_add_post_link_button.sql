alter table public.posts
  add column if not exists link_button_label text not null default '',
  add column if not exists link_button_url text not null default '';

alter table public.posts
  drop constraint if exists posts_link_button_label_length,
  drop constraint if exists posts_link_button_https,
  drop constraint if exists posts_link_button_pair;

alter table public.posts
  add constraint posts_link_button_label_length
    check (char_length(link_button_label) <= 36),
  add constraint posts_link_button_https
    check (link_button_url = '' or link_button_url ~ '^https://[^[:space:]]+$'),
  add constraint posts_link_button_pair
    check (
      (link_button_label = '' and link_button_url = '')
      or
      (link_button_label <> '' and link_button_url <> '')
    );