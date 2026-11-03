import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Regression: remove the Home Best Articles showcase ONLY, not the Articles
// library, featured filters, editor, bookmarking or saved article state.
const source=fs.readFileSync('scripts/featured-articles-v160.js','utf8');
const base=fs.readFileSync('scripts/02-content-admin.js','utf8');
assert.match(base,/const latest=state\.articles\.filter\(a=>a\.status==="published"\)\.slice\(0,2\)/,
  'The original Home latest-articles showcase still uses the expected data list');
assert.match(source,/state\.articles=\[\];\s*return baseHome\(\);/,
  'Home wrapper disables the showcase only while it renders');
assert.match(source,/finally\{\s*state\.articles=originalArticles;/,
  'Home wrapper always restores the complete articles list');
assert.match(source,/data-article-feature-filter="Best"/,
  'The Best Articles filter remains in the Articles view');
assert.match(source,/set_article_featured/,
  'Featured article moderation still works');

const published=[
 {id:'one',status:'published',featured:true,featured_at:'2026-11-01T12:00:00Z',title_en:'Physics'},
 {id:'two',status:'published',featured:false,title_en:'English'},
 {id:'three',status:'draft',featured:true,title_en:'Draft'},
];

function makeContext(throwOnHome=false){
 const state={articles:[...published],articleFilter:'All',articleLanguageFilter:'All',lang:'en'};
 const calls={articleCard:0,home:0,bind:0};
 const ctx={
  window:{},state,authUser:null,
  articleCard(article){calls.articleCard++;return '<article class="article-card"><div class="article-copy">'+article.id+'</div></article>';},
  articles(){return '<div style="display:flex;gap:9px;flex-wrap:wrap;margin-bottom:18px"></div><main class="articles-page">'+state.articles.map(a=>a.id).join(',')+'</main>';},
  home(){
   calls.home++;
   if(throwOnHome)throw new Error('mock Home failure');
   const latest=state.articles.filter(a=>a.status==='published').slice(0,2);
   return '<section class="hero">Home</section>'+
     (latest.length?'<section class="home-featured"><h2>Latest articles</h2><button>View all</button><div class="article-grid">'+latest.map(a=>a.id).join(',')+'</div></section>':'')+
     '<div class="dashboard"><div class="composer-bar">Share something useful</div><div class="feed">Posts</div></div>';
  },
  bindDynamic(){calls.bind++;},
  document:{querySelectorAll(){return []}},
  console
 };
 vm.runInNewContext(source,ctx,{filename:'featured-articles-v160.js'});
 return {ctx,calls,state};
}
{
 const {ctx,calls,state}=makeContext();
 const ref=state.articles;
 const before=JSON.stringify(state.articles);
 const html=ctx.home();
 assert.doesNotMatch(html,/home-featured|Latest articles|Best Articles|View all|article-grid/,
  'Home must contain no featured article showcase or card list');
 assert.match(html,/class="hero"/,'Home hero remains');
 assert.match(html,/class="dashboard"/,'Home feed remains');
 assert.match(html,/class="composer-bar"/,'post composer remains');
 assert.equal(calls.home,1,'original Home renderer still runs once');
 assert.equal(state.articles,ref,'articles array identity is unchanged after Home render');
 assert.equal(JSON.stringify(state.articles),before,'articles content and featured metadata are preserved');
 // The featured filter and the rest of Articles must work after navigating there.
 state.articleFilter='Best';
 const best=ctx.articles();
 assert.match(best,/Best Articles/,'Best Articles tab still exists inside Articles');
 assert.match(best,/class="articles-page"/,'Articles page still renders');
 assert.match(best,/one/,'featured published article is still accessible');
 assert.doesNotMatch(best,/two,|three,/,'best filter hides ordinary/draft articles');
 assert.equal(state.articles,ref,'Articles filtering does not mutate stored records');
 state.articleFilter='All';
 const all=ctx.articles();
 assert.match(all,/one,two,three/,'all article records still available');
}
{
 const {ctx,state}=makeContext(true);
 const original=state.articles;
 assert.throws(()=>ctx.home(),/mock Home failure/);
 assert.equal(state.articles,original,'even a failed Home render restores article state');
}
{
 const {ctx,state}=makeContext();
 state.lang='ar';
 assert.doesNotMatch(ctx.home(),/Latest articles|Best Articles|أفضل المقالات|أحدث المقالات/,
  'Home showcase stays removed when Arabic is selected');
}
console.log('HOME_BEST_ARTICLES_REMOVED_ONLY=PASS; Articles and featured management retained');
