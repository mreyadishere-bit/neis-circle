-- NEIS Circle v15: secure private-circle join keys.
-- Keys are bcrypt hashed. Plaintext is returned to the owner only when generated.

create extension if not exists pgcrypto;

create table if not exists public.circle_join_secrets (
  circle_id uuid primary key references public.circles(id) on delete cascade,
  key_hash text not null,
  key_hint text not null,
  enabled boolean not null default false,
  rotated_at timestamptz not null default now(),
  rotated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.private_circle_join_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  attempted_name_hash text not null,
  succeeded boolean not null default false,
  attempted_at timestamptz not null default now()
);

create index if not exists private_circle_join_attempts_user_time_idx
  on public.private_circle_join_attempts(user_id, attempted_at desc);

alter table public.circle_join_secrets enable row level security;
alter table public.private_circle_join_attempts enable row level security;
revoke all on public.circle_join_secrets from anon, authenticated;
revoke all on public.private_circle_join_attempts from anon, authenticated;

-- Existing private circles start with key joining disabled. The owner can generate
-- the first shareable key from the management panel.
insert into public.circle_join_secrets(circle_id,key_hash,key_hint,enabled,rotated_by)
select c.id,crypt(encode(gen_random_bytes(24),'hex'),gen_salt('bf',10)),'----',false,c.owner_id
from public.circles c
where c.privacy='private'
on conflict(circle_id) do nothing;

create or replace function public.ensure_private_circle_join_secret()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.privacy='private' then
    insert into public.circle_join_secrets(circle_id,key_hash,key_hint,enabled,rotated_by)
    values(new.id,crypt(encode(gen_random_bytes(24),'hex'),gen_salt('bf',10)),'----',false,new.owner_id)
    on conflict(circle_id) do nothing;
  elsif tg_op='UPDATE' and old.privacy='private' and new.privacy<>'private' then
    update public.circle_join_secrets set enabled=false,updated_at=now() where circle_id=new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists circles_private_join_secret_trigger on public.circles;
create trigger circles_private_join_secret_trigger
after insert or update of privacy on public.circles
for each row execute function public.ensure_private_circle_join_secret();

create or replace function public.private_circle_key_status(target_circle uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not exists(select 1 from public.circles c where c.id=target_circle and c.owner_id=auth.uid() and c.privacy='private') then
    raise exception 'owner_required';
  end if;
  select jsonb_build_object(
    'circle_id',c.id,
    'circle_name',c.name,
    'enabled',coalesce(s.enabled,false),
    'key_hint',coalesce(s.key_hint,'----'),
    'rotated_at',s.rotated_at
  ) into result
  from public.circles c
  left join public.circle_join_secrets s on s.circle_id=c.id
  where c.id=target_circle;
  return result;
end;
$$;

create or replace function public.rotate_private_circle_key(target_circle uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare raw_key text; circle_name_value text;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  select c.name into circle_name_value from public.circles c
  where c.id=target_circle and c.owner_id=auth.uid() and c.privacy='private'
  for update;
  if circle_name_value is null then raise exception 'owner_required'; end if;

  raw_key := 'NC-' || upper(substr(encode(gen_random_bytes(12),'hex'),1,4)) || '-' ||
             upper(substr(encode(gen_random_bytes(12),'hex'),5,4)) || '-' ||
             upper(substr(encode(gen_random_bytes(12),'hex'),9,4));

  insert into public.circle_join_secrets(circle_id,key_hash,key_hint,enabled,rotated_at,rotated_by,updated_at)
  values(target_circle,crypt(raw_key,gen_salt('bf',10)),right(raw_key,4),true,now(),auth.uid(),now())
  on conflict(circle_id) do update set
    key_hash=excluded.key_hash,key_hint=excluded.key_hint,enabled=true,
    rotated_at=now(),rotated_by=auth.uid(),updated_at=now();

  return jsonb_build_object('circle_id',target_circle,'circle_name',circle_name_value,'key',raw_key,'enabled',true);
end;
$$;

create or replace function public.set_private_circle_key_enabled(target_circle uuid, desired_enabled boolean)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not exists(select 1 from public.circles c where c.id=target_circle and c.owner_id=auth.uid() and c.privacy='private') then
    raise exception 'owner_required';
  end if;
  update public.circle_join_secrets
  set enabled=desired_enabled,updated_at=now()
  where circle_id=target_circle;
  if not found then raise exception 'key_not_initialized'; end if;
  return true;
end;
$$;

create or replace function public.join_private_circle_by_key(circle_name_input text,circle_key_input text)
returns uuid language plpgsql security definer set search_path=public as $$
declare
  me uuid:=auth.uid();
  target_circle uuid;
  stored_hash text;
  normalized_name text:=lower(trim(coalesce(circle_name_input,'')));
  supplied_key text:=upper(trim(coalesce(circle_key_input,'')));
  name_fingerprint text;
begin
  if me is null then raise exception 'authentication_required'; end if;
  if not public.account_is_allowed() then raise exception 'account_not_allowed'; end if;
  if char_length(normalized_name)<3 or char_length(supplied_key)<8 then
    raise exception 'circle_name_or_key_incorrect';
  end if;

  -- User-scoped throttling prevents brute-force attempts without collecting IP data.
  if (select count(*) from public.private_circle_join_attempts a
      where a.user_id=me and a.attempted_at>now()-interval '15 minutes') >= 8 then
    return null;
  end if;
  name_fingerprint:=encode(digest(normalized_name,'sha256'),'hex');

  select c.id,s.key_hash into target_circle,stored_hash
  from public.circles c
  join public.circle_join_secrets s on s.circle_id=c.id
  where c.privacy='private' and lower(trim(c.name))=normalized_name and s.enabled=true
  order by c.created_at asc
  limit 1;

  if target_circle is null or stored_hash is null or stored_hash<>crypt(supplied_key,stored_hash) then
    insert into public.private_circle_join_attempts(user_id,attempted_name_hash,succeeded)
    values(me,name_fingerprint,false);
    return null;
  end if;

  if exists(select 1 from public.circle_members m where m.circle_id=target_circle and m.user_id=me and m.status='banned') then
    insert into public.private_circle_join_attempts(user_id,attempted_name_hash,succeeded)
    values(me,name_fingerprint,false);
    return null;
  end if;

  insert into public.circle_members(circle_id,user_id,role,status)
  values(target_circle,me,'member','active')
  on conflict(circle_id,user_id) do update set status='active',role='member';

  insert into public.private_circle_join_attempts(user_id,attempted_name_hash,succeeded)
  values(me,name_fingerprint,true);
  return target_circle;
end;
$$;

grant execute on function public.private_circle_key_status(uuid) to authenticated;
grant execute on function public.rotate_private_circle_key(uuid) to authenticated;
grant execute on function public.set_private_circle_key_enabled(uuid,boolean) to authenticated;
grant execute on function public.join_private_circle_by_key(text,text) to authenticated;

-- Retain only a short abuse-prevention window. This table contains hashes, not names.
delete from public.private_circle_join_attempts where attempted_at<now()-interval '7 days';

select 'NEIS Circle v15 private-circle keys ready' as result;
