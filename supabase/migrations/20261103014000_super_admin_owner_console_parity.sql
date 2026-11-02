-- Adapt selected existing founder-only management RPCs to Super Admins.
-- Exact source functions copied from migrations, with only authorization guards changed.
begin;
-- Delegates owner console function main_admin_server_usage to active Super Admins.
create or replace function public.main_admin_server_usage()
returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, public, auth
as $function$
declare
  latest_record record;
  points jsonb;
  trends jsonb;
  count_24h integer;
begin
  if not public.neis_admin_is_super() then
    raise exception 'Not authorized to access server monitoring' using errcode='42501';
  end if;

  select s.collected_at, s.snapshot into latest_record
    from public.neis_private_server_usage_samples s
    order by s.collected_at desc limit 1;
  if not found then
    return jsonb_build_object('current',null,'history','[]'::jsonb,'trends','[]'::jsonb,
                              'samples_24h',0,'retention_days',30);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
     'at', s.collected_at,
     'cpu', s.snapshot->'cpu',
     'ram', s.snapshot#>'{memory,percent}'
  ) order by s.collected_at),'[]'::jsonb) into points
  from (select collected_at, snapshot
        from public.neis_private_server_usage_samples
        order by collected_at desc limit 120) s;

  -- Return one verified observation per six-hour window, not 43,200 minute-level rows.
  select coalesce(jsonb_agg(jsonb_build_object(
     'at', s.collected_at,
     'disk_used_gib',s.snapshot#>'{disk,used_gib}',
     'disk_total_gib',s.snapshot#>'{disk,total_gib}',
     'database_bytes',s.snapshot->'database_bytes'
  ) order by s.collected_at),'[]'::jsonb) into trends
  from (
     select collected_at, snapshot from (
       select distinct on (date_bin('6 hours', collected_at, '2000-01-01'::timestamptz))
         collected_at, snapshot
       from public.neis_private_server_usage_samples
       where collected_at >= now() - interval '30 days'
       order by date_bin('6 hours',collected_at,'2000-01-01'::timestamptz), collected_at desc
     ) buckets
     order by collected_at desc limit 120
  ) s;

  select count(*) into count_24h
    from public.neis_private_server_usage_samples
    where collected_at >= now() - interval '24 hours';

  return jsonb_build_object(
    'current',latest_record.snapshot||jsonb_build_object('at',latest_record.collected_at),
    'history',points,'trends',trends,
    'samples_24h',count_24h,'retention_days',30);
end;
$function$;

-- Delegates owner console function main_admin_auth_overview to active Super Admins.
create or replace function public.main_admin_auth_overview()
returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, public, auth
as $fn$
declare stats jsonb;
begin
  if not public.neis_admin_is_super() then raise exception 'Not authorized' using errcode='42501'; end if;
  select jsonb_build_object(
    'total',count(*),
    'confirmed',count(*) filter (where u.email_confirmed_at is not null or u.confirmed_at is not null),
    'pending',count(*) filter (where u.email_confirmed_at is null and u.confirmed_at is null),
    'blocked',count(*) filter (where u.banned_until>now() or coalesce(p.account_status,'active')<>'active'),
    'signed_in_30d',count(*) filter (where u.last_sign_in_at>=now()-interval '30 days'),
    'new_7d',count(*) filter (where u.created_at>=now()-interval '7 days'),
    'profiles',count(p.id),
    'onboarded',count(*) filter (where p.onboarding_complete=true),
    'google',count(*) filter (where exists (select 1 from auth.identities i where i.user_id=u.id and i.provider='google'))
  ) into stats from auth.users u
    left join public.profiles p on p.id=u.id
    where u.deleted_at is null;
  return stats;
end;$fn$;

-- Delegates owner console function main_admin_auth_user_detail to active Super Admins.
create or replace function public.main_admin_auth_user_detail(p_user_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, public, auth
as $fn$
declare result jsonb;
begin
  if not public.neis_admin_is_super() then raise exception 'Not authorized' using errcode='42501'; end if;

  select jsonb_build_object(
    'user_id',u.id,'email',u.email,'created_at',u.created_at,
    'last_sign_in_at',u.last_sign_in_at,'confirmed_at',coalesce(u.email_confirmed_at,u.confirmed_at),
    'banned_until',u.banned_until,'is_anonymous',u.is_anonymous,
    'providers',(select coalesce(jsonb_agg(distinct i.provider),'[]'::jsonb)
                 from auth.identities i where i.user_id=u.id),
    'profile',case when p.id is null then null else jsonb_build_object(
      'full_name',p.full_name,'username',p.username,'grade',p.grade,'branch',p.branch,
      'campus',p.campus,'graduation_year',p.graduation_year,'role',p.role,
      'account_status',p.account_status,'onboarding_complete',p.onboarding_complete,
      'verified',p.verified,'bio',p.bio,'interests',p.interests,'skills',p.skills,
      'created_at',p.created_at,'updated_at',p.updated_at
    ) end,
    'posts_count',(select count(*) from public.posts x where x.author_id=u.id)
  ) into result
  from auth.users u
  left join public.profiles p on p.id=u.id
  where u.id=p_user_id and u.deleted_at is null;
  return result;
end;$fn$;

-- Delegates owner console function main_admin_auth_users to active Super Admins.
create or replace function public.main_admin_auth_users(
  p_search text,
  p_filter text,
  p_sort text,
  p_limit integer,
  p_offset integer,
  p_search_field text,
  p_provider text
) returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, public, auth
as $fn$
declare
  q text := left(btrim(coalesce(p_search,'')),100);
  f text := lower(coalesce(p_filter,'all'));
  ordering text := lower(coalesce(p_sort,'created_desc'));
  field text := lower(coalesce(p_search_field,'all'));
  provider_filter text := lower(coalesce(p_provider,'all'));
  page_size integer := least(50,greatest(1,coalesce(p_limit,20)));
  page_start integer := least(100000,greatest(0,coalesce(p_offset,0)));
  total_count bigint;
  records jsonb;
begin
  if not public.neis_admin_is_super() then
    raise exception 'Access denied to authentication console' using errcode='42501';
  end if;
  if f not in ('all','confirmed','pending','blocked','admins','no_profile','signed_in_30d')
    or field not in ('all','id','email','phone','name')
    or provider_filter not in ('all','google','other')
    or ordering not in (
      'created_desc','created_asc','last_sign_in_desc','last_sign_in_asc',
      'email_asc','email_desc','name_asc'
    )
  then raise exception 'Invalid search/filter/sort option' using errcode='22023'; end if;

  with filtered as (
    select
      u.id as user_id,
      u.email,u.phone,
      coalesce(nullif(p.full_name,''),nullif(u.raw_user_meta_data->>'full_name',''),
        nullif(u.raw_user_meta_data->>'name',''),'—') as display_name,
      p.username,p.grade,p.branch,p.campus,p.role,p.account_status,
      (p.id is not null) as has_profile,
      (u.email_confirmed_at is not null or u.confirmed_at is not null) as confirmed,
      (u.banned_until > now()) as banned,
      (u.is_anonymous is true) as is_anonymous,
      u.created_at,u.last_sign_in_at,
      exists(select 1 from auth.identities i where i.user_id=u.id and i.provider='google') as google_provider,
      (select coalesce(array_agg(distinct i.provider order by i.provider),array[]::text[])
        from auth.identities i where i.user_id=u.id) as providers
    from auth.users u
      left join public.profiles p on p.id=u.id
    where u.deleted_at is null
      and (
        q='' or
        (field in ('all','id') and u.id::text ilike '%'||q||'%') or
        (field in ('all','email') and u.email ilike '%'||q||'%') or
        (field in ('all','phone') and u.phone ilike '%'||q||'%') or
        (field in ('all','name') and (
           coalesce(p.full_name,'') ilike '%'||q||'%' or
           coalesce(p.username,'') ilike '%'||q||'%' or
           coalesce(u.raw_user_meta_data->>'full_name','') ilike '%'||q||'%' or
           coalesce(u.raw_user_meta_data->>'name','') ilike '%'||q||'%'
        ))
      )
      and (
        f='all'
        or (f='confirmed' and (u.email_confirmed_at is not null or u.confirmed_at is not null))
        or (f='pending' and u.email_confirmed_at is null and u.confirmed_at is null)
        or (f='blocked' and (u.banned_until>now() or coalesce(p.account_status,'active')<>'active'))
        or (f='admins' and p.role='admin')
        or (f='no_profile' and p.id is null)
        or (f='signed_in_30d' and u.last_sign_in_at>=now()-interval '30 days')
      )
      and (
        provider_filter='all'
        or (provider_filter='google' and exists(
             select 1 from auth.identities i where i.user_id=u.id and i.provider='google'))
        or (provider_filter='other' and not exists(
             select 1 from auth.identities i where i.user_id=u.id and i.provider='google'))
      )
  ),
  numbered as (
    select *, row_number() over (
      order by
        case when ordering='created_asc' then created_at end asc nulls last,
        case when ordering='created_desc' then created_at end desc nulls last,
        case when ordering='last_sign_in_desc' then last_sign_in_at end desc nulls last,
        case when ordering='last_sign_in_asc' then last_sign_in_at end asc nulls last,
        case when ordering='email_asc' then email end asc nulls last,
        case when ordering='email_desc' then email end desc nulls last,
        case when ordering='name_asc' then display_name end asc nulls last,
        user_id desc
    ) as row_no
    from filtered
  )
  select count(*) into total_count from numbered;

  with filtered as (
    select
      u.id as user_id,u.email,u.phone,
      coalesce(nullif(p.full_name,''),nullif(u.raw_user_meta_data->>'full_name',''),
        nullif(u.raw_user_meta_data->>'name',''),'—') as display_name,
      p.username,p.grade,p.branch,p.campus,p.role,p.account_status,
      (p.id is not null) as has_profile,
      (u.email_confirmed_at is not null or u.confirmed_at is not null) as confirmed,
      (u.banned_until > now()) as banned,
      (u.is_anonymous is true) as is_anonymous,
      u.created_at,u.last_sign_in_at,
      exists(select 1 from auth.identities i where i.user_id=u.id and i.provider='google') as google_provider,
      (select coalesce(array_agg(distinct i.provider order by i.provider),array[]::text[])
        from auth.identities i where i.user_id=u.id) as providers
    from auth.users u
      left join public.profiles p on p.id=u.id
    where u.deleted_at is null
      and (
        q='' or
        (field in ('all','id') and u.id::text ilike '%'||q||'%') or
        (field in ('all','email') and u.email ilike '%'||q||'%') or
        (field in ('all','phone') and u.phone ilike '%'||q||'%') or
        (field in ('all','name') and (
           coalesce(p.full_name,'') ilike '%'||q||'%' or
           coalesce(p.username,'') ilike '%'||q||'%' or
           coalesce(u.raw_user_meta_data->>'full_name','') ilike '%'||q||'%' or
           coalesce(u.raw_user_meta_data->>'name','') ilike '%'||q||'%'
        ))
      )
      and (
        f='all'
        or (f='confirmed' and (u.email_confirmed_at is not null or u.confirmed_at is not null))
        or (f='pending' and u.email_confirmed_at is null and u.confirmed_at is null)
        or (f='blocked' and (u.banned_until>now() or coalesce(p.account_status,'active')<>'active'))
        or (f='admins' and p.role='admin')
        or (f='no_profile' and p.id is null)
        or (f='signed_in_30d' and u.last_sign_in_at>=now()-interval '30 days')
      )
      and (
        provider_filter='all'
        or (provider_filter='google' and exists(
             select 1 from auth.identities i where i.user_id=u.id and i.provider='google'))
        or (provider_filter='other' and not exists(
             select 1 from auth.identities i where i.user_id=u.id and i.provider='google'))
      )
  ),
  numbered as (
    select *,row_number() over (
      order by
        case when ordering='created_asc' then created_at end asc nulls last,
        case when ordering='created_desc' then created_at end desc nulls last,
        case when ordering='last_sign_in_desc' then last_sign_in_at end desc nulls last,
        case when ordering='last_sign_in_asc' then last_sign_in_at end asc nulls last,
        case when ordering='email_asc' then email end asc nulls last,
        case when ordering='email_desc' then email end desc nulls last,
        case when ordering='name_asc' then display_name end asc nulls last,
        user_id desc
    ) as row_no
    from filtered
  ),
  page as (
    select * from numbered order by row_no limit page_size offset page_start
  )
  select coalesce(jsonb_agg(to_jsonb(page)-'row_no' order by row_no),'[]'::jsonb)
  into records from page;

  return jsonb_build_object('total',total_count,'users',records,
                            'limit',page_size,'offset',page_start);
end;$fn$;

-- Delegates owner console function main_admin_auth_set_block to active Super Admins.
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
  if not public.neis_admin_is_super() then
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

-- Delegates owner console function main_admin_database_storage to active Super Admins.
create or replace function public.main_admin_database_storage()
returns jsonb
language plpgsql stable security definer
set search_path=pg_catalog,public,auth
as $owner$
declare
  listed jsonb;
  history jsonb;
  current_bytes bigint;
  prev_bytes bigint;
  prev_day date;
  latest_summary timestamptz;
  detail_count bigint;
  sent_outbox_count bigint;
  all_relation_bytes bigint;
begin
  if not public.neis_admin_is_super() then raise exception 'Main admin only' using errcode='42501'; end if;

  select pg_database_size(current_database()) into current_bytes;
  with sizes as (
    select n.nspname,c.relname,
     pg_total_relation_size(c.oid)::bigint as total,
     pg_relation_size(c.oid)::bigint as data,
     pg_indexes_size(c.oid)::bigint as indexes
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where c.relkind='r' and n.nspname in ('public','auth','storage')
  )
  select coalesce(jsonb_agg(jsonb_build_object(
     'schema',t.nspname,'table',t.relname,
     'bytes',t.total,'data_bytes',t.data,'index_bytes',t.indexes
     ) order by t.total desc),'[]'::jsonb)
    into listed from (
      select * from sizes order by total desc,nspname,relname limit 15
    ) t;

  select coalesce(sum(pg_total_relation_size(c.oid)),0)::bigint
  into all_relation_bytes
  from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where c.relkind='r' and n.nspname in ('public','auth','storage');

  select coalesce(jsonb_agg(jsonb_build_object(
    'day',d.day,'bytes',d.database_bytes,'at',d.recorded_at
    ) order by d.day),'[]'::jsonb)
  into history
  from (
    select day,database_bytes,recorded_at
    from public.neis_private_storage_daily
    order by day desc limit 90
  ) d;

  select database_bytes,day into prev_bytes,prev_day
    from public.neis_private_storage_daily
    where day<(now() at time zone 'UTC')::date
    order by day desc limit 1;
  select max(recorded_at) into latest_summary from public.neis_private_storage_daily;
  select count(*) into detail_count from public.neis_private_server_usage_samples;
  select count(*) into sent_outbox_count from public.email_notification_outbox where status='sent';

  return jsonb_build_object(
    'database_bytes',current_bytes,
    'relations_bytes',all_relation_bytes,
    'tables',listed,
    'history',history,
    'previous_day',prev_day,
    'previous_bytes',prev_bytes,
    'daily_change_bytes',case when prev_bytes is null then null else current_bytes-prev_bytes end,
    'detail_samples',detail_count,
    'sent_outbox_count',sent_outbox_count,
    'detail_retention_hours',24,
    'summary_retention_days',90,
    'sent_outbox_retention_days',30,
    'manual_outbox_retention_days',90,
    'last_summary_at',latest_summary
  );
end;
$owner$;
-- Super admins retain bounded, audited DM safety-review workflow.
create or replace function public.admin_search_dm_users(search_input text)
returns table (user_id uuid, full_name text, username text, branch text, grade text)
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare normalized text := btrim(coalesce(search_input,''));
begin
  if not public.neis_admin_is_super() then raise exception 'Not authorized' using errcode='42501'; end if;
  if char_length(normalized) < 2 then return; end if;

  return query
  select p.id,p.full_name,p.username,p.branch,p.grade
  from public.profiles p
  where coalesce(p.account_status,'active')='active'
    and (p.full_name ilike '%'||normalized||'%' or coalesce(p.username,'') ilike '%'||normalized||'%')
  order by case when lower(p.full_name)=lower(normalized) then 0 else 1 end,p.full_name
  limit 20;
end;
$$;

-- Super admins retain bounded, audited DM safety-review workflow.
create or replace function public.admin_list_user_dm_conversations(user_id_input uuid)
returns table (
  conversation_id uuid, other_user_id uuid, other_name text, other_username text,
  updated_at timestamptz, message_count bigint, last_message_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if not public.neis_admin_is_super() then raise exception 'Not authorized' using errcode='42501'; end if;

  return query
  select c.id,om.user_id,op.full_name,op.username,c.updated_at,
    (select count(*) from public.messages m where m.conversation_id=c.id and m.deleted_at is null),
    (select max(m.created_at) from public.messages m where m.conversation_id=c.id)
  from public.conversations c
  join public.conversation_members tm on tm.conversation_id=c.id and tm.user_id=user_id_input
  left join public.conversation_members om on om.conversation_id=c.id and om.user_id<>user_id_input
  left join public.profiles op on op.id=om.user_id
  where c.kind='direct'
  order by coalesce((select max(m2.created_at) from public.messages m2 where m2.conversation_id=c.id),c.updated_at) desc
  limit 100;
end;
$$;

-- Super admins retain bounded, audited DM safety-review workflow.
create or replace function public.admin_create_dm_review_request(
  conversation_id_input uuid,target_user_id_input uuid,reason_input text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  request_id uuid;
  normalized_reason text := btrim(coalesce(reason_input,''));
begin
  if not public.neis_admin_is_super() then raise exception 'Not authorized' using errcode='42501'; end if;
  if char_length(normalized_reason) < 3 then raise exception 'A review reason is required' using errcode='22023'; end if;

  perform 1
  from public.conversations c
  join public.conversation_members cm on cm.conversation_id=c.id
  where c.id=conversation_id_input and c.kind='direct' and cm.user_id=target_user_id_input;
  if not found then raise exception 'Conversation is not available for this safety review' using errcode='22023'; end if;

  insert into public.admin_dm_review_requests(admin_id,target_user_id,conversation_id,reason)
  values (auth.uid(),target_user_id_input,conversation_id_input,normalized_reason)
  returning id into request_id;

  insert into public.admin_dm_audit_log(request_id,admin_id,action,target_user_id,conversation_id,details)
  values (request_id,auth.uid(),'request',target_user_id_input,conversation_id_input,jsonb_build_object('reason',normalized_reason));
  return request_id;
end;
$$;

-- Super admins retain bounded, audited DM safety-review workflow.
create or replace function public.admin_get_dm_review_messages(request_id_input uuid)
returns table (
  message_id uuid,sender_id uuid,sender_name text,sender_username text,body text,
  created_at timestamptz,edited_at timestamptz,deleted_at timestamptz,
  attachment_url text,reply_to_id uuid
)
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare review public.admin_dm_review_requests%rowtype;
begin
  if not public.neis_admin_is_super() then raise exception 'Not authorized' using errcode='42501'; end if;

  select * into review
  from public.admin_dm_review_requests r
  where r.id=request_id_input and r.admin_id=auth.uid() and r.closed_at is null and r.expires_at>now();

  if not found or review.conversation_id is null then
    raise exception 'This safety review request is unavailable or expired' using errcode='42501';
  end if;

  insert into public.admin_dm_audit_log(request_id,admin_id,action,target_user_id,conversation_id,details)
  values (review.id,auth.uid(),'view',review.target_user_id,review.conversation_id,jsonb_build_object('expires_at',review.expires_at));

  return query
  select x.id,x.sender_id,p.full_name,p.username,
    case when x.deleted_at is null then x.body else null end,
    x.created_at,x.edited_at,x.deleted_at,
    case when x.deleted_at is null then x.attachment_url else null end,
    x.reply_to_id
  from (
    select m.* from public.messages m
    where m.conversation_id=review.conversation_id
    order by m.created_at desc
    limit 200
  ) x
  left join public.profiles p on p.id=x.sender_id
  order by x.created_at asc;
end;
$$;
commit;
notify pgrst, 'reload schema';
