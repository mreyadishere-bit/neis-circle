-- In-app notifications for new Circle chat messages.
create or replace function public.notify_circle_chat_message()
returns trigger language plpgsql security definer set search_path=public as $$
declare circle_name text; sender_name text;
begin
  select c.name into circle_name from public.circles c where c.id=new.circle_id;
  select coalesce(nullif(p.full_name,''),nullif(p.username,''),'A student') into sender_name from public.profiles p where p.id=new.sender_id;
  insert into public.notifications(user_id,actor_id,type,title,body,entity_type,entity_id,route)
  select cm.user_id,new.sender_id,'circle_message','New message in '||coalesce(circle_name,'Circle'),coalesce(sender_name,'A student')||': '||left(coalesce(new.body,'New message'),140),'circle_message',new.id::text,'circles/'||new.circle_id::text||'/chat'
  from public.circle_members cm
  where cm.circle_id=new.circle_id and cm.status='active' and cm.user_id<>new.sender_id;
  return new;
end; $$;
drop trigger if exists circle_messages_notify_members on public.circle_messages;
create trigger circle_messages_notify_members after insert on public.circle_messages for each row execute function public.notify_circle_chat_message();
