-- NEIS Circle v27 — article metadata, threaded comments, permissions and notifications.
begin;

alter table public.articles add column if not exists category text not null default 'General';
alter table public.articles add column if not exists tags text[] not null default '{}';

create table if not exists public.article_comments (
  id uuid primary key default gen_random_uuid(),
  article_id bigint not null references public.articles(id) on delete cascade,
  parent_id uuid references public.article_comments(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id,article_id),
  constraint article_comments_parent_same_article_fk
    foreign key (parent_id,article_id) references public.article_comments(id,article_id) on delete cascade
);

do $$
begin
  if not exists(select 1 from pg_constraint where conname='article_comments_id_article_id_key') then
    alter table public.article_comments add constraint article_comments_id_article_id_key unique(id,article_id);
  end if;
  if not exists(select 1 from pg_constraint where conname='article_comments_parent_same_article_fk') then
    alter table public.article_comments add constraint article_comments_parent_same_article_fk
      foreign key(parent_id,article_id) references public.article_comments(id,article_id) on delete cascade;
  end if;
end;
$$;

create index if not exists article_comments_article_created_idx
  on public.article_comments(article_id,created_at);
create index if not exists article_comments_parent_idx
  on public.article_comments(parent_id) where parent_id is not null;
create index if not exists article_comments_author_idx
  on public.article_comments(author_id);

alter table public.article_comments enable row level security;

drop policy if exists article_comments_read on public.article_comments;
create policy article_comments_read on public.article_comments
for select to authenticated using (
  exists (
    select 1 from public.articles a
    where a.id=article_comments.article_id
      and (a.status='published' or a.author_id=auth.uid() or public.is_admin())
  )
);

drop policy if exists article_comments_create on public.article_comments;
create policy article_comments_create on public.article_comments
for insert to authenticated with check (
  author_id=auth.uid()
  and exists (
    select 1 from public.articles a
    where a.id=article_comments.article_id and a.status='published'
  )
);

drop policy if exists article_comments_update_owner_admin on public.article_comments;
create policy article_comments_update_owner_admin on public.article_comments
for update to authenticated
using (author_id=auth.uid() or public.is_admin())
with check (author_id=auth.uid() or public.is_admin());

drop policy if exists article_comments_delete_owner_admin on public.article_comments;
create policy article_comments_delete_owner_admin on public.article_comments
for delete to authenticated
using (author_id=auth.uid() or public.is_admin());

grant select,insert,update,delete on public.article_comments to authenticated;

create or replace function public.touch_article_comment()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.article_id<>old.article_id or new.author_id<>old.author_id
     or new.parent_id is distinct from old.parent_id then
    raise exception 'article_comment_relationships_are_immutable';
  end if;
  new.updated_at=now();
  return new;
end;
$$;

drop trigger if exists article_comments_touch on public.article_comments;
create trigger article_comments_touch before update on public.article_comments
for each row execute function public.touch_article_comment();

create or replace function public.notify_article_comment()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  article_owner uuid;
  article_title text;
  parent_owner uuid;
  commenter_name text;
begin
  select a.author_id,coalesce(nullif(a.title_en,''),nullif(a.title_ar,''),'Article')
    into article_owner,article_title
  from public.articles a where a.id=new.article_id and a.status='published';

  if article_owner is null then return new; end if;
  select coalesce(nullif(p.full_name,''),'A student') into commenter_name
  from public.profiles p where p.id=new.author_id;

  if article_owner<>new.author_id then
    insert into public.notifications(user_id,type,title,body,route)
    values (
      article_owner,
      'reply',
      case when new.parent_id is null then 'New article comment' else 'New reply on your article' end,
      coalesce(commenter_name,'A student')||' commented on “'||article_title||'”.',
      'articles/'||new.article_id::text
    );
  end if;

  if new.parent_id is not null then
    select c.author_id into parent_owner from public.article_comments c where c.id=new.parent_id;
    if parent_owner is not null and parent_owner<>new.author_id and parent_owner<>article_owner then
      insert into public.notifications(user_id,type,title,body,route)
      values (
        parent_owner,
        'reply',
        'New reply to your comment',
        coalesce(commenter_name,'A student')||' replied to your comment on “'||article_title||'”.',
        'articles/'||new.article_id::text
      );
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists article_comments_notify on public.article_comments;
create trigger article_comments_notify after insert on public.article_comments
for each row execute function public.notify_article_comment();

do $$
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime')
     and not exists(
       select 1 from pg_publication_tables
       where pubname='supabase_realtime' and schemaname='public' and tablename='article_comments'
     ) then
    alter publication supabase_realtime add table public.article_comments;
  end if;
end;
$$;

commit;
select 'NEIS Circle v27 article recovery and comments backend ready' as result;
