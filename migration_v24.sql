-- NEIS Circle v24 — durable private phone registration and reliable resolved-report deletion.
begin;

alter table public.private_user_identities
  add column if not exists phone_validated_at timestamptz,
  add column if not exists registered_at timestamptz;

-- Recover mobile identities previously written to protected auth metadata or Supabase Auth.
update public.private_user_identities i set
  phone_e164=coalesce(
    i.phone_e164,
    case when u.raw_user_meta_data->>'phone_e164' ~ '^\+[1-9][0-9]{7,14}$' then u.raw_user_meta_data->>'phone_e164' end,
    case when u.phone ~ '^\+[1-9][0-9]{7,14}$' then u.phone end
  ),
  phone_validated_at=coalesce(
    i.phone_validated_at,
    i.phone_verified_at,
    case when lower(coalesce(u.raw_user_meta_data->>'phone_validated','false'))='true' then u.updated_at end,
    u.phone_confirmed_at
  ),
  registered_at=coalesce(i.registered_at,i.created_at,u.created_at),
  updated_at=now()
from auth.users u
where u.id=i.user_id;

create or replace function public.register_own_phone(phone_input text)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare
  member uuid:=auth.uid();
  normalized_phone text:=regexp_replace(coalesce(phone_input,''),'[\s\-().]','','g');
  normalized_email_value text;
  saved_phone text;
  saved_at timestamptz;
begin
  if member is null then raise exception 'authentication_required'; end if;
  if normalized_phone !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'invalid_phone'; end if;

  select lower(trim(email)) into normalized_email_value
  from auth.users where id=member for update;
  if normalized_email_value is null or normalized_email_value='' then raise exception 'identity_unavailable'; end if;

  if exists(select 1 from public.blocked_accounts b where
       b.user_id=member
       or lower(coalesce(b.email,''))=normalized_email_value
       or b.phone_e164=normalized_phone) then
    raise exception 'identity_unavailable';
  end if;
  if exists(select 1 from public.private_user_identities i
            where i.phone_e164=normalized_phone and i.user_id<>member) then
    raise exception 'identity_unavailable';
  end if;

  insert into public.private_user_identities(
    user_id,normalized_email,email_verified_at,phone_e164,phone_validated_at,
    verification_required,registered_at,updated_at
  )
  select member,normalized_email_value,u.email_confirmed_at,normalized_phone,now(),true,now(),now()
  from auth.users u where u.id=member
  on conflict (user_id) do update set
    normalized_email=excluded.normalized_email,
    email_verified_at=coalesce(excluded.email_verified_at,public.private_user_identities.email_verified_at),
    phone_e164=excluded.phone_e164,
    phone_validated_at=now(),
    verification_required=true,
    registered_at=coalesce(public.private_user_identities.registered_at,now()),
    updated_at=now();

  -- A protected backup makes the identity recoverable without exposing it in profiles/public APIs.
  update auth.users set raw_user_meta_data=coalesce(raw_user_meta_data,'{}'::jsonb)||jsonb_build_object(
    'phone_e164',normalized_phone,
    'phone_validated',true,
    'phone_registered_at',now()
  ) where id=member;

  select phone_e164,phone_validated_at into saved_phone,saved_at
  from public.private_user_identities where user_id=member;
  if saved_phone is distinct from normalized_phone or saved_at is null then
    raise exception 'phone_persistence_failed';
  end if;

  return jsonb_build_object(
    'phone_validated',true,
    'phone_masked',left(saved_phone,3)||repeat('•',greatest(length(saved_phone)-7,2))||right(saved_phone,4),
    'validated_at',saved_at
  );
end;
$$;

create or replace function public.identity_verification_status()
returns jsonb language sql stable security definer set search_path=public,auth as $$
  select jsonb_build_object(
    'verification_required',true,
    'email_verified',coalesce(i.email_verified_at,u.email_confirmed_at) is not null,
    'phone_validated',coalesce(i.phone_validated_at,i.phone_verified_at,u.phone_confirmed_at) is not null
      or lower(coalesce(u.raw_user_meta_data->>'phone_validated','false'))='true',
    'phone_masked',case when coalesce(i.phone_e164,u.raw_user_meta_data->>'phone_e164',u.phone) is null then ''
      else left(coalesce(i.phone_e164,u.raw_user_meta_data->>'phone_e164',u.phone),3)
        ||repeat('•',greatest(length(coalesce(i.phone_e164,u.raw_user_meta_data->>'phone_e164',u.phone))-7,2))
        ||right(coalesce(i.phone_e164,u.raw_user_meta_data->>'phone_e164',u.phone),4) end,
    'verified_at',coalesce(i.phone_validated_at,i.phone_verified_at,u.phone_confirmed_at,u.updated_at)
  )
  from auth.users u
  left join public.private_user_identities i on i.user_id=u.id
  where u.id=auth.uid();
$$;

create or replace function public.admin_update_report_status(report_id_input uuid,status_input text)
returns boolean language plpgsql security definer set search_path=public,auth as $$
declare changed boolean:=false; normalized_status text:=lower(trim(status_input));
begin
  if not public.is_admin() then raise exception 'administrator_required'; end if;
  if normalized_status not in ('open','reviewed','resolved','dismissed') then raise exception 'invalid_report_status'; end if;
  update public.reports set status=normalized_status,reviewed_by=auth.uid(),reviewed_at=now()
   where id=report_id_input returning true into changed;
  if changed and exists(select 1 from public.profiles where id=auth.uid()) then
    begin
      insert into public.moderation_actions(admin_id,action,target_type,target_id,reason,metadata)
      values(auth.uid(),'report_status_changed','report',report_id_input::text,normalized_status,jsonb_build_object('status',normalized_status));
    exception when others then null;
    end;
  end if;
  return coalesce(changed,false);
end;
$$;

create or replace function public.admin_delete_resolved_report(report_id_input uuid)
returns boolean language plpgsql security definer set search_path=public,auth as $$
declare changed boolean:=false;
begin
  if not public.is_admin() then raise exception 'administrator_required'; end if;
  delete from public.reports
   where id=report_id_input and lower(trim(status::text))='resolved'
  returning true into changed;
  if changed and exists(select 1 from public.profiles where id=auth.uid()) then
    begin
      insert into public.moderation_actions(admin_id,action,target_type,target_id,reason)
      values(auth.uid(),'delete_resolved_report','report',report_id_input::text,'Resolved report removed');
    exception when others then null;
    end;
  end if;
  return coalesce(changed,false);
end;
$$;

drop policy if exists reports_admin_delete_resolved on public.reports;
create policy reports_admin_delete_resolved on public.reports for delete to authenticated
using (public.is_admin() and lower(trim(status::text))='resolved');

revoke all on function public.register_own_phone(text),public.identity_verification_status(),
  public.admin_update_report_status(uuid,text),public.admin_delete_resolved_report(uuid) from public,anon;
grant execute on function public.register_own_phone(text),public.identity_verification_status(),
  public.admin_update_report_status(uuid,text),public.admin_delete_resolved_report(uuid) to authenticated;

commit;
select 'NEIS Circle v24 phone persistence and report deletion ready' as result;
