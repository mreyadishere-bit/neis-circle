import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync('scripts/search-result-avatars-v1.js','utf8');
const css=fs.readFileSync('styles/search-result-avatars-v1.css','utf8');
const index=fs.readFileSync('index.html','utf8');
assert.match(index,/scripts\/profile-illustrations-v1\.js[^\n]*[\s\S]*scripts\/search-result-avatars-v1\.js/,'avatar extension must load after profile illustrations');
assert.match(css,/search-suggest .suggest-item>\.search-result-avatar/);
assert.match(css,/border-radius:50%/);

let activeRow;
const requests=[];
const state={
 members:[
  {id:'u-alice',full_name:'Alice',avatar_url:'https://approved.example/alice.svg'},
  {id:'u-bob',full_name:'Bob',avatar_url:'https://approved.example/bob.svg'}
 ],
 posts:[{id:'post-alice',author_id:'u-alice',user:'Alice'}],
 articles:[],circleRows:[],searchResults:[],searchLoading:false
};
const ctx={
 state,authUser:{id:'auth-1'},searchRequestId:1,
 searchRow:x=>'<button class="result-row" data-search-open="'+x.type+'" data-search-id="'+x.id+'"><span class="entity-icon">'+(x.type==='post'?'POST':'P')+'</span></button>',
 renderSuggestions:()=>true,
 profileAvatar:profile=>'<span class="avatar">'+(profile.avatar_url?'<img src="'+profile.avatar_url+'">':(profile.full_name||'Student').slice(0,2))+'</span>',
 document:{
  querySelectorAll:()=>activeRow?[activeRow]:[]
 },
 window:{},
 sb:{
  from(table){
   const entry={table};requests.push(entry);
   return {
    select(fields){entry.fields=fields;return this},
    in(field,values){
     entry.ids=values;
     if(table==='posts')return Promise.resolve({data:values.includes('post-missing')?[{id:'post-missing',author_id:'u-carol'}]:[],error:null});
     if(table==='profiles')return Promise.resolve({data:values.includes('u-carol')?[{id:'u-carol',full_name:'Carol',avatar_url:'https://approved.example/carol.svg'}]:[],error:null});
     return Promise.resolve({data:[],error:null});
    }
   }
  }
 },
 Promise,Map,Set,Array,String,JSON,Date
};
vm.runInNewContext(source,ctx);
const post={type:'post',id:'post-alice',title:'A post'};
const person={type:'profile',id:'u-bob',title:'Bob'};
assert.ok(ctx.searchRow(post).includes('alice.svg'),'post must show its author portrait');
assert.ok(ctx.searchRow(person).includes('bob.svg'),'profile must show its own portrait');
assert.ok(!ctx.searchRow(post).includes('class="entity-icon"'),'old POST letter badge removed');
assert.ok(ctx.searchRow({type:'circle',id:'c-1'}).includes('#i-circles'),'circle uses semantic icon rather than letter C');

const missingPost={type:'post',id:'post-missing',title:'Carol post'};
state.searchResults=[missingPost];
activeRow={
 dataset:{searchOpen:'post',searchId:'post-missing'},
 querySelector(){return {set outerHTML(value){activeRow.lastAvatar=value}}}
};
ctx.searchRequestId=2;
ctx.renderSuggestions();
await new Promise(resolve=>setTimeout(resolve,20));
assert.ok(activeRow.lastAvatar?.includes('carol.svg'),'unloaded post should get actual author portrait after batched lookup');
assert.ok(requests.some(x=>x.table==='posts'&&x.fields==='id,author_id'),'post ownership must be resolved by IDs');
assert.ok(requests.some(x=>x.table==='profiles'&&x.fields==='id,full_name,avatar_url'),'author avatar uses permitted profiles query');
assert.ok(!requests.some(x=>x.table==='auth.users'),'must never query private auth users');
console.log('NEIS_SEARCH_REAL_PROFILE_AVATARS=PASS');
