-- Feature #5 regression fix: allow authenticated API clients to use the like tables.
grant select, insert, delete on table public.comment_likes to authenticated;
grant select, insert, delete on table public.article_comment_likes to authenticated;
