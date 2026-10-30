-- Route newly enqueued PWA Web Push jobs through the self-hosted OVH Edge endpoint.
-- Keep the existing outbox, retry worker, and backoff schedule unchanged.
-- This is intentionally an idempotent change to the immediate dispatch trigger only.
create or replace function private.dispatch_web_push_job()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  perform net.http_post(
    url:='https://supabase.neiscircle.site/functions/v1/send-web-push',
    body:=jsonb_build_object('job_id',new.id,'dispatch_token',new.dispatch_token),
    params:='{}'::jsonb,
    headers:=jsonb_build_object('Content-Type','application/json'),
    timeout_milliseconds:=7000
  );
  return new;
exception when others then
  -- Leave the outbox row pending, for the existing bounded retry worker.
  raise warning 'web_push_dispatch_enqueue_failed: %', SQLSTATE;
  return new;
end;
$$;

revoke all on function private.dispatch_web_push_job() from public,anon,authenticated;
