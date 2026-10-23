import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../scripts/05-social.js',import.meta.url),'utf8');
const helper=source.slice(source.indexOf('const notificationPostRequests='),source.indexOf('function routeTo(path,replace=false)'));
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:x=>resolve(x)}};
const make=()=>{
  let reads=0;const pending=deferred(),patched=[];
  const c={console,URLSearchParams,authUser:{id:'u1'},state:{posts:[]},postRealtimeFields:'id,circle_id',
    same:(a,b)=>String(a)===String(b),mergeStartupMembers:()=>{},
    realtimePostFromRow:(data,previous)=>({...previous,...data}),patchVisiblePostState:id=>patched.push(id),
    sb:{from:table=>{assert.equal(table,'posts');return {select(){return this},eq(field,id){assert.equal(field,'id');assert.equal(id,'42');return this},maybeSingle(){reads++;return pending.promise}}}}};
  c.window=c;vm.createContext(c);vm.runInContext(helper+source.slice(source.indexOf('function notificationTargetRoute(item){'),source.indexOf('const originalAdmin=admin;')),c);return {c,pending,patched,reads:()=>reads};
};
{
  const {c,pending,patched,reads}=make();
  const a=c.NEISEnsureNotificationPost({entity_type:'post',entity_id:'42'});
  const b=c.NEISEnsureNotificationPost({route:'/#/circles/art/home?post=42'});
  assert.equal(a,b,'notification and navigation must share the exact-target request');assert.equal(reads(),1);
  pending.resolve({data:{id:'42',circle_id:'art',body:'Fresh post'}});await a;
  assert.equal(c.state.posts[0].body,'Fresh post');assert.deepEqual(patched,['42']);
  assert.equal(c.notificationTargetRoute({entity_type:'post',entity_id:'42',route:'post/42'}),'circles/art/home?post=42');
}
{
  const {c,pending}=make();const work=c.ensureRoutePost('42');c.authUser={id:'u2'};
  pending.resolve({data:{id:'42',body:'Old account'}});assert.equal(await work,null);assert.equal(c.state.posts.length,0);
}
{
  const {c,pending}=make();const work=c.ensureRoutePost('42');pending.resolve({data:null,error:{message:'RLS denied'}});
  assert.equal(await work,null);assert.equal(c.state.posts.length,0,'unreadable targets must not be invented or inserted');
}
{
  const {c}=make();await c.NEISEnsureNotificationPost({entity_type:'message',entity_id:'42',route:'messages/conv'});assert.equal(c.state.posts.length,0);
}
// A feed request started before the notification must not discard the new target.
{
  const primary=fs.readFileSync(new URL('../scripts/02-content-admin.js',import.meta.url),'utf8');
  const pending=deferred();
  const c={console,authUser:{id:'u1'},state:{posts:[],members:[],profile:{name:'Student'},liked:[],saved:[]},
    mergeStartupMembers:()=>{},applyOwnProfileRow:()=>{},initials:()=>'',formatDate:()=>'',
    save:()=>{},refreshPrimaryBackground:()=>{},document:{body:{classList:{toggle(){}}}},
    sb:{from:table=>({select(){return this},eq(){return this},maybeSingle:()=>Promise.resolve({data:{id:'u1'}}),
      order:()=>pending.promise,then(resolve,reject){return Promise.resolve({data:[]}).then(resolve,reject)}})}};
  c.window=c;vm.createContext(c);
  vm.runInContext(primary.slice(primary.indexOf('loadLiveData=async function(){'),primary.indexOf('window.NEISPrimaryContentLoad=')),c);
  const work=c.loadLiveData();c.state.posts=[{id:'42',body:'Arrived after feed request'}];
  pending.resolve({data:[]});await work;
  assert.equal(c.state.posts[0].id,'42','in-flight feed snapshot must preserve the newly hydrated target');
}
console.log('Notification post target tests passed: missing circle post, deduplication, RLS failure and account isolation.');
