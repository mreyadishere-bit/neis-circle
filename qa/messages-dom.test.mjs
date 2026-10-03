import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source=fs.readFileSync(new URL('../scripts/social/messages-dom-v178.js',import.meta.url),'utf8');
const context={console};
context.window=context;
vm.createContext(context);
vm.runInContext(source,context,{filename:'messages-dom-v178.js'});

const api=context.NEISMessageDom;
assert.equal(api.version,'178.0');

const state={
  view:'messages',
  activeConversationId:'c1',
  liveMessages:[
    {id:'m2',conversation_id:'c1',body:'two',created_at:'2026-10-03T11:00:00Z'},
    {id:'m0',conversation_id:'c2',body:'other',created_at:'2026-10-03T09:00:00Z'},
    {id:'m1',conversation_id:'c1',body:'one',created_at:'2026-10-03T10:00:00Z'},
    {id:'deleted',conversation_id:'c1',deleted_at:'2026-10-03T12:00:00Z',created_at:'2026-10-03T12:00:00Z'}
  ],
  conversations:[]
};

const runtime=api.createRuntime({
  state,
  document:{querySelector:()=>null},
  CSS:{escape:String},
  requestAnimationFrame:fn=>fn(),
  conversationIsVisible:()=>true,
  dmThreadMarkup:()=>'<button></button>',
  messageBubble:()=>'<div></div>',
  emptyState:()=>'<div></div>',
  t:en=>en,
  bindV6:()=>{},
  sortConversations:()=>{}
});

assert.deepEqual(runtime.activeMessages().map(x=>x.id),['m1','m2']);
assert.equal(runtime.patchActiveFlow(),false,'missing flow must not trigger unrelated rendering');
assert.equal(runtime.patchThread('c1'),false,'missing thread container must be a no-op');

console.log('Message DOM unit test passed.');
