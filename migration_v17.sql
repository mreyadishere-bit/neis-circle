-- NEIS Circle v17: Google-first authentication with required post-login mobile registration.
-- Phone ownership is not claimed; the number is normalized and validated server-side.
begin;

update public.platform_security_settings
set email_otp_signup_required=false,updated_at=now()
where singleton=true;

alter table public.signup_validation_events
  drop constraint if exists signup_validation_events_action_check;
alter table public.signup_validation_events
  add constraint signup_validation_events_action_check
  check(action in ('validate','otp_send','register_mobile'));

-- Google is the only supported account-entry method. Phone collection happens after OAuth.
create or replace function public.enforce_new_auth_identity()
returns trigger language plpgsql security definer set search_path=public,auth as $$
declare normalized_email_value text; provider_value text;
begin
  normalized_email_value:=lower(trim(coalesce(new.email,'')));
  provider_value:=coalesce(new.raw_app_meta_data->>'provider','');
  if normalized_email_value='' then raise exception 'identity_unavailable'; end if;
  if provider_value<>'google' then raise exception 'google_auth_required'; end if;
  if exists(select 1 from public.blocked_accounts b
            where lower(coalesce(b.email,''))=normalized_email_value) then
    raise exception 'identity_unavailable';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_new_auth_identity_trigger on auth.users;
create trigger enforce_new_auth_identity_trigger
before insert on auth.users for each row execute function public.enforce_new_auth_identity();

-- Ensure every Google user gets a private identity record even before adding a phone.
create or replace function public.sync_private_identity()
returns trigger language plpgsql security definer set search_path=public,auth as $$
begin
  if new.email is null then return new; end if;
  insert into public.private_user_identities(
    user_id,normalized_email,email_verified_at,phone_e164,phone_validated_at,
    phone_verified_at,verification_required,registered_at,updated_at
  ) values (
    new.id,lower(new.email),new.email_confirmed_at,null,null,null,true,now(),now()
  ) on conflict (user_id) do update set
    normalized_email=excluded.normalized_email,
    email_verified_at=coalesce(excluded.email_verified_at,public.private_user_identities.email_verified_at),
    updated_at=now();
  return new;
end;
$$;

create unique index if not exists private_identity_phone_unique
  on public.private_user_identities(phone_e164) where phone_e164 is not null;

create or replace function public.identity_verification_status()
returns jsonb language sql stable security definer set search_path=public,auth as $$
  select jsonb_build_object(
    'email_verified',i.email_verified_at is not null,
    'phone_required',i.phone_validated_at is null,
    'phone_validated',i.phone_validated_at is not null,
    'phone_masked',case when i.phone_e164 is null then '' else left(i.phone_e164,3)||repeat('•',greatest(length(i.phone_e164)-7,2))||right(i.phone_e164,4) end,
    'registered_at',i.registered_at,
    'phone_registered_at',i.phone_validated_at
  )
  from public.private_user_identities i
  where i.user_id=auth.uid();
$$;

grant execute on function public.identity_verification_status() to authenticated;

delete from public.signup_identity_tickets where expires_at<now();
delete from public.signup_validation_events where created_at<now()-interval '7 days';

commit;
select 'NEIS Circle v17 Google-first mobile registration ready' as result;
