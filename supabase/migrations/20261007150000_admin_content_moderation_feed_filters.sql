create or replace function public.admin_get_content_moderation_feed(
  type_input text default 'all',
  from_input timestamptz default null,
  to_input timestamptz default null,
  search_input text default null,
  sort_input text default 'newest',
  limit_input integer default 200,
  offset_input integer default 0
)
returns table (
  content_type text,
  content_id text,
  title text,
  meta text,
  author_id uuid,
  author_name text,
  circle_id uuid,
  parent_id text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  normalized_type text := lower(btrim(coalesce(type_input,'all')));
  normalized_search text := lower(btrim(coalesce(search_input,'')));
  safe_limit integer := greatest(1, least(coalesce(limit_input,200), 300));
  safe_offset integer := greatest(0, coalesce(offset_input,0));
begin
  perform 1
  from auth.users u
  join public.profiles p on p.id=u.id
  where u.id=auth.uid()
    and lower(coalesce(u.email,''))='mreyadishere@gmail.com'
    and p.role='admin'
    and coalesce(p.account_status,'active')='active';
  if not found then raise exception 'Not authorized' using errcode='42501'; end if;

  return query
  with feed as (
    select 'post'::text content_type,p.id::text content_id,
      coalesce(nullif(p.title,''),left(coalesce(p.body,''),180),'Post')::text title,
      case when p.circle_id is null then 'post' else 'circle post' end::text meta,
      p.author_id,pr.full_name::text author_name,p.circle_id,null::text parent_id,p.created_at
    from public.posts p left join public.profiles pr on pr.id=p.author_id
    union all
    select 'reply',c.id::text,left(coalesce(c.body,''),180),'reply',c.author_id,pr.full_name,p.circle_id,c.post_id::text,c.created_at
    from public.comments c join public.posts p on p.id=c.post_id left join public.profiles pr on pr.id=c.author_id where c.deleted_at is null
    union all
    select 'article',a.id::text,coalesce(nullif(a.title_en,''),nullif(a.title_ar,''),'Article'),coalesce(a.status,'article'),
      a.author_id,pr.full_name,null::uuid,null::text,a.created_at
    from public.articles a left join public.profiles pr on pr.id=a.author_id
    union all
    select 'article comment',ac.id::text,left(coalesce(ac.body,''),180),'article comment',ac.author_id,pr.full_name,null::uuid,ac.article_id::text,ac.created_at
    from public.article_comments ac left join public.profiles pr on pr.id=ac.author_id
    union all
    select 'circle',c.id::text,coalesce(c.name,'Circle'),coalesce(c.privacy,'circle'),c.owner_id,pr.full_name,c.id,null::text,c.created_at
    from public.circles c left join public.profiles pr on pr.id=c.owner_id
    union all
    select 'meeting',m.id::text,coalesce(m.title,'Meeting'),'meeting',m.creator_id,pr.full_name,m.circle_id,null::text,m.created_at
    from public.circle_meetings m left join public.profiles pr on pr.id=m.creator_id
    union all
    select 'circle message',cm.id::text,left(coalesce(cm.body,''),180),'circle message',cm.sender_id,pr.full_name,cm.circle_id,null::text,cm.created_at
    from public.circle_messages cm left join public.profiles pr on pr.id=cm.sender_id where cm.deleted_at is null
    union all
    select 'gallery',g.id::text,coalesce(nullif(g.caption_en,''),nullif(g.caption_ar,''),'Gallery item'),
      case when coalesce(g.approved,false) then 'gallery' else 'gallery · pending' end,
      g.author_id,pr.full_name,null::uuid,null::text,g.created_at
    from public.gallery_items g left join public.profiles pr on pr.id=g.author_id
    union all
    select 'opportunity',o.id::text,coalesce(o.title,'Opportunity'),coalesce(o.status,'opportunity'),o.author_id,pr.full_name,null::uuid,null::text,o.created_at
    from public.opportunities o left join public.profiles pr on pr.id=o.author_id
    union all
    select 'study resource',s.id::text,coalesce(s.title,'Study resource'),
      trim(both ' · ' from concat_ws(' · ',nullif(s.subject,''),nullif(s.unit,''))),
      s.author_id,pr.full_name,null::uuid,null::text,s.created_at
    from public.study_resources s left join public.profiles pr on pr.id=s.author_id
  )
  select f.content_type,f.content_id,f.title,
    case when coalesce(f.author_name,'')<>'' then concat_ws(' · ',nullif(f.meta,''),f.author_name) else f.meta end,
    f.author_id,f.author_name,f.circle_id,f.parent_id,f.created_at
  from feed f
  where (normalized_type='all' or f.content_type=normalized_type)
    and (from_input is null or f.created_at>=from_input)
    and (to_input is null or f.created_at<to_input)
    and (
      normalized_search=''
      or lower(coalesce(f.title,'')) like '%'||normalized_search||'%'
      or lower(coalesce(f.meta,'')) like '%'||normalized_search||'%'
      or lower(coalesce(f.author_name,'')) like '%'||normalized_search||'%'
    )
  order by
    case when lower(coalesce(sort_input,'newest'))='oldest' then f.created_at end asc,
    case when lower(coalesce(sort_input,'newest'))<>'oldest' then f.created_at end desc,
    f.content_type,f.content_id
  limit safe_limit offset safe_offset;
end;
$$;

revoke all on function public.admin_get_content_moderation_feed(text,timestamptz,timestamptz,text,text,integer,integer) from public, anon;
grant execute on function public.admin_get_content_moderation_feed(text,timestamptz,timestamptz,text,text,integer,integer) to authenticated;

create or replace function public.admin_delete_moderation_content(content_type_input text,content_id_input text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  normalized_type text := lower(btrim(coalesce(content_type_input,'')));
  affected integer := 0;
begin
  perform 1
  from auth.users u
  join public.profiles p on p.id=u.id
  where u.id=auth.uid()
    and lower(coalesce(u.email,''))='mreyadishere@gmail.com'
    and p.role='admin'
    and coalesce(p.account_status,'active')='active';
  if not found then raise exception 'Not authorized' using errcode='42501'; end if;

  if normalized_type='post' then delete from public.posts where id=content_id_input::uuid;
  elsif normalized_type='reply' then delete from public.comments where id=content_id_input::uuid;
  elsif normalized_type='article' then delete from public.articles where id=content_id_input::bigint;
  elsif normalized_type='article comment' then delete from public.article_comments where id=content_id_input::uuid;
  elsif normalized_type='circle' then delete from public.circles where id=content_id_input::uuid;
  elsif normalized_type='meeting' then delete from public.circle_meetings where id=content_id_input::uuid;
  elsif normalized_type='circle message' then
    update public.circle_messages set body='',deleted_at=coalesce(deleted_at,now())
    where id=content_id_input::bigint and deleted_at is null;
  elsif normalized_type='gallery' then delete from public.gallery_items where id=content_id_input::bigint;
  elsif normalized_type='opportunity' then delete from public.opportunities where id=content_id_input::uuid;
  elsif normalized_type='study resource' then delete from public.study_resources where id=content_id_input::uuid;
  else raise exception 'Unsupported content type' using errcode='22023';
  end if;

  get diagnostics affected = row_count;
  return affected>0;
end;
$$;

revoke all on function public.admin_delete_moderation_content(text,text) from public, anon;
grant execute on function public.admin_delete_moderation_content(text,text) to authenticated;
