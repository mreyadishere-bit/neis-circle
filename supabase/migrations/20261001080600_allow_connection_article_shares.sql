
alter table public.article_shares
  drop constraint if exists article_shares_method_check;

alter table public.article_shares
  add constraint article_shares_method_check
  check (method = any (array['native'::text,'copy'::text,'connections'::text]));
