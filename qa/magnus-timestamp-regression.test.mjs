import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const sql=readFileSync('supabase/migrations/20261103190000_magnus_claim_timestamp_fix.sql','utf8');
const client=readFileSync('scripts/magnus-neis-v1.js','utf8');
const deploy=readFileSync('scripts/ops/ovh-deploy-magnus-timefix-20261103.py','utf8');

assert.match(sql,/v_now timestamptz := clock_timestamp\(\)/);
assert.match(sql,/v_limits\.day_start < v_now-interval '24 hours'/);
assert.match(sql,/v_limits\.burst_start < v_now-interval '60 seconds'/);
assert.doesNotMatch(sql,/declare\s+current_time\s+timestamptz/i);
assert.match(sql,/for update/);
assert.match(sql,/v_limits\.burst_count >= 12 or v_limits\.day_count >= 250/);
assert.match(sql,/grant execute on function public\.magnus_claim_turn\(\) to authenticated/);

assert.doesNotMatch(client,/welcome\(lang\)/);
assert.doesNotMatch(client,/I'm Magnus ✦ Ask me anything/);
assert.doesNotMatch(client,/أنا ماجنوس ✦ اسألني/);
assert.match(client,/<strong>Magnus<\/strong><\/div>/);
assert.match(client,/sb\.functions\.invoke\('magnus-chat'/);
assert.match(client,/id="magnusForm"/);

assert.match(deploy,/MAGNUS_DB_FUNCTION_DRY_RUN=PASS/);
assert.match(deploy,/MAGNUS_AUTHENTICATED_RPC=PASS/);
assert.match(deploy,/magnus\.test\.user/);
assert.match(deploy,/\n\s*test_in_rollback\(sql\)/);
assert.match(deploy,/FRONT_OVERLAY\.write_text\(original\)/);
assert.doesNotMatch(deploy,/force-recreate.*functions/);

const ctx=vm.createContext({window:{},console});
vm.runInContext(client,ctx);
const shell='<section class="messages mobile-thread-open"><div class="thread-list-scroll"></div><div class="chat"><div>Pick conversation</div></div></section>';
const html=ctx.window.NEISMagnus.integrate(shell,{active:true,lang:'en'});
assert.match(html,/magnus-intro-mark/);
assert.match(html,/<strong>Magnus<\/strong>/);
assert.doesNotMatch(html,/Ask me anything/);
assert.match(html,/id="magnusFlow"/);
console.log('MAGNUS_TIMESTAMP_AND_CLEAN_INTRO=PASS');
