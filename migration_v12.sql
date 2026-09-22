-- NEIS Circle v12 — explicit permanent comment/reply deletion permissions.
begin;

drop policy if exists comments_delete_author_admin on public.comments;
create policy comments_delete_author_admin
on public.comments for delete to authenticated
using (
  author_id = auth.uid()
  or public.is_admin()
  or exists (
    select 1 from public.posts p
    where p.id = comments.post_id
      and p.circle_id is not null
      and public.circle_role(p.circle_id) in ('owner','admin','moderator')
  )
);

grant delete on public.comments to authenticated;

commit;
select 'NEIS Circle v12 permanent reply deletion ready' as result;
