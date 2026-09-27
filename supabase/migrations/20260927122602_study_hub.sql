-- Lightweight Study resource library. External links only; no Storage, realtime, or sessions.
create table if not exists public.study_resources (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 3 and 180),
  description text not null default '' check (char_length(description) <= 3000),
  subject text not null check (char_length(btrim(subject)) between 2 and 100),
  unit text not null check (char_length(btrim(unit)) between 1 and 120),
  lesson text not null check (char_length(btrim(lesson)) between 1 and 160),
  external_url text not null check (external_url ~* '^https?://[^[:space:]]+$' and char_length(external_url) <= 2048),
  resource_type text not null check (resource_type in ('document','pdf','video','website','presentation','other')),
  language text not null check (language in ('en','ar','both','other')),
  link_access_confirmed boolean not null check (link_access_confirmed),
  helpful_count integer not null default 0 check (helpful_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.study_resource_actions (
  resource_id uuid not null references public.study_resources(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  helpful boolean not null default false,
  saved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (resource_id,user_id),
  check (helpful or saved)
);

create index if not exists study_resources_hierarchy_idx on public.study_resources(subject,unit,lesson,created_at desc);
create index if not exists study_resources_author_idx on public.study_resources(author_id,created_at desc);
create index if not exists study_resources_filters_idx on public.study_resources(resource_type,language,created_at desc);
create index if not exists study_actions_saved_idx on public.study_resource_actions(user_id,updated_at desc) where saved;

create or replace function public.touch_study_updated_at()
returns trigger language plpgsql set search_path=public as $$
begin new.updated_at=now(); return new; end;
$$;
revoke all on function public.touch_study_updated_at() from public,anon,authenticated;

drop trigger if exists touch_study_resources on public.study_resources;
create trigger touch_study_resources before update on public.study_resources for each row execute function public.touch_study_updated_at();
drop trigger if exists touch_study_actions on public.study_resource_actions;
create trigger touch_study_actions before update on public.study_resource_actions for each row execute function public.touch_study_updated_at();

create or replace function public.refresh_study_helpful_count()
returns trigger language plpgsql security definer set search_path=public as $$
declare target uuid:=coalesce(new.resource_id,old.resource_id);
begin
  update public.study_resources r
  set helpful_count=(select count(*)::integer from public.study_resource_actions a where a.resource_id=target and a.helpful)
  where r.id=target;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.refresh_study_helpful_count() from public,anon,authenticated;

drop trigger if exists refresh_study_helpful_count_trigger on public.study_resource_actions;
create trigger refresh_study_helpful_count_trigger after insert or update of helpful or delete on public.study_resource_actions
for each row execute function public.refresh_study_helpful_count();

alter table public.study_resources enable row level security;
alter table public.study_resource_actions enable row level security;
revoke all on public.study_resources,public.study_resource_actions from anon,authenticated;
grant select on public.study_resources,public.study_resource_actions to authenticated;
grant insert(author_id,title,description,subject,unit,lesson,external_url,resource_type,language,link_access_confirmed) on public.study_resources to authenticated;
grant update(title,description,subject,unit,lesson,external_url,resource_type,language,link_access_confirmed) on public.study_resources to authenticated;
grant delete on public.study_resources to authenticated;
grant insert(resource_id,user_id,helpful,saved),update(helpful,saved),delete on public.study_resource_actions to authenticated;

drop policy if exists study_resources_read on public.study_resources;
create policy study_resources_read on public.study_resources for select to authenticated
using (exists(select 1 from public.profiles p where p.id=(select auth.uid()) and coalesce(p.account_status,'active')='active'));
drop policy if exists study_resources_create on public.study_resources;
create policy study_resources_create on public.study_resources for insert to authenticated
with check (author_id=(select auth.uid()) and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and coalesce(p.account_status,'active')='active'));
drop policy if exists study_resources_update on public.study_resources;
create policy study_resources_update on public.study_resources for update to authenticated
using (author_id=(select auth.uid()) or public.is_admin()) with check (author_id=(select auth.uid()) or public.is_admin());
drop policy if exists study_resources_delete on public.study_resources;
create policy study_resources_delete on public.study_resources for delete to authenticated
using (author_id=(select auth.uid()) or public.is_admin());

drop policy if exists study_actions_read_own on public.study_resource_actions;
create policy study_actions_read_own on public.study_resource_actions for select to authenticated using (user_id=(select auth.uid()));
drop policy if exists study_actions_create_own on public.study_resource_actions;
create policy study_actions_create_own on public.study_resource_actions for insert to authenticated with check (user_id=(select auth.uid()));
drop policy if exists study_actions_update_own on public.study_resource_actions;
create policy study_actions_update_own on public.study_resource_actions for update to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
drop policy if exists study_actions_delete_own on public.study_resource_actions;
create policy study_actions_delete_own on public.study_resource_actions for delete to authenticated using (user_id=(select auth.uid()));

-- Distinct hierarchy values are returned only when a user opens each level.
create or replace function public.study_filter_values(level_input text,subject_input text default null,unit_input text default null)
returns table(value text) language sql stable security invoker set search_path=public as $$
  select distinct case level_input when 'subject' then subject when 'unit' then unit when 'lesson' then lesson end
  from public.study_resources
  where level_input in ('subject','unit','lesson') and (level_input='subject' or subject=subject_input)
    and (level_input<>'lesson' or unit=unit_input)
  order by 1;
$$;
revoke all on function public.study_filter_values(text,text,text) from public,anon;
grant execute on function public.study_filter_values(text,text,text) to authenticated;

-- One bounded page at a time; Saved/My filters execute in Postgres rather than loading IDs client-side.
create or replace function public.study_resource_page(
  mode_input text default 'resources',subject_input text default null,unit_input text default null,lesson_input text default null,
  search_input text default null,type_input text default null,language_input text default null,oldest_input boolean default false,
  page_size_input integer default 12,offset_input integer default 0
)
returns table(id uuid,author_id uuid,title text,description text,subject text,unit text,lesson text,external_url text,
  resource_type text,language text,link_access_confirmed boolean,helpful_count integer,created_at timestamptz,updated_at timestamptz,total_count bigint)
language sql stable security invoker set search_path=public as $$
  select r.id,r.author_id,r.title,r.description,r.subject,r.unit,r.lesson,r.external_url,r.resource_type,r.language,
    r.link_access_confirmed,r.helpful_count,r.created_at,r.updated_at,count(*) over()
  from public.study_resources r
  where mode_input in ('resources','saved','my')
    and (mode_input<>'my' or r.author_id=(select auth.uid()))
    and (mode_input<>'saved' or exists(select 1 from public.study_resource_actions a where a.resource_id=r.id and a.user_id=(select auth.uid()) and a.saved))
    and (subject_input is null or r.subject=subject_input)
    and (unit_input is null or r.unit=unit_input)
    and (lesson_input is null or r.lesson=lesson_input)
    and (type_input is null or r.resource_type=type_input)
    and (language_input is null or r.language=language_input)
    and (search_input is null or btrim(search_input)='' or r.title ilike '%'||btrim(search_input)||'%' or r.description ilike '%'||btrim(search_input)||'%' or r.subject ilike '%'||btrim(search_input)||'%' or r.unit ilike '%'||btrim(search_input)||'%' or r.lesson ilike '%'||btrim(search_input)||'%')
  order by case when oldest_input then r.created_at end asc,case when not oldest_input then r.created_at end desc,r.id
  limit least(greatest(page_size_input,1),24) offset greatest(offset_input,0);
$$;
revoke all on function public.study_resource_page(text,text,text,text,text,text,text,boolean,integer,integer) from public,anon;
grant execute on function public.study_resource_page(text,text,text,text,text,text,text,boolean,integer,integer) to authenticated;

-- Include Study resources in the existing immutable report snapshot.
create or replace function public.capture_report_snapshot()
returns trigger language plpgsql security definer set search_path=public,auth as $$
declare kind text:=lower(trim(coalesce(new.target_type,''))); owner_id uuid;
begin
  owner_id:=coalesce(
    case when kind in ('profile','user') then public.try_uuid(new.target_id) end,
    case when kind='post' then (select p.author_id from public.posts p where p.id=public.try_uuid(new.target_id)) end,
    case when kind in ('comment','reply') then (select c.author_id from public.comments c where c.id=public.try_uuid(new.target_id)) end,
    case when kind='circle' then (select c.owner_id from public.circles c where c.id=public.try_uuid(new.target_id)) end,
    case when kind='message' then (select m.sender_id from public.messages m where m.id=public.try_uuid(new.target_id)) end,
    case when kind='circle_message' then (select m.sender_id from public.circle_messages m where m.id=public.try_bigint(new.target_id)) end,
    case when kind='gallery' then (select g.author_id from public.gallery_items g where g.id=public.try_bigint(new.target_id)) end,
    case when kind='article' then (select a.author_id from public.articles a where a.id=public.try_bigint(new.target_id)) end,
    case when kind='meeting' then (select m.creator_id from public.circle_meetings m where m.id=public.try_uuid(new.target_id)) end,
    case when kind='study_resource' then (select s.author_id from public.study_resources s where s.id=public.try_uuid(new.target_id)) end,
    case when exists(select 1 from auth.users u where u.id=public.try_uuid(new.target_id)) then public.try_uuid(new.target_id) end
  );
  new.reported_user_id_snapshot:=coalesce(new.reported_user_id_snapshot,owner_id);
  if owner_id is not null then
    select coalesce(p.full_name,u.raw_user_meta_data->>'full_name',u.raw_user_meta_data->>'name',split_part(u.email,'@',1)),
      coalesce(p.username,u.raw_user_meta_data->>'user_name',split_part(u.email,'@',1)),
      case when coalesce(i.email_verified_at,u.email_confirmed_at) is not null then coalesce(i.normalized_email,lower(u.email)) end,
      case when coalesce(i.phone_validated_at,i.phone_verified_at,u.phone_confirmed_at) is not null then coalesce(i.phone_e164,u.phone) end
    into new.reported_display_name_snapshot,new.reported_username_snapshot,new.reported_email_snapshot,new.reported_phone_snapshot
    from auth.users u left join public.profiles p on p.id=u.id left join public.private_user_identities i on i.user_id=u.id where u.id=owner_id;
  end if;
  new.reported_content_snapshot:=coalesce(new.reported_content_snapshot,
    case when kind in ('profile','user') then (select coalesce(p.bio,p.full_name) from public.profiles p where p.id=owner_id) end,
    case when kind='post' then (select left(concat_ws(' — ',p.title,p.body),1200) from public.posts p where p.id=public.try_uuid(new.target_id)) end,
    case when kind in ('comment','reply') then (select left(c.body,1200) from public.comments c where c.id=public.try_uuid(new.target_id)) end,
    case when kind='circle' then (select left(concat_ws(' — ',c.name,c.description),1200) from public.circles c where c.id=public.try_uuid(new.target_id)) end,
    case when kind='message' then (select left(m.body,1200) from public.messages m where m.id=public.try_uuid(new.target_id)) end,
    case when kind='circle_message' then (select left(m.body,1200) from public.circle_messages m where m.id=public.try_bigint(new.target_id)) end,
    case when kind='gallery' then (select left(concat_ws(' — ',g.caption_en,g.caption_ar),1200) from public.gallery_items g where g.id=public.try_bigint(new.target_id)) end,
    case when kind='article' then (select left(concat_ws(' — ',a.title_en,a.title_ar,a.excerpt_en,a.excerpt_ar),1200) from public.articles a where a.id=public.try_bigint(new.target_id)) end,
    case when kind='meeting' then (select left(concat_ws(' — ',m.title,m.description),1200) from public.circle_meetings m where m.id=public.try_uuid(new.target_id)) end,
    case when kind='study_resource' then (select left(concat_ws(' — ',s.title,s.description,s.external_url),1200) from public.study_resources s where s.id=public.try_uuid(new.target_id)) end
  ); return new;
end;
$$;
revoke all on function public.capture_report_snapshot() from public,anon,authenticated;
