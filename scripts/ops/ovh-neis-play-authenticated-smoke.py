#!/usr/bin/env python3
"""Verify NEIS Play RPC permissions as a real authenticated role, rollback all writes."""
import subprocess,sys
ROOT='/home/ubuntu/neis-supabase'
DOCKER=['sudo','-n','/usr/bin/docker','exec','-i','supabase-db','psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-Atq']
SQL="""
begin;
select set_config('request.jwt.claim.sub',
 (select id::text from auth.users where deleted_at is null order by created_at limit 1),true);
set local role authenticated;
do $play_smoke$
declare
 room uuid;
 code text;
 snapshot jsonb;
 deck uuid;
begin
 if auth.uid() is null then raise exception 'AUTH_CONTEXT_MISSING';end if;
 select room_id,invite_code into room,code from public.neis_play_create_room('chess','Play authenticated smoke',null,'{}'::jsonb);
 if room is null or length(code)<>16 then raise exception 'ROOM_CREATE_FAILED';end if;
 snapshot:=public.neis_play_room_snapshot(room,0);
 if snapshot->>'code'<>code then raise exception 'SNAPSHOT_INCONSISTENT';end if;
 if public.neis_play_join_room(code)<>room then raise exception 'JOIN_IDEMPOTENCY_FAILED';end if;
 begin
  perform 1 from public.neis_play_rooms limit 1;
  raise exception 'DIRECT_ROOM_READ_UNEXPECTEDLY_ALLOWED';
 exception when insufficient_privilege then null;
 end;
 insert into public.neis_play_decks(owner_id,title,subject) values(auth.uid(),'Play rolled-back smoke','Physics') returning id into deck;
 insert into public.neis_play_cards(deck_id,question,answer) values(deck,'What is 2+2?','4');
 if not exists(select 1 from public.neis_play_cards where deck_id=deck) then raise exception 'DECK_POLICY_FAILED';end if;
end;
$play_smoke$;
select 'NEIS_PLAY_AUTH_RPC=PASS';
rollback;
"""
def main():
 p=subprocess.run(DOCKER,input=SQL,text=True,cwd=ROOT,capture_output=True,timeout=65)
 if p.returncode:
  print('NEIS_PLAY_AUTH_RPC=FAILED_'+p.stderr[-350:].replace('\n',' '),file=sys.stderr)
  raise SystemExit(1)
 if 'NEIS_PLAY_AUTH_RPC=PASS' not in p.stdout:raise SystemExit('NEIS_PLAY_AUTH_RPC=NO_SUCCESS_MARKER')
 print('NEIS_PLAY_AUTH_RPC=PASS')
 print('NEIS_PLAY_AUTH_DATA=ROLLED_BACK')
if __name__=='__main__':main()
