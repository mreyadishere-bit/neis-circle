import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source=fs.readFileSync(new URL('../scripts/social/chat-fields-v182.js',import.meta.url),'utf8');
const context={console};
context.window=context;
vm.createContext(context);
vm.runInContext(source,context,{filename:'chat-fields-v182.js'});

const fields=context.NEISChatFields;
assert.equal(fields.version,'182.0');

assert.equal(fields.conversation,'id,created_at,kind,updated_at');
assert.equal(fields.member,'conversation_id,user_id,last_read_at,hidden_at,cleared_at');
assert.equal(fields.message,'id,conversation_id,sender_id,body,created_at,edited_at,deleted_at,reply_to_id,shared_article_id,shared_post_id');
assert.equal(fields.circleMessage,'id,circle_id,sender_id,body,reply_to_id,created_at,edited_at,deleted_at,pinned_at,pinned_by,pin_expires_at,shared_article_id,shared_post_id');

for(const select of [fields.conversation,fields.member,fields.message,fields.circleMessage]){
  assert.equal(select.includes('*'),false);
}
for(const unused of ['attachment_url','read_at','direct_key','created_by']){
  assert.equal(Object.values(fields).filter(value=>typeof value==='string').some(value=>value.split(',').includes(unused)),false);
}

console.log('Chat field contract unit test passed.');
