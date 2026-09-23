-- NEIS Circle v18 — secure message deletion, per-user chat removal and resolved-report cleanup.
begin;

alter table public.conversation_members add column if not exists hidden_at timestamptz;

create or replace function public.delete_direct_message(message_id_input uuid)
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

create or replace function public.hide_conversation_for_me(conversation_id_input uuid)
returns boolean language plpgsql security definer set search_path=public,auth as $$
declare changed boolean:=false;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  update public.conversation_members set hidden_at=now()
   where conversation_id=conversation_id_input and user_id=auth.uid()
  returning true into changed;
  return coalesce(changed,false);
end;
$$;

create or replace function public.restore_own_conversation(conversation_id_input uuid)
returns boolean language plpgsql security definer set search_path=public,auth as $$
declare changed boolean:=false;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  update public.conversation_members set hidden_at=null
   where conversation_id=conversation_id_input and user_id=auth.uid()
  returning true into changed;
  return coalesce(changed,false);
end;
$$;

create or replace function public.restore_conversation_after_message()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  update public.conversation_members set hidden_at=null where conversation_id=new.conversation_id;
  return new;
end;
$$;
drop trigger if exists restore_conversation_after_message_trigger on public.messages;
create trigger restore_conversation_after_message_trigger
after insert on public.messages for each row execute function public.restore_conversation_after_message();

create or replace function public.admin_delete_resolved_report(report_id_input uuid)
returns boolean language plpgsql security definer set search_path=public,auth as $$
declare changed boolean:=false;
begin
  if not public.is_admin() then raise exception 'administrator_required'; end if;
  delete from public.reports
   where id=report_id_input and lower(status::text)='resolved'
  returning true into changed;
  if changed then
    insert into public.moderation_actions(admin_id,action,target_type,target_id,reason)
    values(auth.uid(),'delete_resolved_report','report',report_id_input::text,'Resolved report removed');
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
      case when r.target_type in ('profile','user') then coalesce(rp.bio,rp.full_name,ru.raw_user_meta_data->>'full_name') end,
      case when r.target_type='post' then (select left(concat_ws(' — ',p.title,p.body),1200) from public.posts p where p.id=public.try_uuid(r.target_id)) end,
      case when r.target_type in ('comment','reply') then (select left(c.body,1200) from public.comments c where c.id=public.try_uuid(r.target_id)) end,
      case when r.target_type='circle' then (select left(concat_ws(' — ',c.name,c.description),1200) from public.circles c where c.id=public.try_uuid(r.target_id)) end,
      case when r.target_type='message' then (select left(m.body,1200) from public.messages m where m.id=public.try_uuid(r.target_id)) end,
      case when r.target_type='circle_message' then (select left(m.body,1200) from public.circle_messages m where m.id=public.try_bigint(r.target_id)) end,
      case when r.target_type='gallery' then (select left(concat_ws(' — ',g.caption_en,g.caption_ar),1200) from public.gallery_items g where g.id=public.try_bigint(r.target_id)) end,
      case when r.target_type='article' then (select left(concat_ws(' — ',a.title_en,a.title_ar,a.excerpt_en,a.excerpt_ar),1200) from public.articles a where a.id=public.try_bigint(r.target_id)) end,
      case when r.target_type='meeting' then (select left(concat_ws(' — ',m.title,m.description),1200) from public.circle_meetings m where m.id=public.try_uuid(r.target_id)) end,
      '[Content unavailable]'
    ),owner_data.owner_id,
    coalesce(rp.full_name,ru.raw_user_meta_data->>'full_name',ru.raw_user_meta_data->>'name',split_part(ru.email,'@',1)),
    coalesce(rp.username,ru.raw_user_meta_data->>'user_name',split_part(ru.email,'@',1)),
    case when coalesce(ri.email_verified_at,ru.email_confirmed_at) is not null then coalesce(ri.normalized_email,lower(ru.email)) end,
    case when ri.phone_validated_at is not null then ri.phone_e164 end,
    coalesce(ri.email_verified_at,ru.email_confirmed_at) is not null,ri.phone_validated_at is not null,
    r.reporter_id,
    coalesce(reporter.full_name,reporter_auth.raw_user_meta_data->>'full_name',split_part(reporter_auth.email,'@',1)),
    coalesce(reporter.username,reporter_auth.raw_user_meta_data->>'user_name',split_part(reporter_auth.email,'@',1))
  from public.reports r
  cross join lateral (select coalesce(
    case when r.target_type in ('profile','user') then public.try_uuid(r.target_id) end,
    case when r.target_type='post' then (select p.author_id from public.posts p where p.id=public.try_uuid(r.target_id)) end,
    case when r.target_type in ('comment','reply') then (select c.author_id from public.comments c where c.id=public.try_uuid(r.target_id)) end,
    case when r.target_type='circle' then (select c.owner_id from public.circles c where c.id=public.try_uuid(r.target_id)) end,
    case when r.target_type='message' then (select m.sender_id from public.messages m where m.id=public.try_uuid(r.target_id)) end,
    case when r.target_type='circle_message' then (select m.sender_id from public.circle_messages m where m.id=public.try_bigint(r.target_id)) end,
    case when r.target_type='gallery' then (select g.author_id from public.gallery_items g where g.id=public.try_bigint(r.target_id)) end,
    case when r.target_type='article' then (select a.author_id from public.articles a where a.id=public.try_bigint(r.target_id)) end,
    case when r.target_type='meeting' then (select m.creator_id from public.circle_meetings m where m.id=public.try_uuid(r.target_id)) end
  ) owner_id) owner_data
  left join public.profiles rp on rp.id=owner_data.owner_id
  left join auth.users ru on ru.id=owner_data.owner_id
  left join public.private_user_identities ri on ri.user_id=owner_data.owner_id
  left join public.profiles reporter on reporter.id=r.reporter_id
  left join auth.users reporter_auth on reporter_auth.id=r.reporter_id
  where public.is_admin() order by r.created_at desc;
$$;

revoke all on function public.delete_direct_message(uuid),public.hide_conversation_for_me(uuid),public.restore_own_conversation(uuid),public.admin_delete_resolved_report(uuid) from public,anon;
grant execute on function public.delete_direct_message(uuid),public.hide_conversation_for_me(uuid),public.restore_own_conversation(uuid) to authenticated;
grant execute on function public.admin_delete_resolved_report(uuid),public.admin_report_details() to authenticated;

commit;
select 'NEIS Circle v18 secure chat and report cleanup ready' as result;
