import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source=fs.readFileSync(new URL('../scripts/social/chat-bootstrap-v181.js',import.meta.url),'utf8');
const context={console};
context.window=context;
vm.createContext(context);
vm.runInContext(source,context,{filename:'chat-bootstrap-v181.js'});

const api=context.NEISChatBootstrapData;
assert.equal(api.version,'181.0');

let calls=[];
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function chain(table){
  const obj={
    select(){return obj},
    eq(field,value){
      calls.push({table,op:'eq',field,value});
      if(table==='conversation_members'&&field==='user_id'){
        return delay(10).then(()=>({data:[
          {conversation_id:'c1',user_id:'u1',hidden_at:null,cleared_at:'2026-10-03T10:30:00Z'},
          {conversation_id:'c2',user_id:'u1',hidden_at:'2026-10-03T10:00:00Z',cleared_at:null}
        ],error:null}));
      }
      return obj;
    },
    in(field,values){calls.push({table,op:'in',field,values});return obj},
    order(field,opts){
      calls.push({table,op:'order',field,opts});
      if(table==='conversations')return Promise.resolve({data:[{id:'c1',updated_at:'2026-10-03T12:00:00Z'}],error:null});
      if(table==='messages')return obj;
      return Promise.resolve({data:[
        {conversation_id:'c1',user_id:'u1'},
        {conversation_id:'c1',user_id:'u2'}
      ],error:null});
    },
    limit(n){
      calls.push({table,op:'limit',n});
      return Promise.resolve({data:[
        {id:'old',conversation_id:'c1',created_at:'2026-10-03T10:00:00Z'},
        {id:'new',conversation_id:'c1',created_at:'2026-10-03T11:00:00Z'}
      ],error:null});
    }
  };
  return obj;
}
const sb={from:table=>chain(table)};

const p1=api.load({sb,userId:'u1',profileData:id=>({id})});
const p2=api.load({sb,userId:'u1',profileData:id=>({id})});
assert.equal(p1,p2,'same-user startup load must dedupe while inflight');

const result=await p1;
assert.equal(result.ok,true);
assert.deepEqual(result.conversationIds,['c1']);
assert.deepEqual(result.messages.map(x=>x.id),['new'],'cleared messages must be filtered');
assert.ok(calls.some(x=>x.table==='messages'&&x.op==='limit'&&x.n===200),'message load must stay capped at 200');

const state={conversations:[],conversationMembers:[],liveMessages:[]};
assert.equal(api.applyToState(state,result),true);
assert.equal(state.conversations.length,1);
assert.equal(state.conversationMembers.length,2);
assert.equal(state.liveMessages.length,1);

console.log('Chat bootstrap data unit test passed.');
