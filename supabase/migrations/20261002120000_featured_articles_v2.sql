alter table public.articles
  add column if not exists featured boolean not null default false,
  add column if not exists featured_at timestamptz,
  add column if not exists featured_by uuid references auth.users(id) on delete set null;

create index if not exists articles_featured_at_idx
  on public.articles(featured, featured_at desc)
  where featured = true;

create or replace function public.set_article_featured(p_article_id bigint,p_featured boolean)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_status text;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if auth.uid() <> '25b556a3-ec6f-49e7-ac6c-1b09720e3bfd'::uuid then
    raise exception 'Only the main administrator can feature articles';
  end if;

  select status into v_status
  from public.articles
  where id=p_article_id;

  if not found then raise exception 'Article not found'; end if;
  if p_featured and v_status <> 'published' then
    raise exception 'Only published articles can be featured';
  end if;

  update public.articles
  set featured=coalesce(p_featured,false),
      featured_at=case when p_featured then now() else null end,
      featured_by=case when p_featured then auth.uid() else null end
  where id=p_article_id;
end $$;

revoke all on function public.set_article_featured(bigint,boolean) from public,anon;
grant execute on function public.set_article_featured(bigint,boolean) to authenticated;
