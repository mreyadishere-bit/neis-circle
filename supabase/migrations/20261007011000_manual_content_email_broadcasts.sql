-- Manual content email broadcasts for the primary administrator.
-- Site notifications remain enabled independently; email is sent only when the
-- primary admin explicitly chooses "Email all" for a specific moderation item.

create table if not exists public.admin_content_email_broadcasts (
  content_type text not null,
  content_id text not null,
  sent_at timestamptz not null default now(),
  sent_by uuid not null references public.profiles(id) on delete restrict,
  recipient_count integer not null default 0 check (recipient_count >= 0),
  batch_id uuid not null default gen_random_uuid(),
  primary key (content_type, content_id)
);

alter table public.admin_content_email_broadcasts enable row level security;
revoke all on table public.admin_content_email_broadcasts from anon, authenticated;

-- If the earlier notification matrix migration is ever applied, keep all site
-- notifications on but disable automatic email broadcasts. Email is manual now.
update public.notification_broadcast_settings
set site_enabled=true,
    email_enabled=false,
    updated_at=now()
where true;

create or replace function public.get_admin_content_email_broadcasts()
returns jsonb
language plpgsql
stable
security definer
set search_path=public,auth
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from auth.users u
    join public.profiles p on p.id=u.id
    where u.id=auth.uid()
      and lower(coalesce(u.email,''))='mreyadishere@gmail.com'
      and p.role='admin'
      and coalesce(p.account_status,'active')='active'
  ) then
    raise exception 'not_authorized';
  end if;

  return coalesce((
    select jsonb_object_agg(
      b.content_type||':'||b.content_id,
      jsonb_build_object(
        'sent_at',b.sent_at,
        'recipient_count',b.recipient_count
      )
    )
    from public.admin_content_email_broadcasts b
  ), '{}'::jsonb);
end;
$$;

create or replace function public.admin_preview_content_email_audience(
  content_type_input text,
  content_id_input text
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,auth
as $
declare
  v_type text := lower(trim(coalesce(content_type_input,'')));
  v_id text := trim(coalesce(content_id_input,''));
  v_circle_id uuid;
  v_privacy text;
  v_count integer := 0;
  v_scope text := 'all';
begin
  if auth.uid() is null or not exists (
    select 1 from auth.users u
    join public.profiles p on p.id=u.id
    where u.id=auth.uid()
      and lower(coalesce(u.email,''))='mreyadishere@gmail.com'
      and p.role='admin'
      and coalesce(p.account_status,'active')='active'
  ) then
    raise exception 'not_authorized';
  end if;

  if v_type='post' then
    select p.circle_id into v_circle_id from public.posts p where p.id=public.try_uuid(v_id);
  elsif v_type='reply' then
    select p.circle_id into v_circle_id
    from public.comments c join public.posts p on p.id=c.post_id
    where c.id=public.try_uuid(v_id) and c.deleted_at is null;
  elsif v_type='circle' then
    select c.id,c.privacy into v_circle_id,v_privacy
    from public.circles c where c.id=public.try_uuid(v_id);
    if coalesce(v_privacy,'private')='public' then v_circle_id:=null; end if;
  elsif v_type='meeting' then
    select m.circle_id into v_circle_id from public.circle_meetings m where m.id=public.try_uuid(v_id);
  elsif v_type='circle message' then
    select m.circle_id into v_circle_id from public.circle_messages m
    where m.id=public.try_bigint(v_id) and m.deleted_at is null;
  elsif v_type not in ('gallery','article','opportunity','study resource') then
    raise exception 'unsupported_content_type';
  end if;

  if v_circle_id is not null then
    v_scope:='circle';
    select count(*)::integer into v_count
    from public.circle_members cm
    join auth.users u on u.id=cm.user_id
    join public.profiles p on p.id=cm.user_id
    where cm.circle_id=v_circle_id
      and cm.status='active'
      and coalesce(p.account_status,'active')='active'
      and u.email is not null
      and u.email_confirmed_at is not null;
  else
    select count(*)::integer into v_count
    from auth.users u
    join public.profiles p on p.id=u.id
    where coalesce(p.account_status,'active')='active'
      and u.email is not null
      and u.email_confirmed_at is not null;
  end if;

  return jsonb_build_object('recipient_count',v_count,'scope',v_scope);
end;
$;

create or replace function public.admin_email_content_to_audience(
  content_type_input text,
  content_id_input text,
  force_resend_input boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path=public,auth
as $$
declare
  v_type text := lower(trim(coalesce(content_type_input,'')));
  v_id text := trim(coalesce(content_id_input,''));
  v_subject text;
  v_preview text;
  v_path text;
  v_circle_id uuid;
  v_privacy text;
  v_recipient_count integer := 0;
  v_batch uuid := gen_random_uuid();
  v_existing public.admin_content_email_broadcasts%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from auth.users u
    join public.profiles p on p.id=u.id
    where u.id=auth.uid()
      and lower(coalesce(u.email,''))='mreyadishere@gmail.com'
      and p.role='admin'
      and coalesce(p.account_status,'active')='active'
  ) then
    raise exception 'not_authorized';
  end if;

  if v_type not in ('post','reply','circle','meeting','circle message','gallery','article','opportunity','study resource') then
    raise exception 'unsupported_content_type';
  end if;

  select * into v_existing
  from public.admin_content_email_broadcasts
  where content_type=v_type and content_id=v_id;

  if found and not coalesce(force_resend_input,false) then
    return jsonb_build_object(
      'already_sent',true,
      'sent_at',v_existing.sent_at,
      'recipient_count',v_existing.recipient_count
    );
  end if;

  if v_type='post' then
    select p.circle_id,
           'New post: '||coalesce(nullif(p.title,''),'NEIS Circle'),
           left(coalesce(nullif(p.body,''),'A new post is available on NEIS Circle.'),240),
           case when p.circle_id is null
                then '/#/post/'||p.id::text
                else '/#/circles/'||p.circle_id::text||'/home?post='||p.id::text end
      into v_circle_id,v_subject,v_preview,v_path
    from public.posts p
    where p.id=public.try_uuid(v_id);
  elsif v_type='reply' then
    select p.circle_id,
           'Discussion update on NEIS Circle',
           left(coalesce(nullif(c.body,''),'A new reply is available.'),240),
           case when p.circle_id is null
                then '/#/post/'||p.id::text||'?comment='||c.id::text
                else '/#/circles/'||p.circle_id::text||'/home?post='||p.id::text end
      into v_circle_id,v_subject,v_preview,v_path
    from public.comments c
    join public.posts p on p.id=c.post_id
    where c.id=public.try_uuid(v_id) and c.deleted_at is null;
  elsif v_type='circle' then
    select c.id,c.privacy,
           'Circle: '||coalesce(nullif(c.name,''),'NEIS Circle'),
           left(coalesce(nullif(c.description,''),'A Circle is available on NEIS Circle.'),240),
           '/#/circles/'||c.id::text||'/home'
      into v_circle_id,v_privacy,v_subject,v_preview,v_path
    from public.circles c
    where c.id=public.try_uuid(v_id);
  elsif v_type='meeting' then
    select m.circle_id,
           'Circle meeting: '||coalesce(nullif(m.title,''),'Meeting'),
           left(coalesce(nullif(m.description,''),'A Circle meeting is available.'),240),
           '/#/circles/'||m.circle_id::text||'/meetings?meeting='||m.id::text
      into v_circle_id,v_subject,v_preview,v_path
    from public.circle_meetings m
    where m.id=public.try_uuid(v_id);
  elsif v_type='circle message' then
    select m.circle_id,
           'Circle chat update',
           left(coalesce(nullif(m.body,''),'A Circle message is available.'),240),
           '/#/circles/'||m.circle_id::text||'/chat?message='||m.id::text
      into v_circle_id,v_subject,v_preview,v_path
    from public.circle_messages m
    where m.id=public.try_bigint(v_id) and m.deleted_at is null;
  elsif v_type='gallery' then
    select 'Gallery update on NEIS Circle',
           left(coalesce(nullif(g.caption_en,''),nullif(g.caption_ar,''),'A gallery item is available.'),240),
           '/#/gallery'
      into v_subject,v_preview,v_path
    from public.gallery_items g
    where g.id=public.try_bigint(v_id);
  elsif v_type='article' then
    select 'Article: '||coalesce(nullif(a.title_en,''),nullif(a.title_ar,''),'NEIS Circle'),
           left(coalesce(nullif(a.excerpt_en,''),nullif(a.excerpt_ar,''),'A new article is available.'),240),
           '/#/articles/'||a.id::text
      into v_subject,v_preview,v_path
    from public.articles a
    where a.id=public.try_bigint(v_id);
  elsif v_type='opportunity' then
    select 'Opportunity: '||coalesce(nullif(o.title,''),'NEIS Circle'),
           left(coalesce(nullif(o.description,''),'A new opportunity is available.'),240),
           '/#/opportunities?opportunity='||o.id::text
      into v_subject,v_preview,v_path
    from public.opportunities o
    where o.id=public.try_uuid(v_id);
  elsif v_type='study resource' then
    select 'Study resource: '||coalesce(nullif(r.title,''),'NEIS Circle'),
           left(coalesce(nullif(r.description,''),concat_ws(' · ',r.subject,r.unit),'A new Study resource is available.'),240),
           '/#/study?resource='||r.id::text
      into v_subject,v_preview,v_path
    from public.study_resources r
    where r.id=public.try_uuid(v_id);
  end if;

  if v_subject is null or v_path is null then
    raise exception 'content_not_found';
  end if;

  -- Circle-scoped/private content is never emailed outside its Circle.
  if v_circle_id is not null and (v_type<>'circle' or coalesce(v_privacy,'private')<>'public') then
    insert into public.email_notification_outbox(
      user_id,event_key,event_type,subject,preview,action_path
    )
    select
      u.id,
      'manual-content:'||v_batch::text||':'||u.id::text,
      'admin_post',
      v_subject,
      v_preview,
      v_path
    from public.circle_members cm
    join auth.users u on u.id=cm.user_id
    join public.profiles p on p.id=cm.user_id
    where cm.circle_id=v_circle_id
      and cm.status='active'
      and coalesce(p.account_status,'active')='active'
      and u.email is not null
      and u.email_confirmed_at is not null
    on conflict (event_key) do nothing;
    get diagnostics v_recipient_count = row_count;
  else
    insert into public.email_notification_outbox(
      user_id,event_key,event_type,subject,preview,action_path
    )
    select
      u.id,
      'manual-content:'||v_batch::text||':'||u.id::text,
      'admin_post',
      v_subject,
      v_preview,
      v_path
    from auth.users u
    join public.profiles p on p.id=u.id
    where coalesce(p.account_status,'active')='active'
      and u.email is not null
      and u.email_confirmed_at is not null
    on conflict (event_key) do nothing;
    get diagnostics v_recipient_count = row_count;
  end if;

  insert into public.admin_content_email_broadcasts(
    content_type,content_id,sent_at,sent_by,recipient_count,batch_id
  )
  values(v_type,v_id,now(),auth.uid(),v_recipient_count,v_batch)
  on conflict(content_type,content_id) do update
    set sent_at=excluded.sent_at,
        sent_by=excluded.sent_by,
        recipient_count=excluded.recipient_count,
        batch_id=excluded.batch_id;

  return jsonb_build_object(
    'already_sent',false,
    'recipient_count',v_recipient_count,
    'sent_at',now()
  );
end;
$$;

revoke all on function public.get_admin_content_email_broadcasts() from public,anon;
revoke all on function public.admin_preview_content_email_audience(text,text) from public,anon;
revoke all on function public.admin_email_content_to_audience(text,text,boolean) from public,anon;
grant execute on function public.get_admin_content_email_broadcasts() to authenticated;
grant execute on function public.admin_preview_content_email_audience(text,text) to authenticated;
grant execute on function public.admin_email_content_to_audience(text,text,boolean) to authenticated;
