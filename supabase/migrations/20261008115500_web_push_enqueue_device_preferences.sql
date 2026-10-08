do $migration$
declare ddl text; start_at integer; end_at integer;
begin
 ddl:=pg_get_functiondef('private.enqueue_web_push_from_notification()'::regprocedure);
 start_at:=position('  select * into prefs from public.push_preferences' in ddl);
 end_at:=position('  if new.type=''message'' and new.actor_id is not null then' in ddl);
 if start_at=0 or end_at<=start_at then raise exception 'unexpected_web_push_function_shape'; end if;
 ddl:=substring(ddl from 1 for start_at-1)
 || '  -- Per-device preference filtering is performed by the web push sender.' || chr(10)
 || substring(ddl from end_at);
 execute ddl;
end $migration$;