-- Keep platform account blocking in its established, audited moderation model.
-- A separate API facade narrows mutations to the founding main administrator only.
begin;
create or replace function public.main_admin_auth_set_block(
  p_user_id uuid,
  p_block boolean,
  p_reason text default null
)
returns jsonb language plpgsql volatile security definer
set search_path = pg_catalog, public, auth
as $function$
declare
  current_user_record record;
  existing_status text;
  already_blocked boolean;
  now_blocked boolean;
  reason_text text := nullif(btrim(coalesce(p_reason,'')),'');
begin
  if auth.uid() is null or auth.role() <> 'authenticated' or not exists(
    select 1 from auth.users u
    join public.profiles owner on owner.id=u.id
    where u.id=auth.uid()
      and u.id='25b556a3-ec6f-49e7-ac6c-1b09720e3bfd'::uuid
      and lower(u.email)='mreyadishere@gmail.com'
      and u.deleted_at is null
      and owner.role='admin'
      and coalesce(owner.account_status,'active')='active'
      and not exists (select 1 from public.blocked_accounts b where b.user_id=u.id or lower(b.email)=lower(u.email))
  ) then
    raise exception 'Only the primary administrator may change account blocks' using errcode='42501';
  end if;

  if p_user_id is null or p_block is null then
    raise exception 'User and action are required' using errcode='22023';
  end if;
  if p_user_id='25b556a3-ec6f-49e7-ac6c-1b09720e3bfd'::uuid
     or p_user_id=auth.uid() then
    raise exception 'Cannot block or unblock primary administrator' using errcode='42501';
  end if;

  select u.id,u.email,coalesce(p.account_status,'active') as account_status
    into current_user_record
    from auth.users u
    left join public.profiles p on p.id=u.id
    where u.id=p_user_id and u.deleted_at is null
    for update of u;
  if not found then
    raise exception 'Account not found' using errcode='P0002';
  end if;
  existing_status:=current_user_record.account_status;
  already_blocked:=existing_status='blocked' or exists (
    select 1 from public.blocked_accounts b
    where b.user_id=p_user_id or lower(b.email)=lower(current_user_record.email)
  );

  -- An account disabled by its owner isn't silently reactivated by Unblock.
  if not p_block and existing_status='deactivated' then
    raise exception 'This account was deactivated and must be restored separately'
      using errcode='22023';
  end if;

  if (p_block and not already_blocked) or (not p_block and already_blocked) then
    perform public.admin_set_account_block(
      target_email => null,
      target_user => p_user_id,
      should_block => p_block,
      block_reason => coalesce(left(reason_text,200),'Blocked by the main administrator')
    );
  end if;

  now_blocked:=exists (
    select 1 from public.profiles p where p.id=p_user_id and p.account_status='blocked'
  ) or exists (
    select 1 from public.blocked_accounts b
    where b.user_id=p_user_id or lower(b.email)=lower(current_user_record.email)
  ) or exists (
    select 1 from auth.users u where u.id=p_user_id and u.banned_until>now()
  );
  return jsonb_build_object('user_id',p_user_id,'blocked',now_blocked,
    'updated',already_blocked<>now_blocked,'status',
    case when now_blocked then 'blocked' else existing_status end);
end;
$function$;

revoke all on function public.main_admin_auth_set_block(uuid,boolean,text)
  from public,anon,authenticated;
grant execute on function public.main_admin_auth_set_block(uuid,boolean,text)
  to authenticated;
commit;
notify pgrst, 'reload schema';
