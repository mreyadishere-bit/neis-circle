-- Fix Magnus rate-limit RPC: current_time was parsed as PostgreSQL's
-- CURRENT_TIME (timetz), not the intended timestamptz variable.
-- Keep role checks, quota limits, concurrency lock, and table unchanged.
begin;
create or replace function public.magnus_claim_turn()
returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,public,auth as $$
declare
 v_user uuid := auth.uid();
 v_now timestamptz := clock_timestamp();
 v_limits public.magnus_rate_limits%rowtype;
begin
 if v_user is null or not exists(
   select 1 from auth.users where id=v_user and deleted_at is null
 ) then
   raise exception 'Authentication required' using errcode='42501';
 end if;
 insert into public.magnus_rate_limits(user_id) values(v_user)
 on conflict(user_id) do nothing;
 select * into v_limits from public.magnus_rate_limits
 where user_id=v_user for update;
 if v_limits.day_start < v_now-interval '24 hours' then
   v_limits.day_start := v_now;
   v_limits.day_count := 0;
 end if;
 if v_limits.burst_start < v_now-interval '60 seconds' then
   v_limits.burst_start := v_now;
   v_limits.burst_count := 0;
 end if;
 if v_limits.burst_count >= 12 or v_limits.day_count >= 250 then
   return jsonb_build_object('allowed',false,'reason',
     case when v_limits.day_count >= 250 then 'daily_limit' else 'busy' end);
 end if;
 update public.magnus_rate_limits
 set burst_start=v_limits.burst_start,
     day_start=v_limits.day_start,
     burst_count=v_limits.burst_count+1,
     day_count=v_limits.day_count+1
 where user_id=v_user;
 return jsonb_build_object('allowed',true);
end;$$;
revoke all on function public.magnus_claim_turn() from public,anon;
grant execute on function public.magnus_claim_turn() to authenticated;
commit;
notify pgrst,'reload schema';
