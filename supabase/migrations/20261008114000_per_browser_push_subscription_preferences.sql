alter table public.web_push_subscriptions add column if not exists device_preferences jsonb not null default '{}'::jsonb;
create or replace function public.get_web_push_device_preferences(endpoint_input text)
returns jsonb language sql stable security definer set search_path=public,auth as $$
select coalesce((select device_preferences from public.web_push_subscriptions where endpoint=endpoint_input and user_id=auth.uid()),'{}'::jsonb)
$$;
create or replace function public.set_web_push_device_preferences(endpoint_input text, preferences_input jsonb)
returns boolean language plpgsql security definer set search_path=public,auth as $$
declare v_updated integer;
begin
if auth.uid() is null or endpoint_input is null or jsonb_typeof(preferences_input)<>'object' then raise exception 'invalid_device_preferences'; end if;
if exists(select 1 from jsonb_each(preferences_input) kv where kv.key not in (
'direct_messages','post_comments_replies','article_comments_replies','post_likes','article_likes','comment_reactions','new_posts','new_articles','new_circles','circle_posts','circle_messages','circle_meetings','circle_membership','followers','timetable_reminders','sound'
) or kv.value not in ('true'::jsonb,'false'::jsonb)) then raise exception 'invalid_device_preferences'; end if;
update public.web_push_subscriptions set device_preferences=preferences_input,updated_at=now()
where user_id=auth.uid() and endpoint=endpoint_input;
get diagnostics v_updated=row_count;
return v_updated=1;
end; $$;
revoke all on function public.get_web_push_device_preferences(text) from public,anon;
revoke all on function public.set_web_push_device_preferences(text,jsonb) from public,anon;
grant execute on function public.get_web_push_device_preferences(text) to authenticated;
grant execute on function public.set_web_push_device_preferences(text,jsonb) to authenticated;