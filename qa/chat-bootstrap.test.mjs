import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const fieldsSource=fs.readFileSync(new URL('../scripts/social/chat-fields-v182.js',import.meta.url),'utf8');\nconst source=fs.readFileSync(new URL('../scripts/social/chat-bootstrap-v181.js',import.meta.url),'utf8');
const context={console};
context.window=context;
vm.createContext(context);
vm.runInContext(source,context,{filename:'chat-bootstrap-v181.js'});

const api=context.NEISChatBootstrapData;
assert.equal(api.version,'181.0');

const calls=[];
const responses={
  conversation_members_user:{data:[{conversation_id:'c1',user_id:'u1',hidden_at:null,cleared_at:'2026-10-03T10:30:00Z'}],error:null},
  conversations:{data:[{id:'c1',updated_at:'2026-10-03T11:30:00Z'}],error:null},
  conversation_members_ids:{data:[
    {conversation_id:'c1',user_id:'u1',hidden_at:null,cleared_at:'2026-10-03T10:30:00Z'},
    {conversation_id:'c1',user_id:'u2',hidden_at:null}
  ],error:null},
  messages:{data:[
    {id:'m2',conversation_id:'c1',sender_id:'u2',created_at:'2026-10-03T11:00:00Z'},
    {id:'m1',conversation_id:'c1',sender_id:'u2',created_at:'2026-10-03T10:00:00Z'}
  ],error:null},
  circle_messages:{data:[{id:1,circle_id:'circle1',sender_id:'u2',created_at:'2026-10-03T12:00:00Z'}],error:null}
};

function from(table){
  const q={table,mode:'',ids:[]};
  const chain={
    select(){return chain},
    eq(column,value){
      calls.push({table,op:'eq',column,value});
      if(table==='conversation_members'&&column==='user_id')return Promise.resolve(responses.conversation_members_user);
      return chain;
    },
    in(column,ids){
      q.ids=[...ids];
      calls.push({table,op:'in',column,ids:[...ids]});
      return chain;
    },
    order(){
      if(table==='conversations')return Promise.resolve(responses.conversations);
      if(table==='conversation_members')return Promise.resolve(responses.conversation_members_ids);
      if(table==='messages')return chain;
      if(table==='circle_messages')return chain;
      return chain;
    },
    limit(){
      if(table==='messages')return Promise.resolve(responses.messages);
      if(table==='circle_messages')return Promise.resolve(responses.circle_messages);
      return Promise.resolve({data:[],error:null});
    },
    then(resolve,reject){
      if(table==='conversation_members')return Promise.resolve(responses.conversation_members_ids).then(resolve,reject);
      return Promise.resolve({data:[],error:null}).then(resolve,reject);
    }
  };
  return chain;
}

const sb={from};
const state={conversations:[],conversationMembers:[],liveMessages:[],circleRows:[{id:'circle1'}],circleMembers:[{circle_id:'circle1',user_id:'u1',status:'active'}],circleMessages:[]};

const direct=await api.loadDirect({sb,userId:'u1',state,profileData:id=>({id,full_name:'User'})});
assert.equal(direct.ok,true);
assert.equal(state.conversations.length,1);
assert.equal(state.conversationMembers.length,2);
assert.equal(state.liveMessages.map(x=>x.id).join(','),'m2','messages before cleared_at must be excluded');

const circle=await api.loadCircle({sb,userId:'u1',state,profileData:id=>({id,full_name:'User'}),isAdmin:false});
assert.equal(circle.ok,true);
assert.equal(state.circleMessages.length,1);
assert.equal(state.circleMessages[0].profile.full_name,'User');

const before=calls.length;
state.circleMembers=[];
state.circleMessages=[{id:999}];
const none=await api.loadCircle({sb,userId:'u1',state,profileData:id=>({id}),isAdmin:false});
assert.equal(none.ok,true);
assert.equal(state.circleMessages.length,0);
assert.equal(calls.length,before,'no Circle message query should run without joined circles');

console.log('Chat bootstrap unit test passed.');
