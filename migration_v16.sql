-- NEIS Circle v16: email OTP signup plus server-validated registered mobile identity.
-- Supabase Auth sends and verifies the email OTP. Phone ownership is NOT claimed.

begin;

alter table public.private_user_identities
  add column if not exists phone_validated_at timestamptz,
  add column if not exists registered_at timestamptz not null default now();

update public.private_user_identities
set phone_validated_at=coalesce(phone_validated_at,phone_verified_at)
where phone_e164 is not null;

alter table public.platform_security_settings
  add column if not exists email_otp_signup_required boolean not null default true;

create table if not exists public.signup_identity_tickets (
  id uuid primary key default gen_random_uuid(),
  normalized_email text not null,
  phone_e164 text not null,
  expires_at timestamptz not null default now()+interval '10 minutes',
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint signup_ticket_email_normalized check (normalized_email=lower(trim(normalized_email))),
  constraint signup_ticket_phone_format check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$')
);
create index if not exists signup_identity_tickets_email_idx on public.signup_identity_tickets(normalized_email,created_at desc);
create index if not exists signup_identity_tickets_phone_idx on public.signup_identity_tickets(phone_e164,created_at desc);

create table if not exists public.signup_validation_events (
  id bigint generated always as identity primary key,
  identity_hash text not null,
  action text not null check(action in ('validate','otp_send')),
  succeeded boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists signup_validation_events_hash_time_idx
  on public.signup_validation_events(identity_hash,action,created_at desc);

alter table public.signup_identity_tickets enable row level security;
alter table public.signup_validation_events enable row level security;
revoke all on public.signup_identity_tickets from anon,authenticated;
revoke all on public.signup_validation_events from anon,authenticated;

-- Consumes a ticket validated by the server-side libphonenumber Edge Function.
-- This trigger is the final enforcement boundary and cannot be bypassed by the UI.
create or replace function public.enforce_new_auth_identity()
returns trigger language plpgsql security definer set search_path=public,auth as $$
declare ticket_id uuid; ticket_row public.signup_identity_tickets%rowtype; normalized_email_value text;
begin
  normalized_email_value:=lower(trim(coalesce(new.email,'')));
  if normalized_email_value='' then raise exception 'identity_unavailable'; end if;

  begin ticket_id:=(new.raw_user_meta_data->>'signup_ticket')::uuid;
  exception when others then ticket_id:=null; end;
  if ticket_id is null then raise exception 'signup_identity_ticket_required'; end if;

  select * into ticket_row from public.signup_identity_tickets
  where id=ticket_id and consumed_at is null and expires_at>now()
  for update;
  if not found or ticket_row.normalized_email<>normalized_email_value then
    raise exception 'signup_identity_ticket_invalid';
  end if;
  if exists(select 1 from public.private_user_identities i
            where lower(i.normalized_email)=normalized_email_value or i.phone_e164=ticket_row.phone_e164) then
    raise exception 'identity_unavailable';
  end if;
  if exists(select 1 from public.blocked_accounts b
            where lower(coalesce(b.email,''))=normalized_email_value or b.phone_e164=ticket_row.phone_e164) then
    raise exception 'identity_unavailable';
  end if;

  new.raw_user_meta_data:=coalesce(new.raw_user_meta_data,'{}'::jsonb)||jsonb_build_object(
    'phone_e164',ticket_row.phone_e164,
    'phone_validated',true,
    'phone_registered_at',now()
  );
  update public.signup_identity_tickets set consumed_at=now() where id=ticket_id;
  return new;
end;
$$;

drop trigger if exists enforce_new_auth_identity_trigger on auth.users;
create trigger enforce_new_auth_identity_trigger
before insert on auth.users for each row execute function public.enforce_new_auth_identity();

create or replace function public.sync_private_identity()
returns trigger language plpgsql security definer set search_path=public,auth as $$
declare metadata_phone text; metadata_validated boolean;
begin
  if new.email is null then return new; end if;
  metadata_phone:=nullif(new.raw_user_meta_data->>'phone_e164','');
  metadata_validated:=coalesce((new.raw_user_meta_data->>'phone_validated')::boolean,false);
  insert into public.private_user_identities(
    user_id,normalized_email,email_verified_at,phone_e164,phone_validated_at,
    phone_verified_at,verification_required,registered_at,updated_at
  ) values (
    new.id,lower(new.email),new.email_confirmed_at,
    case when metadata_phone ~ '^\+[1-9][0-9]{7,14}$' and metadata_validated then metadata_phone else null end,
    case when metadata_phone ~ '^\+[1-9][0-9]{7,14}$' and metadata_validated then now() else null end,
    null,true,coalesce((new.raw_user_meta_data->>'phone_registered_at')::timestamptz,now()),now()
  ) on conflict (user_id) do update set
    normalized_email=excluded.normalized_email,
    email_verified_at=coalesce(excluded.email_verified_at,public.private_user_identities.email_verified_at),
    phone_e164=coalesce(public.private_user_identities.phone_e164,excluded.phone_e164),
    phone_validated_at=coalesce(public.private_user_identities.phone_validated_at,excluded.phone_validated_at),
    updated_at=now();
  return new;
end;
$$;

create or replace function public.identity_verification_status()
returns jsonb language sql stable security definer set search_path=public,auth as $$
  select jsonb_build_object(
    'verification_required',coalesce(s.email_otp_signup_required,true) and coalesce(i.verification_required,true),
    'email_verified',i.email_verified_at is not null,
    'phone_validated',i.phone_validated_at is not null,
    'phone_masked',case when i.phone_e164 is null then '' else left(i.phone_e164,3)||repeat('•',greatest(length(i.phone_e164)-7,2))||right(i.phone_e164,4) end,
    'verified_at',i.email_verified_at
  )
  from public.private_user_identities i cross join public.platform_security_settings s
  where i.user_id=auth.uid() and s.singleton=true;
$$;

-- Admin report identity: email is verified through Auth OTP; phone is registered/validated.
create or replace function public.admin_report_details()
returns table(
  id uuid,status text,target_type text,target_id text,reason text,details text,created_at timestamptz,
  reported_content text,reported_user_id uuid,reported_display_name text,reported_username text,
  reported_email text,reported_phone text,reported_email_verified boolean,reported_phone_validated boolean,
  reporter_id uuid,reporter_display_name text,reporter_username text
) language sql stable security definer set search_path=public,auth as $$
  select r.id,r.status,r.target_type,r.target_id,r.reason,r.details,r.created_at,
    coalesce(
      case when r.target_type='profile' then rp.full_name end,
      case when r.target_type='post' then (select left(concat_ws(' — ',p.title,p.body),1200) from public.posts p where p.id=public.try_uuid(r.target_id)) end,
      case when r.target_type='comment' then (select left(c.body,1200) from public.comments c where c.id=public.try_uuid(r.target_id)) end,
      case when r.target_type='circle' then (select left(concat_ws(' — ',c.name,c.description),1200) from public.circles c where c.id=public.try_uuid(r.target_id)) end,
      case when r.target_type='message' then (select left(m.body,1200) from public.messages m where m.id=public.try_uuid(r.target_id)) end,
      case when r.target_type='circle_message' then (select left(m.body,1200) from public.circle_messages m where m.id=public.try_bigint(r.target_id)) end,
      case when r.target_type='gallery' then (select left(concat_ws(' — ',g.caption_en,g.caption_ar),1200) from public.gallery_items g where g.id=public.try_bigint(r.target_id)) end,
      case when r.target_type='article' then (select left(concat_ws(' — ',a.title_en,a.title_ar,a.excerpt_en,a.excerpt_ar),1200) from public.articles a where a.id=public.try_bigint(r.target_id)) end,
      case when r.target_type='meeting' then (select left(concat_ws(' — ',m.title,m.description),1200) from public.circle_meetings m where m.id=public.try_uuid(r.target_id)) end,
      '[Content unavailable]'
    ),owner_data.owner_id,rp.full_name,rp.username,
    case when ri.email_verified_at is not null then ri.normalized_email end,
    case when ri.phone_validated_at is not null then ri.phone_e164 end,
    ri.email_verified_at is not null,ri.phone_validated_at is not null,
    r.reporter_id,reporter.full_name,reporter.username
  from public.reports r
  cross join lateral (select coalesce(
    case when r.target_type='profile' then public.try_uuid(r.target_id) end,
    case when r.target_type='post' then (select p.author_id from public.posts p where p.id=public.try_uuid(r.target_id)) end,
    case when r.target_type='comment' then (select c.author_id from public.comments c where c.id=public.try_uuid(r.target_id)) end,
    case when r.target_type='circle' then (select c.owner_id from public.circles c where c.id=public.try_uuid(r.target_id)) end,
    case when r.target_type='message' then (select m.sender_id from public.messages m where m.id=public.try_uuid(r.target_id)) end,
    case when r.target_type='circle_message' then (select m.sender_id from public.circle_messages m where m.id=public.try_bigint(r.target_id)) end,
    case when r.target_type='gallery' then (select g.author_id from public.gallery_items g where g.id=public.try_bigint(r.target_id)) end,
    case when r.target_type='article' then (select a.author_id from public.articles a where a.id=public.try_bigint(r.target_id)) end,
    case when r.target_type='meeting' then (select m.creator_id from public.circle_meetings m where m.id=public.try_uuid(r.target_id)) end
  ) owner_id) owner_data
  left join public.profiles rp on rp.id=owner_data.owner_id
  left join public.private_user_identities ri on ri.user_id=owner_data.owner_id
  left join public.profiles reporter on reporter.id=r.reporter_id
  where public.is_admin() order by r.created_at desc;
$$;

grant execute on function public.identity_verification_status() to authenticated;
grant execute on function public.admin_report_details() to authenticated;

delete from public.signup_identity_tickets where expires_at<now()-interval '1 day';
delete from public.signup_validation_events where created_at<now()-interval '7 days';

commit;
select 'NEIS Circle v16 email OTP and registered mobile identity ready' as result;
