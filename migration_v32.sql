-- NEIS Circle v32: focused email events only (no email for direct messages).

drop trigger if exists messages_enqueue_email on public.messages;
drop function if exists public.enqueue_direct_message_email();
delete from public.email_notification_outbox
where event_type = 'direct_message' and status in ('pending','failed','sending');

alter table public.email_notification_outbox
  drop constraint if exists email_notification_outbox_event_type_check;
alter table public.email_notification_outbox
  add constraint email_notification_outbox_event_type_check
  check (event_type in ('admin_post','admin_article','important_activity','important_opportunity'));

create or replace function public.enqueue_important_notification_email()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare normalized_route text;
begin
  if new.type not in (
    'reply','article_reply','comment_reply',
    'circle_invite','circle_invitation','membership_request',
    'membership_accepted','membership_rejected','membership_updated'
  ) then
    return new;
  end if;

  normalized_route := coalesce(nullif(trim(both '/' from new.route),''),'notifications');
  insert into public.email_notification_outbox(user_id,event_key,event_type,subject,preview,action_path)
  values (
    new.user_id,
    'notification:' || new.id::text || ':' || new.user_id::text,
    'important_activity',
    coalesce(nullif(new.title,''),'Important activity on NEIS Circle') || ' · نشاط مهم',
    left(coalesce(new.body,'Open NEIS Circle to view the update.'),240),
    '/#/' || normalized_route
  )
  on conflict (event_key) do nothing;
  return new;
end;
$$;

drop trigger if exists notifications_enqueue_important_email on public.notifications;
create trigger notifications_enqueue_important_email
after insert on public.notifications
for each row execute function public.enqueue_important_notification_email();

create or replace function public.notify_circle_membership_change()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare circle_name text;
declare student_name text;
declare target_circle_id uuid;
begin
  if tg_op = 'DELETE' then target_circle_id := old.circle_id; else target_circle_id := new.circle_id; end if;
  select c.name into circle_name from public.circles c where c.id = target_circle_id;

  if tg_op = 'INSERT' and new.status = 'pending' then
    select coalesce(nullif(p.full_name,''),nullif(p.username,''),'A student') into student_name
    from public.profiles p where p.id = new.user_id;
    insert into public.notifications(user_id,actor_id,type,title,body,entity_type,entity_id,route)
    select cm.user_id,new.user_id,'membership_request','New Circle membership request',
           coalesce(student_name,'A student') || ' requested to join “' || coalesce(circle_name,'your Circle') || '”.',
           'circle',new.circle_id::text,'circles/' || new.circle_id::text || '/members'
    from public.circle_members cm
    where cm.circle_id = new.circle_id
      and cm.status = 'active'
      and cm.role in ('owner','admin','moderator')
      and cm.user_id <> new.user_id;
  elsif tg_op = 'UPDATE' and old.status is distinct from new.status and old.status = 'pending' then
    insert into public.notifications(user_id,type,title,body,entity_type,entity_id,route)
    values (
      new.user_id,
      case when new.status = 'active' then 'membership_accepted' else 'membership_updated' end,
      case when new.status = 'active' then 'Circle request accepted' else 'Circle membership updated' end,
      case when new.status = 'active'
        then 'You can now participate in “' || coalesce(circle_name,'the Circle') || '”.'
        else 'Your membership status changed in “' || coalesce(circle_name,'the Circle') || '”.' end,
      'circle',new.circle_id::text,'circles/' || new.circle_id::text || '/home'
    );
  elsif tg_op = 'DELETE' and old.status = 'pending' then
    insert into public.notifications(user_id,type,title,body,entity_type,entity_id,route)
    values (
      old.user_id,'membership_rejected','Circle request update',
      'Your membership request for “' || coalesce(circle_name,'the Circle') || '” was not accepted.',
      'circle',old.circle_id::text,'circles'
    );
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists circle_members_notify_email_activity on public.circle_members;
create trigger circle_members_notify_email_activity
after insert or update of status or delete on public.circle_members
for each row execute function public.notify_circle_membership_change();

alter table public.opportunities add column if not exists is_important boolean not null default false;

create or replace function public.protect_important_opportunity_flag()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if new.is_important is true and not exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'
  ) then
    new.is_important := case when tg_op = 'UPDATE' then old.is_important else false end;
  end if;
  return new;
end;
$$;

drop trigger if exists opportunities_protect_important on public.opportunities;
create trigger opportunities_protect_important
before insert or update of is_important on public.opportunities
for each row execute function public.protect_important_opportunity_flag();

create or replace function public.enqueue_important_opportunity_email()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare should_send boolean;
begin
  if tg_op = 'INSERT' then
    should_send := new.is_important and new.status = 'open';
  else
    should_send := new.is_important and new.status = 'open'
      and (old.is_important is distinct from true or old.status is distinct from 'open');
  end if;
  if not should_send then return new; end if;

  insert into public.email_notification_outbox(user_id,event_key,event_type,subject,preview,action_path)
  select u.id,
         'important-opportunity:' || new.id::text || ':' || u.id::text,
         'important_opportunity',
         new.title || ' · فرصة مهمة جديدة',
         left(coalesce(new.description,'A new important opportunity is available.'),240),
         '/#/opportunities?opportunity=' || new.id::text
  from auth.users u
  join public.profiles p on p.id = u.id
  where u.id <> new.author_id
    and u.email is not null
    and u.email_confirmed_at is not null
  on conflict (event_key) do nothing;
  return new;
end;
$$;

drop trigger if exists opportunities_enqueue_important_email on public.opportunities;
create trigger opportunities_enqueue_important_email
after insert or update of is_important,status on public.opportunities
for each row execute function public.enqueue_important_opportunity_email();
