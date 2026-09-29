create or replace function private.enqueue_web_push_from_notification()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  category_value text;
  allowed boolean:=false;
  prefs public.push_preferences%rowtype;
  push_title text:=new.title;
  push_route text;
begin
  category_value:=case
    when new.type='message' then 'messages'
    when new.type in ('reply','comment_reply') then 'replies'
    when new.type in ('circle_message','circle_meeting','membership_accepted','membership_request') then 'circles'
    when new.type='follow' then 'social'
    when new.type in ('admin_post','new_article') then 'announcements'
    when new.type in ('reaction','comment_like','article_comment_like','comment_heart','article_comment_heart') then 'reactions'
    else null end;

  if category_value is null then return new; end if;

  if new.type='message' and new.actor_id is not null then
    select coalesce(nullif(p.full_name,''),nullif(p.username,''),'New message')
      into push_title
    from public.profiles p
    where p.id=new.actor_id;
    push_title:=coalesce(push_title,'New message');
  end if;

  select * into prefs from public.push_preferences where user_id=new.user_id;
  if found then
    allowed:=case category_value
      when 'messages' then prefs.messages
      when 'replies' then prefs.replies
      when 'circles' then prefs.circles
      when 'social' then prefs.social
      when 'announcements' then prefs.announcements
      when 'reactions' then prefs.reactions
      else false end;
  else
    allowed:=true;
  end if;

  if not allowed then return new; end if;

  if not exists(
    select 1 from public.web_push_subscriptions s
    where s.user_id=new.user_id and s.enabled=true
  ) then return new; end if;

  push_route:=coalesce(new.route,'');
  if push_route='' then
    push_route:='/#/';
  elsif push_route like '/#/%' then
    null;
  elsif push_route like '#/%' then
    push_route:='/'||push_route;
  else
    push_route:='/#/'||regexp_replace(push_route,'^/+','','g');
  end if;

  insert into public.web_push_outbox(notification_id,user_id,category,title,body,route,notification_type)
  values(new.id,new.user_id,category_value,push_title,coalesce(new.body,''),push_route,new.type)
  on conflict(notification_id) do nothing;

  return new;
end $$;

revoke execute on function private.enqueue_web_push_from_notification()
from public,anon,authenticated;
