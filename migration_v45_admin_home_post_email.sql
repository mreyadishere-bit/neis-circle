
create or replace function public.enqueue_admin_post_email()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  -- Only homepage posts: Circle posts must not email the full community.
  if new.circle_id is not null then
    return new;
  end if;

  -- Only posts published by an admin account.
  if not exists (
    select 1
    from public.profiles p
    where p.id = new.author_id
      and p.role = 'admin'
      and coalesce(p.account_status,'active') = 'active'
  ) then
    return new;
  end if;

  insert into public.email_notification_outbox(
    user_id,event_key,event_type,subject,preview,action_path
  )
  select
    u.id,
    'admin-post:' || new.id::text || ':' || u.id::text,
    'admin_post',
    coalesce(nullif(new.title,''),'New post from NEIS Circle') || ' · منشور جديد',
    left(coalesce(nullif(new.body,''),'A new post is available on NEIS Circle.'),240),
    '/#/post/' || new.id::text
  from auth.users u
  join public.profiles p on p.id = u.id
  where u.id <> new.author_id
    and coalesce(p.account_status,'active') = 'active'
    and u.email is not null
    and u.email_confirmed_at is not null
  on conflict (event_key) do nothing;

  return new;
end;
$$;

revoke all on function public.enqueue_admin_post_email() from public, anon, authenticated;

drop trigger if exists posts_enqueue_admin_email on public.posts;
create trigger posts_enqueue_admin_email
after insert on public.posts
for each row
execute function public.enqueue_admin_post_email();
