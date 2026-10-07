alter table public.messages
  add column if not exists shared_post_id uuid references public.posts(id) on delete set null;

alter table public.circle_messages
  add column if not exists shared_article_id bigint references public.articles(id) on delete set null,
  add column if not exists shared_post_id uuid references public.posts(id) on delete set null;

create index if not exists messages_shared_post_id_idx
  on public.messages(shared_post_id)
  where shared_post_id is not null;

create index if not exists circle_messages_shared_article_id_idx
  on public.circle_messages(shared_article_id)
  where shared_article_id is not null;

create index if not exists circle_messages_shared_post_id_idx
  on public.circle_messages(shared_post_id)
  where shared_post_id is not null;
