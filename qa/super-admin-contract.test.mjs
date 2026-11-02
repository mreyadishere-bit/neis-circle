import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const sql=readFileSync('supabase/migrations/20261103013000_super_admin_permissions.sql','utf8');
const js=readFileSync('scripts/super-admin-management-v1.js','utf8');
const index=readFileSync('index.html','utf8');
assert.match(sql,/neis_admin_is_owner\(\)/);
assert.match(sql,/neis_admin_is_super\(\)/);
assert.match(sql,/neis_admin_set_super/);
assert.match(sql,/neis_admin_delete_account/);
assert.match(sql,/not public\.neis_admin_is_owner\(\)/);
assert.match(sql,/not public\.neis_admin_is_super\(\)/);
assert.match(sql,/p_user_id=actor/);
assert.match(sql,/p_confirmation is distinct from 'DELETE '/);
assert.match(sql,/revoke all on public\.neis_super_admins from public,anon,authenticated/);
assert.match(sql,/revoke all on function public\.neis_admin_delete_account/);
assert.match(js,/neis_admin_capabilities/);
assert.match(js,/neis_admin_set_super/);
assert.match(js,/neis_admin_delete_account/);
assert.match(js,/Protected account/);
assert.match(js,/Final confirmation/);
assert.match(index,/super-admin-management-v1\.js/);
console.log('SUPER_ADMIN_GUARDS=PASS');

const parity=readFileSync('supabase/migrations/20261103014000_super_admin_owner_console_parity.sql','utf8');
for(const name of ['main_admin_server_usage','main_admin_auth_overview','main_admin_auth_users','main_admin_auth_user_detail','main_admin_auth_set_block','main_admin_database_storage']){
  assert.ok(parity.includes('function public.'+name+'('),'missing super-admin parity '+name);
}
assert.ok((parity.match(/neis_admin_is_super\(\)/g)||[]).length>=6);
assert.match(sql,/neis_admin_set_regular_admin/);
assert.match(js,/neis_admin_set_regular_admin/);
