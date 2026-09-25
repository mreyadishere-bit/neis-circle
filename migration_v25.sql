-- NEIS Circle v25 — mirror privately registered mobiles into Auth's phone column.
-- The number is registered/format-validated, not OTP-confirmed.
begin;

-- Make existing registered numbers visible in Auth > Users without changing verification status.
update auth.users u
set phone=i.phone_e164,
    updated_at=now()
from public.private_user_identities i
where i.user_id=u.id
  and i.phone_e164 ~ '^\+[1-9][0-9]{7,14}$'
  and u.phone is distinct from i.phone_e164
  and not exists (
    select 1 from auth.users other
    where other.id<>u.id and other.phone=i.phone_e164
  );

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
  if exists(select 1 from auth.users u where u.phone=normalized_phone and u.id<>member) then
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

  update auth.users set
    phone=normalized_phone,
    raw_user_meta_data=coalesce(raw_user_meta_data,'{}'::jsonb)||jsonb_build_object(
      'phone_e164',normalized_phone,
      'phone_validated',true,
      'phone_registered_at',now()
    ),
    updated_at=now()
  where id=member;

  select i.phone_e164,i.phone_validated_at into saved_phone,saved_at
  from public.private_user_identities i
  join auth.users u on u.id=i.user_id and u.phone=i.phone_e164
  where i.user_id=member;
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

revoke all on function public.register_own_phone(text) from public,anon;
grant execute on function public.register_own_phone(text) to authenticated;

commit;
select 'NEIS Circle v25 auth phone synchronization ready' as result;
