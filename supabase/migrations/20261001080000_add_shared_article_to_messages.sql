
alter table public.messages
  add column if not exists shared_article_id bigint references public.articles(id) on delete set null;

create index if not exists messages_shared_article_id_idx
  on public.messages(shared_article_id)
  where shared_article_id is not null;
