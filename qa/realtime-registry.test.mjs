import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const fieldsSource=fs.readFileSync(new URL('../scripts/social/chat-fields-v182.js',import.meta.url),'utf8');
const source=fs.readFileSync(new URL('../scripts/social/realtime-v175.js',import.meta.url),'utf8');

const bindings=[];
let channelCreates=0;
let removals=0;
let subscribedStatusCallback=null;

function makeChannel(){
  return {
    on(event,filter,handler){
      bindings.push({event,filter,handler});
      return this;
    },
    subscribe(callback){
      subscribedStatusCallback=callback;
      return this;
    }
  };
}

const sb={
  channel(name){
    channelCreates+=1;
    assert.match(name,/^neis-v7-/);
    return makeChannel();
  },
  async removeChannel(){
    removals+=1;
  }
};

const handlerNames=[
  'handlePostRealtime','handleCommentRealtime','handleReactionRealtime','handleCommentEngagementRealtime',
  'handleMessageRealtime','handleConversationRealtime','handleConversationMemberRealtime',
  'handleCircleMessageRealtime','handleMessageReactionRealtime','handleCircleMeetingRealtime',
  'handleFollowRealtime','handleCircleMemberRealtime','handleProfileRealtime','handleArticleRealtime',
  'handleGalleryRealtime','handleReportRealtime'
];
const handlers=Object.fromEntries(handlerNames.map(name=>[name,()=>name]));
let beforeSetupCalls=0;

const context={console};
context.window=context;
vm.createContext(context);
vm.runInContext(fieldsSource,context,{filename:'chat-fields-v182.js'});
vm.runInContext(source,context,{filename:'realtime-v175.js'});

const api=context.NEISRealtimeRegistry;
assert.equal(api.version,'175.1');

await api.setup('u1',{sb,handlers,beforeSetup:()=>{beforeSetupCalls+=1}});
assert.equal(channelCreates,1);
assert.equal(bindings.length,17,'all expected realtime tables must be registered');
assert.equal(beforeSetupCalls,1);
assert.deepEqual(bindings.map(item=>item.filter.table),[
  'posts','comments','reactions','comment_likes','comment_creator_hearts','messages',
  'conversations','conversation_members','circle_messages','message_reactions',
  'circle_meetings','follows','circle_members','profiles','articles','gallery_items','reports'
]);
const selected=Object.fromEntries(bindings.filter(item=>item.filter.select).map(item=>[item.filter.table,item.filter.select]));
assert.equal(selected.messages.join(','),context.NEISChatFields.message);
assert.equal(selected.conversations.join(','),context.NEISChatFields.conversation);
assert.equal(selected.conversation_members.join(','),context.NEISChatFields.member);
assert.equal(selected.circle_messages.join(','),context.NEISChatFields.circleMessage);
assert.equal(selected.message_reactions.join(','),'id,dm_message_id,circle_message_id,user_id,emoji,created_at');

subscribedStatusCallback('SUBSCRIBED');
assert.equal(api.snapshot().status,'SUBSCRIBED');

// Same user + healthy channel: reuse instead of duplicate subscription.
await api.setup('u1',{sb,handlers,beforeSetup:()=>{beforeSetupCalls+=1}});
assert.equal(channelCreates,1,'same user must reuse the existing channel');
assert.equal(removals,0);

// User switch: remove old channel and create exactly one new channel.
await api.setup('u2',{sb,handlers,beforeSetup:()=>{beforeSetupCalls+=1}});
assert.equal(removals,1);
assert.equal(channelCreates,2);
assert.equal(api.snapshot().user,'u2');

await api.reset(sb);
assert.equal(removals,2);
assert.equal(api.snapshot().status,'CLOSED');
assert.equal(api.snapshot().active,false);

console.log('Realtime registry unit test passed:',api.snapshot());
