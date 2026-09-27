-- Realtime coverage for live NEIS Circle UI updates.
-- Adds only existing user-facing tables that the frontend already reads.
do $$
declare t text;
begin
  foreach t in array array[
    'reactions',
    'comment_likes',
    'comment_creator_hearts',
    'article_comment_likes',
    'article_comment_creator_hearts',
    'follows',
    'circle_members',
    'reports',
    'conversations',
    'conversation_members'
  ]
  loop
    if to_regclass('public.'||t) is not null
       and not exists (
         select 1
         from pg_publication_tables
         where pubname='supabase_realtime'
           and schemaname='public'
           and tablename=t
       )
    then
      execute format('alter publication supabase_realtime add table public.%I',t);
    end if;
  end loop;
end $$;