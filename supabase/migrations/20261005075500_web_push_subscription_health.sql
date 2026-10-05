create or replace function public.get_web_push_subscription_status(endpoint_input text)
returns text
language plpgsql
security definer
set search_path=public
as $$
declare
  status_value text;
begin
  if auth.uid() is null then
    return 'unknown';
  end if;

  select case when s.enabled then 'enabled' else 'disabled' end
    into status_value
  from public.web_push_subscriptions s
  where s.endpoint=trim(coalesce(endpoint_input,''))
    and s.user_id=auth.uid()
  limit 1;

  return coalesce(status_value,'missing');
end;
$$;

revoke all on function public.get_web_push_subscription_status(text) from public,anon;
grant execute on function public.get_web_push_subscription_status(text) to authenticated;
