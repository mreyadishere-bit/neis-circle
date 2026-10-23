import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const read=name=>fs.readFileSync(new URL('../scripts/'+name,import.meta.url),'utf8');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};
const tick=()=>new Promise(r=>setImmediate(r));
const source=read('02-content-admin.js');
const background=source.slice(source.indexOf('function refreshPrimaryBackground(){'),source.indexOf('\nloadLiveData=async function(){'));

for(const slowResource of ['members','counts']){
  const members=deferred(),counts=deferred(),patched=[];
  const countNode={textContent:'1'};
  const c={console,authUser:{id:'u1'},state:{view:'home',members:[],posts:[{id:'p1',likes:0,comments:0}]},
    document:{querySelector:()=>countNode},
    patchVisiblePostState:id=>patched.push(id),
    sb:{from:()=>({select(){return this},order:()=>members.promise}),rpc:()=>counts.promise}};
  c.window=c;vm.createContext(c);vm.runInContext('let primaryBackgroundRefreshPromise=null;'+background,c);
  const work=c.refreshPrimaryBackground();
  assert.equal(c.refreshPrimaryBackground(),work,'background requests must remain deduplicated');
  if(slowResource==='members'){
    counts.resolve({data:[{post_id:'p1',reaction_count:7,comment_count:4}]});await tick();
    assert.equal(c.state.posts[0].likes,7,'counts must paint while directory is still pending');
    assert.deepEqual(patched,['p1']);
    members.resolve({data:[{id:'u1'},{id:'u2'}]});
  }else{
    members.resolve({data:[{id:'u1'},{id:'u2'}]});await tick();
    assert.equal(countNode.textContent,'2','member total must paint while counts are still pending');
    counts.resolve({data:[]});
  }
  await work;
}
// A response for a previous session must never paint a newly signed-in account.
{
  const pending=deferred();
  const c={console,authUser:{id:'old'},state:{view:'home',members:[],posts:[]},sb:{from:()=>({select(){return this},order:()=>pending.promise}),rpc:()=>pending.promise}};
  c.window=c;vm.createContext(c);vm.runInContext('let primaryBackgroundRefreshPromise=null;'+background,c);
  const work=c.refreshPrimaryBackground();c.authUser={id:'new'};pending.resolve({data:[{id:'old'}]});await work;
  assert.equal(c.state.members.length,0);
}
// Exercise the actual social wrapper with a deliberately stalled chat bootstrap.
{
  const source=read('05-social.js');
  const start=source.indexOf('const coreLoad=loadLiveData;'),end=source.indexOf('\nasync function refreshCircleMeetingsOnly',start);
  const core=deferred(),chat=deferred(),events=[];
  const query={select(){return this},or(){return this},is(){return this},order(){return Promise.resolve({data:[]})}};
  const c={console,authUser:{id:'u1'},state:{view:'home',platformReady:false,dataErrors:{},posts:[]},
    loadLiveData:()=>core.promise,render:()=>events.push('render'),
    NEISSecondaryData:{ensureForView:()=>{events.push('articles');return Promise.resolve()}},
    setupNotificationRealtime:async()=>{},realtimeChannel:null,
    chatBootstrapData:{loadDirect:()=>chat.promise,loadCircle:async()=>{}},
    profileData:()=>({}),sb:{from:()=>query},
    messageReactionData:{idsFromState:()=>({}),load:async()=>({data:[]})},setupV6Realtime:async()=>{},notificationVisibilityBound:true};
  c.window=c;vm.createContext(c);vm.runInContext(source.slice(start,end),c);
  const work=c.loadLiveData();assert.deepEqual(events,['articles']);
  core.resolve();await tick();assert.deepEqual(events,['articles','render'],'first feed render must not wait for chat');
  chat.resolve();await work;
}
console.log('Startup latency tests passed: independent counts/directory, early articles/feed, session isolation.');
