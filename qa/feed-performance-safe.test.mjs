import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const social=fs.readFileSync('scripts/05-social.js','utf8');
const css=fs.readFileSync('styles/app.css','utf8');
const start=social.indexOf('function homePostsForRealtimePatch(){');
const end=social.indexOf('\nfunction renderHomePostNode(',start);
assert.ok(start>=0&&end>start,'Home ordering function exists');
const fn=social.slice(start,end);
assert.match(fn,/const following=new Set/);
assert.match(fn,/const joined=new Set/);
assert.match(fn,/prioritized\(b\)-prioritized\(a\)/);
assert.match(social,/function syncHomePostEngagement\(node,post,engagement\)/);
assert.equal((social.match(/syncHomePostEngagement\(node,post,engagement\);/g)||[]).length,4);
assert.equal((social.match(/const engagement=\{/g)||[]).length,2);
assert.match(social,/neisVisibleEmbeddedPlayer\(\)/,'video playback protection retained');
assert.match(css,/#view \.feed > \.post/);
assert.match(css,/#view \.circle-home-feed > \.post/);
assert.match(css,/content-visibility:auto/);
assert.match(css,/contain-intrinsic-size:auto 440px/);

const state={
 posts:[
 {id:'older',author_id:'other',created_at:'2026-11-01T00:00:00Z'},
 {id:'following',author_id:'friend',created_at:'2026-11-02T00:00:00Z'},
 {id:'self',author_id:'me',created_at:'2026-11-03T00:00:00Z'},
 {id:'unfollowed',author_id:'other',created_at:'2026-11-06T00:00:00Z'}
 ],
 query:'',filter:'For you',
 follows:[{follower_id:'me',following_id:'friend',status:'accepted'}],circleMembers:[]
};
const ctx={state,authUser:{id:'me'},same:(a,b)=>String(a)===String(b),normalize:x=>String(x).toLowerCase(),match:()=>true,Date,Set};
vm.createContext(ctx);
vm.runInContext(fn+'\nthis.getPosts=homePostsForRealtimePatch',ctx);
assert.deepEqual([...ctx.getPosts().map(p=>p.id)],['self','following','unfollowed','older'],
 'followed and own posts prioritized, then new posts');
state.filter='Latest';
assert.deepEqual([...ctx.getPosts().map(p=>p.id)],['unfollowed','self','following','older']);
console.log('FEED_PERFORMANCE_FEATURE_PARITY=PASS');
