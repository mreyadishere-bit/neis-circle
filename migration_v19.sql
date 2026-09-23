-- NEIS Circle v19 — repair direct-message deletion and admin report workflows.
begin;

-- Direct message identifiers are bigint in production. v18 accidentally exposed a uuid RPC.
drop function if exists public.delete_direct_message(uuid);
create or replace function public.delete_direct_message(message_id_input bigint)
returns boolean language plpgsql security definer set search_path=public,auth as $$
declare changed boolean:=false;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  update public.messages
     set body='',deleted_at=coalesce(deleted_at,now())
   where id=message_id_input
     and deleted_at is null
     and (sender_id=auth.uid() or public.is_admin())
  returning true into changed;
  return coalesce(changed,false);
end;
$$;

-- Preserve the reported account/content identity for future moderation, even if content is removed.
alter table public.reports add column if not exists reported_user_id_snapshot uuid;
alter table public.reports add column if not exists reported_display_name_snapshot text;
alter table public.reports add column if not exists reported_username_snapshot text;
alter table public.reports add column if not exists reported_email_snapshot text;
alter table public.reports add column if not exists reported_phone_snapshot text;
alter table public.reports add column if not exists reported_content_snapshot text;

create or replace function public.capture_report_snapshot()
returns trigger language plpgsql security definer set search_path=public,auth as $$
declare
  kind text:=lower(trim(coalesce(new.target_type,'')));
  owner_id uuid;
begin
  owner_id:=coalesce(
    case when kind in ('profile','user') then public.try_uuid(new.target_id) end,
    case when kind='post' then (select p.author_id from public.posts p where p.id=public.try_uuid(new.target_id)) end,
    case when kind in ('comment','reply') then (select c.author_id from public.comments c where c.id=public.try_uuid(new.target_id)) end,
    case when kind='circle' then (select c.owner_id from public.circles c where c.id=public.try_uuid(new.target_id)) end,
    case when kind='message' then (select m.sender_id from public.messages m where m.id=public.try_bigint(new.target_id)) end,
    case when kind='circle_message' then (select m.sender_id from public.circle_messages m where m.id=public.try_bigint(new.target_id)) end,
    case when kind='gallery' then (select g.author_id from public.gallery_items g where g.id=public.try_bigint(new.target_id)) end,
    case when kind='article' then (select a.author_id from public.articles a where a.id=public.try_bigint(new.target_id)) end,
    case when kind='meeting' then (select m.creator_id from public.circle_meetings m where m.id=public.try_uuid(new.target_id)) end,
    case when exists(select 1 from auth.users u where u.id=public.try_uuid(new.target_id)) then public.try_uuid(new.target_id) end
  );

  new.reported_user_id_snapshot:=coalesce(new.reported_user_id_snapshot,owner_id);
  if owner_id is not null then
    select
      coalesce(p.full_name,u.raw_user_meta_data->>'full_name',u.raw_user_meta_data->>'name',split_part(u.email,'@',1)),
      coalesce(p.username,u.raw_user_meta_data->>'user_name',split_part(u.email,'@',1)),
      case when coalesce(i.email_verified_at,u.email_confirmed_at) is not null then coalesce(i.normalized_email,lower(u.email)) end,
      case when coalesce(i.phone_validated_at,i.phone_verified_at,u.phone_confirmed_at) is not null then coalesce(i.phone_e164,u.phone) end
    into new.reported_display_name_snapshot,new.reported_username_snapshot,new.reported_email_snapshot,new.reported_phone_snapshot
    from auth.users u
    left join public.profiles p on p.id=u.id
    left join public.private_user_identities i on i.user_id=u.id
    where u.id=owner_id;
  end if;

  new.reported_content_snapshot:=coalesce(new.reported_content_snapshot,
    case when kind in ('profile','user') then (select coalesce(p.bio,p.full_name) from public.profiles p where p.id=owner_id) end,
    case when kind='post' then (select left(concat_ws(' — ',p.title,p.body),1200) from public.posts p where p.id=public.try_uuid(new.target_id)) end,
    case when kind in ('comment','reply') then (select left(c.body,1200) from public.comments c where c.id=public.try_uuid(new.target_id)) end,
    case when kind='circle' then (select left(concat_ws(' — ',c.name,c.description),1200) from public.circles c where c.id=public.try_uuid(new.target_id)) end,
    case when kind='message' then (select left(m.body,1200) from public.messages m where m.id=public.try_bigint(new.target_id)) end,
    case when kind='circle_message' then (select left(m.body,1200) from public.circle_messages m where m.id=public.try_bigint(new.target_id)) end,
    case when kind='gallery' then (select left(concat_ws(' — ',g.caption_en,g.caption_ar),1200) from public.gallery_items g where g.id=public.try_bigint(new.target_id)) end,
    case when kind='article' then (select left(concat_ws(' — ',a.title_en,a.title_ar,a.excerpt_en,a.excerpt_ar),1200) from public.articles a where a.id=public.try_bigint(new.target_id)) end,
    case when kind='meeting' then (select left(concat_ws(' — ',m.title,m.description),1200) from public.circle_meetings m where m.id=public.try_uuid(new.target_id)) end
  );
  return new;
end;
$$;

drop trigger if exists capture_report_snapshot_trigger on public.reports;
create trigger capture_report_snapshot_trigger
before insert on public.reports for each row execute function public.capture_report_snapshot();

-- Backfill recoverable information for reports created before snapshots existed.
update public.reports set target_type=lower(trim(target_type)) where target_type is distinct from lower(trim(target_type));
update public.reports r set reported_user_id_snapshot=coalesce(
  case when r.target_type in ('profile','user') then public.try_uuid(r.target_id) end,
  case when r.target_type='post' then (select p.author_id from public.posts p where p.id=public.try_uuid(r.target_id)) end,
  case when r.target_type in ('comment','reply') then (select c.author_id from public.comments c where c.id=public.try_uuid(r.target_id)) end,
  case when r.target_type='circle' then (select c.owner_id from public.circles c where c.id=public.try_uuid(r.target_id)) end,
  case when r.target_type='message' then (select m.sender_id from public.messages m where m.id=public.try_bigint(r.target_id)) end,
  case when r.target_type='circle_message' then (select m.sender_id from public.circle_messages m where m.id=public.try_bigint(r.target_id)) end,
  case when r.target_type='gallery' then (select g.author_id from public.gallery_items g where g.id=public.try_bigint(r.target_id)) end,
  case when r.target_type='article' then (select a.author_id from public.articles a where a.id=public.try_bigint(r.target_id)) end,
  case when r.target_type='meeting' then (select m.creator_id from public.circle_meetings m where m.id=public.try_uuid(r.target_id)) end,
  case when exists(select 1 from auth.users u where u.id=public.try_uuid(r.target_id)) then public.try_uuid(r.target_id) end
) where r.reported_user_id_snapshot is null;

update public.reports r set
  reported_display_name_snapshot=coalesce(r.reported_display_name_snapshot,p.full_name,u.raw_user_meta_data->>'full_name',u.raw_user_meta_data->>'name',split_part(u.email,'@',1)),
  reported_username_snapshot=coalesce(r.reported_username_snapshot,p.username,u.raw_user_meta_data->>'user_name',split_part(u.email,'@',1)),
  reported_email_snapshot=coalesce(r.reported_email_snapshot,case when coalesce(i.email_verified_at,u.email_confirmed_at) is not null then coalesce(i.normalized_email,lower(u.email)) end),
  reported_phone_snapshot=coalesce(r.reported_phone_snapshot,case when coalesce(i.phone_validated_at,i.phone_verified_at,u.phone_confirmed_at) is not null then coalesce(i.phone_e164,u.phone) end)
from auth.users u
left join public.profiles p on p.id=u.id
left join public.private_user_identities i on i.user_id=u.id
where u.id=r.reported_user_id_snapshot;

create or replace function public.admin_update_report_status(report_id_input uuid,status_input text)
returns boolean language plpgsql security definer set search_path=public,auth as $$
declare changed boolean:=false; normalized_status text:=lower(trim(status_input));
begin
  if not public.is_admin() then raise exception 'administrator_required'; end if;
  if normalized_status not in ('open','reviewed','resolved','dismissed') then raise exception 'invalid_report_status'; end if;
  update public.reports set status=normalized_status,reviewed_by=auth.uid(),reviewed_at=now()
   where id=report_id_input
  returning true into changed;
  if changed then
    insert into public.moderation_actions(admin_id,action,target_type,target_id,reason,metadata)
    values(auth.uid(),'report_status_changed','report',report_id_input::text,normalized_status,jsonb_build_object('status',normalized_status));
  end if;
  return coalesce(changed,false);
end;
$$;

drop function if exists public.admin_report_details();
create or replace function public.admin_report_details()
returns table(
  id uuid,status text,target_type text,target_id text,reason text,details text,created_at timestamptz,
  reported_content text,reported_user_id uuid,reported_display_name text,reported_username text,
  reported_email text,reported_phone text,reported_email_verified boolean,reported_phone_validated boolean,
  reporter_id uuid,reporter_display_name text,reporter_username text
) language sql stable security definer set search_path=public,auth as $$
  select r.id,r.status::text,r.target_type,r.target_id,r.reason,r.details,r.created_at,
    coalesce(
      r.reported_content_snapshot,
      case when r.target_type in ('profile','user') then (select coalesce(px.bio,px.full_name) from public.profiles px where px.id=r.reported_user_id_snapshot) end,
      case when r.target_type='post' then (select left(concat_ws(' — ',px.title,px.body),1200) from public.posts px where px.id=public.try_uuid(r.target_id)) end,
      case when r.target_type in ('comment','reply') then (select left(cx.body,1200) from public.comments cx where cx.id=public.try_uuid(r.target_id)) end,
      case when r.target_type='circle' then (select left(concat_ws(' — ',cx.name,cx.description),1200) from public.circles cx where cx.id=public.try_uuid(r.target_id)) end,
      case when r.target_type='message' then (select left(mx.body,1200) from public.messages mx where mx.id=public.try_bigint(r.target_id)) end,
      case when r.target_type='circle_message' then (select left(mx.body,1200) from public.circle_messages mx where mx.id=public.try_bigint(r.target_id)) end,
      case when r.target_type='gallery' then (select left(concat_ws(' — ',gx.caption_en,gx.caption_ar),1200) from public.gallery_items gx where gx.id=public.try_bigint(r.target_id)) end,
      case when r.target_type='article' then (select left(concat_ws(' — ',ax.title_en,ax.title_ar,ax.excerpt_en,ax.excerpt_ar),1200) from public.articles ax where ax.id=public.try_bigint(r.target_id)) end,
      case when r.target_type='meeting' then (select left(concat_ws(' — ',mx.title,mx.description),1200) from public.circle_meetings mx where mx.id=public.try_uuid(r.target_id)) end,
      '[Content no longer available]'
    ),
    r.reported_user_id_snapshot,
    coalesce(p.full_name,r.reported_display_name_snapshot,u.raw_user_meta_data->>'full_name',u.raw_user_meta_data->>'name',split_part(u.email,'@',1)),
    coalesce(p.username,r.reported_username_snapshot,u.raw_user_meta_data->>'user_name',split_part(u.email,'@',1)),
    coalesce(r.reported_email_snapshot,case when coalesce(i.email_verified_at,u.email_confirmed_at) is not null then coalesce(i.normalized_email,lower(u.email)) end),
    coalesce(r.reported_phone_snapshot,case when coalesce(i.phone_validated_at,i.phone_verified_at,u.phone_confirmed_at) is not null then coalesce(i.phone_e164,u.phone) end),
    (r.reported_email_snapshot is not null or coalesce(i.email_verified_at,u.email_confirmed_at) is not null),
    (r.reported_phone_snapshot is not null or coalesce(i.phone_validated_at,i.phone_verified_at,u.phone_confirmed_at) is not null),
    r.reporter_id,
    coalesce(reporter.full_name,reporter_auth.raw_user_meta_data->>'full_name',split_part(reporter_auth.email,'@',1)),
    coalesce(reporter.username,reporter_auth.raw_user_meta_data->>'user_name',split_part(reporter_auth.email,'@',1))
  from public.reports r
  left join auth.users u on u.id=r.reported_user_id_snapshot
  left join public.profiles p on p.id=r.reported_user_id_snapshot
  left join public.private_user_identities i on i.user_id=r.reported_user_id_snapshot
  left join public.profiles reporter on reporter.id=r.reporter_id
  left join auth.users reporter_auth on reporter_auth.id=r.reporter_id
  where public.is_admin()
  order by r.created_at desc;
$$;

revoke all on function public.delete_direct_message(bigint),public.admin_update_report_status(uuid,text),public.admin_report_details() from public,anon;
grant execute on function public.delete_direct_message(bigint) to authenticated;
grant execute on function public.admin_update_report_status(uuid,text),public.admin_report_details() to authenticated;

commit;
select 'NEIS Circle v19 message and report repair ready' as result;
