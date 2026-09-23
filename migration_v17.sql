-- NEIS Circle v17 — Google-first authentication followed by private mobile registration.
-- No email/phone OTP is requested. The mobile number is normalized and validated server-side.
begin;

alter table public.platform_security_settings
  add column if not exists email_otp_signup_required boolean not null default false;

update public.platform_security_settings
set email_otp_signup_required=false, updated_at=now()
where singleton=true;

-- Google creates the account first. The app then blocks access until a mobile
-- number has been registered by the authenticated account.
create or replace function public.enforce_new_auth_identity()
returns trigger language plpgsql security definer set search_path=public,auth as $$
declare normalized_email_value text; provider_value text;
begin
  normalized_email_value:=lower(trim(coalesce(new.email,'')));
  provider_value:=coalesce(new.raw_app_meta_data->>'provider','');
  if normalized_email_value='' then raise exception 'identity_unavailable'; end if;
  if provider_value<>'google' and not (coalesce(new.raw_app_meta_data->'providers','[]'::jsonb) ? 'google') then
    raise exception 'google_sign_in_required';
  end if;
  if exists(select 1 from public.blocked_accounts b where lower(coalesce(b.email,''))=normalized_email_value) then
    raise exception 'identity_unavailable';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_new_auth_identity_trigger on auth.users;
create trigger enforce_new_auth_identity_trigger
before insert on auth.users for each row execute function public.enforce_new_auth_identity();

create or replace function public.sync_private_identity()
returns trigger language plpgsql security definer set search_path=public,auth as $$
begin
  if new.email is null then return new; end if;
  insert into public.private_user_identities(
    user_id,normalized_email,email_verified_at,verification_required,registered_at,updated_at
  ) values (
    new.id,lower(trim(new.email)),new.email_confirmed_at,true,now(),now()
  ) on conflict (user_id) do update set
    normalized_email=excluded.normalized_email,
    email_verified_at=coalesce(excluded.email_verified_at,public.private_user_identities.email_verified_at),
    verification_required=true,
    updated_at=now();
  return new;
end;
$$;

drop trigger if exists sync_private_identity_trigger on auth.users;
create trigger sync_private_identity_trigger
after insert or update of email,email_confirmed_at on auth.users
for each row execute function public.sync_private_identity();

create or replace function public.register_own_phone(phone_input text)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare
  member uuid:=auth.uid();
  normalized_phone text;
  normalized_email_value text;
begin
  if member is null then raise exception 'authentication_required'; end if;
  normalized_phone:=regexp_replace(coalesce(phone_input,''),'[\s\-().]','','g');
  if normalized_phone !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'invalid_phone'; end if;

  select lower(trim(email)) into normalized_email_value from auth.users where id=member;
  if normalized_email_value is null then raise exception 'identity_unavailable'; end if;
  if exists(select 1 from public.blocked_accounts b where
      (b.user_id=member) or lower(coalesce(b.email,''))=normalized_email_value or b.phone_e164=normalized_phone) then
    raise exception 'identity_unavailable';
  end if;
  if exists(select 1 from public.private_user_identities i where i.phone_e164=normalized_phone and i.user_id<>member) then
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
    updated_at=now();

  return jsonb_build_object('phone_validated',true,'phone_masked',left(normalized_phone,3)||repeat('•',greatest(length(normalized_phone)-7,2))||right(normalized_phone,4));
end;
$$;

create or replace function public.identity_verification_status()
returns jsonb language sql stable security definer set search_path=public,auth as $$
  select jsonb_build_object(
    'verification_required',true,
    'email_verified',coalesce(i.email_verified_at,u.email_confirmed_at) is not null,
    'phone_validated',i.phone_validated_at is not null,
    'phone_masked',case when i.phone_e164 is null then '' else left(i.phone_e164,3)||repeat('•',greatest(length(i.phone_e164)-7,2))||right(i.phone_e164,4) end,
    'verified_at',i.phone_validated_at
  )
  from auth.users u left join public.private_user_identities i on i.user_id=u.id
  where u.id=auth.uid();
$$;

revoke all on function public.register_own_phone(text) from public,anon;
grant execute on function public.register_own_phone(text) to authenticated;
grant execute on function public.identity_verification_status() to authenticated;

commit;
select 'NEIS Circle v17 Google-first mobile registration ready' as result;
