alter table public.circle_messages
  add column if not exists pinned_at timestamptz,
  add column if not exists pinned_by uuid references public.profiles(id) on delete set null,
  add column if not exists pin_expires_at timestamptz;

create index if not exists circle_messages_active_pin_idx
  on public.circle_messages(circle_id,pinned_at desc)
  where pinned_at is not null;

create or replace function public.pin_circle_message(message_id_input bigint,duration_minutes_input integer default null)
returns public.circle_messages
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_message public.circle_messages%rowtype;
  v_is_main_admin boolean := false;
  v_can_pin boolean := false;
  v_expires timestamptz := null;
begin
  if auth.uid() is null then raise exception 'Not authorized' using errcode='42501'; end if;

  select exists(
    select 1 from auth.users u
    join public.profiles p on p.id=u.id
    where u.id=auth.uid()
      and lower(coalesce(u.email,''))='mreyadishere@gmail.com'
      and p.role='admin'
      and coalesce(p.account_status,'active')='active'
  ) into v_is_main_admin;

  select * into v_message
  from public.circle_messages
  where id=message_id_input and deleted_at is null;
  if not found then raise exception 'Message not found' using errcode='P0002'; end if;

  select (
    exists(select 1 from public.circles c where c.id=v_message.circle_id and c.owner_id=auth.uid())
    or exists(
      select 1 from public.circle_members cm
      where cm.circle_id=v_message.circle_id
        and cm.user_id=auth.uid()
        and cm.status='active'
        and cm.role in ('owner','admin')
    )
  ) into v_can_pin;

  if not (v_is_main_admin or v_can_pin) then
    raise exception 'Only the Circle owner, Circle admins, or the main admin can pin messages' using errcode='42501';
  end if;

  if duration_minutes_input is not null then
    if duration_minutes_input < 5 or duration_minutes_input > 43200 then
      raise exception 'Pin duration must be between 5 minutes and 30 days' using errcode='22023';
    end if;
    v_expires := now()+make_interval(mins=>duration_minutes_input);
  end if;

  update public.circle_messages
  set pinned_at=now(),pinned_by=auth.uid(),pin_expires_at=v_expires
  where id=message_id_input
  returning * into v_message;

  return v_message;
end;
$$;

create or replace function public.unpin_circle_message(message_id_input bigint)
returns public.circle_messages
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_message public.circle_messages%rowtype;
  v_is_main_admin boolean := false;
  v_can_pin boolean := false;
begin
  if auth.uid() is null then raise exception 'Not authorized' using errcode='42501'; end if;

  select exists(
    select 1 from auth.users u
    join public.profiles p on p.id=u.id
    where u.id=auth.uid()
      and lower(coalesce(u.email,''))='mreyadishere@gmail.com'
      and p.role='admin'
      and coalesce(p.account_status,'active')='active'
  ) into v_is_main_admin;

  select * into v_message from public.circle_messages where id=message_id_input;
  if not found then raise exception 'Message not found' using errcode='P0002'; end if;

  select (
    exists(select 1 from public.circles c where c.id=v_message.circle_id and c.owner_id=auth.uid())
    or exists(
      select 1 from public.circle_members cm
      where cm.circle_id=v_message.circle_id
        and cm.user_id=auth.uid()
        and cm.status='active'
        and cm.role in ('owner','admin')
    )
  ) into v_can_pin;

  if not (v_is_main_admin or v_can_pin) then
    raise exception 'Only the Circle owner, Circle admins, or the main admin can unpin messages' using errcode='42501';
  end if;

  update public.circle_messages
  set pinned_at=null,pinned_by=null,pin_expires_at=null
  where id=message_id_input
  returning * into v_message;

  return v_message;
end;
$$;

revoke all on function public.pin_circle_message(bigint,integer) from public, anon;
revoke all on function public.unpin_circle_message(bigint) from public, anon;
grant execute on function public.pin_circle_message(bigint,integer) to authenticated;
grant execute on function public.unpin_circle_message(bigint) to authenticated;
