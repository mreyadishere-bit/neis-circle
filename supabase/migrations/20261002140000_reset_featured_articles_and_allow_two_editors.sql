drop trigger if exists guard_article_featured_fields_trigger on public.articles;

update public.articles
set featured=false,
    featured_at=null,
    featured_by=null
where coalesce(featured,false)=true
   or featured_at is not null
   or featured_by is not null;

create or replace function public.set_article_featured(p_article_id bigint,p_featured boolean)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_status text;
  v_email text := lower(coalesce(auth.jwt()->>'email',''));
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;

  if v_email not in ('mreyadishere@gmail.com','fatemarateb5@gmail.com') then
    raise exception 'You are not allowed to feature articles';
  end if;

  select status into v_status
  from public.articles
  where id=p_article_id;

  if not found then
    raise exception 'Article not found';
  end if;

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

create or replace function public.guard_article_featured_fields()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_email text := lower(coalesce(auth.jwt()->>'email',''));
begin
  if tg_op='INSERT' then
    if coalesce(new.featured,false)
       or new.featured_at is not null
       or new.featured_by is not null
    then
      if v_email not in ('mreyadishere@gmail.com','fatemarateb5@gmail.com') then
        raise exception 'You are not allowed to feature articles';
      end if;
    end if;
  else
    if new.featured is distinct from old.featured
       or new.featured_at is distinct from old.featured_at
       or new.featured_by is distinct from old.featured_by
    then
      if v_email not in ('mreyadishere@gmail.com','fatemarateb5@gmail.com') then
        raise exception 'You are not allowed to feature articles';
      end if;
    end if;
  end if;
  return new;
end $$;

create trigger guard_article_featured_fields_trigger
before insert or update on public.articles
for each row execute function public.guard_article_featured_fields();
