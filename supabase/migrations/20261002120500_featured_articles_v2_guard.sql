create or replace function public.guard_article_featured_fields()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if tg_op='INSERT' then
    if coalesce(new.featured,false)
       or new.featured_at is not null
       or new.featured_by is not null
    then
      if auth.uid() is distinct from '25b556a3-ec6f-49e7-ac6c-1b09720e3bfd'::uuid then
        raise exception 'Only the main administrator can feature articles';
      end if;
    end if;
  else
    if new.featured is distinct from old.featured
       or new.featured_at is distinct from old.featured_at
       or new.featured_by is distinct from old.featured_by
    then
      if auth.uid() is distinct from '25b556a3-ec6f-49e7-ac6c-1b09720e3bfd'::uuid then
        raise exception 'Only the main administrator can feature articles';
      end if;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists guard_article_featured_fields_trigger on public.articles;
create trigger guard_article_featured_fields_trigger
before insert or update on public.articles
for each row execute function public.guard_article_featured_fields();
