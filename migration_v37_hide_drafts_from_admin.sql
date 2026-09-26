-- Draft articles are private to their authors.
-- Published articles remain visible to authenticated members.
drop policy if exists "members read visible articles" on public.articles;

create policy "members read visible articles"
on public.articles
for select
to authenticated
using (
  status = 'published'
  or author_id = auth.uid()
);
