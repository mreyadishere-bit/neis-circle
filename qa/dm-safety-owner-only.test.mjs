import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const sql=readFileSync("supabase/migrations/20261104193500_dm_safety_review_owner_only.sql","utf8");
const ui=readFileSync("scripts/05-social.js","utf8");
const names=["admin_search_dm_users","admin_list_user_dm_conversations","admin_create_dm_review_request","admin_get_dm_review_messages"];
for(const name of names){
 const key="create or replace function public."+name+"(";
 const start=sql.indexOf(key);
 assert.ok(start>=0,"missing RPC "+name);
 const end=sql.indexOf("$$;",start);
 assert.ok(end>start,"no RPC terminator "+name);
 const definition=sql.slice(start,end);
 assert.match(definition,/if not public\.neis_admin_is_owner\(\)/,"owner guard missing for "+name);
 assert.doesNotMatch(definition,/neis_admin_is_super\(\)/,"super admin must be rejected for "+name);
}
assert.equal((sql.match(/create or replace function public\.admin_/g)||[]).length,4);
assert.match(ui,/const canOpenDmSafetyReview=\(\)=>state\.isAdmin&&isMainAdminUser\(\)/);
const start=ui.indexOf("function adminDmSafetyPanel()");
const end=ui.indexOf("  const moderationLinks=canOpenAdminModerationTargets();",start);
assert.ok(start>=0&&end>start);
const safety=ui.slice(start,end);
assert.equal((safety.match(/canOpenDmSafetyReview\(\)/g)||[]).length,5);
assert.doesNotMatch(safety,/canOpenAdminModerationTargets\(\)/);
assert.ok(ui.includes("canOpenDmSafetyReview()?adminDmSafetyPanel():''"));
console.log("DM_SAFETY_MAIN_ADMIN_ONLY=PASS");
