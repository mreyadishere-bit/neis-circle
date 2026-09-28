-- WhatsApp referral/invite system.
-- Applied to production as migration 20260928080221 whatsapp_referral_invites.

create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;

create table public.user_referral_codes (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  referral_code text not null unique,
  created_at timestamptz not null default now(),
  constraint user_referral_codes_format check (referral_code ~ '^nc-[a-z0-9]{10}$')
);

create table public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references public.profiles(id) on delete cascade,
  referred_user_id uuid not null unique references public.profiles(id) on delete cascade,
  referral_code text not null,
  created_at timestamptz not null default now(),
  constraint referrals_not_self check (referrer_id <> referred_user_id)
);

create index referrals_referrer_created_idx
  on public.referrals(referrer_id, created_at desc);

alter table public.user_referral_codes enable row level security;
alter table public.referrals enable row level security;

create policy "users read own referral code"
on public.user_referral_codes
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "users read own successful referrals"
on public.referrals
for select
to authenticated
using ((select auth.uid()) = referrer_id);

revoke all on public.user_referral_codes from anon, authenticated;
revoke all on public.referrals from anon, authenticated;
grant select on public.user_referral_codes to authenticated;
grant select on public.referrals to authenticated;

create table private.referral_signup_eligibility (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  consumed_at timestamptz
);

revoke all on private.referral_signup_eligibility from public, anon, authenticated;

create or replace function private.mark_referral_signup_eligible()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.referral_signup_eligibility(user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke execute on function private.mark_referral_signup_eligible() from public, anon, authenticated;

drop trigger if exists mark_referral_signup_eligible_trigger on auth.users;
create trigger mark_referral_signup_eligible_trigger
after insert on auth.users
for each row execute function private.mark_referral_signup_eligible();

create or replace function private.referral_summary_impl()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  code text;
  invite_count bigint := 0;
  candidate text;
begin
  if me is null then
    raise exception 'authentication_required';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = me and p.account_status = 'active'
  ) then
    raise exception 'account_not_allowed';
  end if;

  select r.referral_code into code
  from public.user_referral_codes r
  where r.user_id = me;

  if code is null then
    loop
      candidate := 'nc-' || lower(substr(encode(extensions.gen_random_bytes(8), 'hex'), 1, 10));
      begin
        insert into public.user_referral_codes(user_id, referral_code)
        values (me, candidate)
        returning referral_code into code;
        exit;
      exception when unique_violation then
        if exists(select 1 from public.user_referral_codes r where r.user_id = me) then
          select r.referral_code into code
          from public.user_referral_codes r
          where r.user_id = me;
          exit;
        end if;
      end;
    end loop;
  end if;

  select count(*) into invite_count
  from public.referrals r
  where r.referrer_id = me;

  return jsonb_build_object(
    'referral_code', code,
    'successful_invites', invite_count
  );
end;
$$;

create or replace function private.claim_referral_impl(referral_code_input text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  normalized_code text := lower(trim(coalesce(referral_code_input, '')));
  referrer uuid;
  eligibility private.referral_signup_eligibility%rowtype;
  inserted_id uuid;
begin
  if me is null then
    raise exception 'authentication_required';
  end if;

  if normalized_code !~ '^nc-[a-z0-9]{10}$' then
    return jsonb_build_object('status', 'invalid');
  end if;

  select e.* into eligibility
  from private.referral_signup_eligibility e
  where e.user_id = me
  for update;

  if not found then
    return jsonb_build_object('status', 'ineligible');
  end if;

  if eligibility.consumed_at is not null then
    return jsonb_build_object('status', 'already_referred');
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = me
      and p.onboarding_complete = true
      and p.account_status = 'active'
  ) then
    return jsonb_build_object('status', 'onboarding_incomplete');
  end if;

  if exists (
    select 1 from public.referrals r
    where r.referred_user_id = me
  ) then
    update private.referral_signup_eligibility
    set consumed_at = coalesce(consumed_at, now())
    where user_id = me;
    return jsonb_build_object('status', 'already_referred');
  end if;

  select c.user_id into referrer
  from public.user_referral_codes c
  join public.profiles p on p.id = c.user_id
  where c.referral_code = normalized_code
    and p.account_status = 'active';

  if referrer is null then
    return jsonb_build_object('status', 'invalid');
  end if;

  if referrer = me then
    return jsonb_build_object('status', 'self_referral');
  end if;

  insert into public.referrals(referrer_id, referred_user_id, referral_code)
  values (referrer, me, normalized_code)
  on conflict (referred_user_id) do nothing
  returning id into inserted_id;

  if inserted_id is null then
    update private.referral_signup_eligibility
    set consumed_at = coalesce(consumed_at, now())
    where user_id = me;
    return jsonb_build_object('status', 'already_referred');
  end if;

  update private.referral_signup_eligibility
  set consumed_at = now()
  where user_id = me;

  return jsonb_build_object('status', 'claimed');
end;
$$;

revoke execute on function private.referral_summary_impl() from public, anon;
revoke execute on function private.claim_referral_impl(text) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.referral_summary_impl() to authenticated;
grant execute on function private.claim_referral_impl(text) to authenticated;

create or replace function public.referral_summary()
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.referral_summary_impl();
$$;

create or replace function public.claim_referral(referral_code_input text)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.claim_referral_impl(referral_code_input);
$$;

revoke execute on function public.referral_summary() from public, anon;
revoke execute on function public.claim_referral(text) from public, anon;
grant execute on function public.referral_summary() to authenticated;
grant execute on function public.claim_referral(text) to authenticated;
