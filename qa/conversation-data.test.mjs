import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const fieldsSource=fs.readFileSync(new URL('../scripts/social/chat-fields-v182.js',import.meta.url),'utf8');
const source=fs.readFileSync(new URL('../scripts/social/conversation-data-v179.js',import.meta.url),'utf8');
const context={console};
context.window=context;
vm.createContext(context);
vm.runInContext(fieldsSource,context,{filename:'chat-fields-v182.js'});
vm.runInContext(source,context,{filename:'conversation-data-v179.js'});

const api=context.NEISConversationData;
assert.equal(api.version,'179.0');

let calls=0;
const rows={
  conversations:{data:{id:'c1',updated_at:'2026-10-03T10:00:00Z'},error:null},
  conversation_members:{data:[{conversation_id:'c1',user_id:'u1',hidden_at:null,cleared_at:null}],error:null},
  messages:{data:[
    {id:'m2',conversation_id:'c1',created_at:'2026-10-03T11:00:00Z'},
    {id:'m1',conversation_id:'c1',created_at:'2026-10-03T10:00:00Z'}
  ],error:null}
};

function query(table){
  const chain={
    select(){return chain},
    eq(){return chain},
    order(){return chain},
    limit(){calls+=1;return Promise.resolve(rows[table])},
    maybeSingle(){calls+=1;return Promise.resolve(rows[table])},
    then(resolve,reject){calls+=1;return Promise.resolve(rows[table]).then(resolve,reject)}
  };
  return chain;
}
const sb={from:query};
const state={conversations:[],conversationMembers:[],liveMessages:[]};

const a=api.hydrate('c1',{sb,userId:'u1',state,profileData:id=>({id,full_name:'User'})});
const b=api.hydrate('c1',{sb,userId:'u1',state,profileData:id=>({id,full_name:'User'})});
assert.equal(a,b,'same conversation hydration must share one in-flight promise');
const result=await a;
assert.equal(result.ok,true);
assert.equal(result.hidden,false);
assert.equal(state.conversations.length,1);
assert.equal(state.conversationMembers.length,1);
assert.equal(state.liveMessages.map(x=>x.id).join(','),'m1,m2');
assert.equal(calls,3,'one hydration should issue exactly three Supabase queries');
assert.equal(Array.from(api.snapshot().inflight).length,0);

console.log('Conversation data unit test passed.');
