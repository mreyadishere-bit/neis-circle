-- Add an explicit category to Gallery items without changing existing content or permissions.
-- Existing rows are kept and classified as Photograph by default.
alter table public.gallery_items
  add column if not exists category text not null default 'photograph';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='gallery_items_category_check'
      and conrelid='public.gallery_items'::regclass
  ) then
    alter table public.gallery_items
      add constraint gallery_items_category_check
      check (category in ('photograph','art')) not valid;
  end if;
end $$;

alter table public.gallery_items
  validate constraint gallery_items_category_check;

create index if not exists gallery_items_category_created_at_idx
  on public.gallery_items(category, created_at desc);
