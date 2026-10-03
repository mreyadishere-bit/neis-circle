import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source=fs.readFileSync(new URL('../scripts/social/messages-state-v177.js',import.meta.url),'utf8');
const context={console};
context.window=context;
vm.createContext(context);
vm.runInContext(source,context,{filename:'messages-state-v177.js'});

const api=context.NEISMessageState;
assert.equal(api.version,'177.0');

const state={liveMessages:[],circleMessages:[],messageReactions:[],conversationMembers:[]};

let result=api.applyDirectMessage(state,{eventType:'INSERT',new:{id:'m1',conversation_id:'c1',sender_id:'u2',body:'Hi',created_at:'2026-10-03T10:00:00Z'}},{visible:true});
assert.equal(result.changed,true);
assert.equal(state.liveMessages.length,1);

result=api.applyDirectMessage(state,{eventType:'UPDATE',new:{id:'m1',conversation_id:'c1',body:'Edited',created_at:'2026-10-03T10:00:00Z'}},{visible:true});
assert.equal(state.liveMessages[0].body,'Edited');

result=api.applyDirectMessage(state,{eventType:'DELETE',old:{id:'m1',conversation_id:'c1'}},{visible:true});
assert.equal(state.liveMessages.length,0);

api.applyCircleMessage(state,{eventType:'INSERT',new:{id:'cm1',circle_id:'circle1',sender_id:'u3',body:'Circle',created_at:'2026-10-03T11:00:00Z'}},{allowed:true,profile:{id:'u3',full_name:'User Three'}});
assert.equal(state.circleMessages[0].profile.full_name,'User Three');

api.applyMessageReaction(state,{eventType:'INSERT',new:{id:'r1',dm_message_id:'m2',emoji:'🔥',user_id:'u1'}});
assert.equal(state.messageReactions.length,1);
api.applyMessageReaction(state,{eventType:'DELETE',old:{id:'r1'}});
assert.equal(state.messageReactions.length,0);

api.applyConversationMember(state,{eventType:'INSERT',new:{conversation_id:'c2',user_id:'u4',hidden_at:null}},{profile:{id:'u4',full_name:'User Four'}});
assert.equal(state.conversationMembers.length,1);
assert.equal(state.conversationMembers[0].profile.full_name,'User Four');

console.log('Message state unit test passed.');
