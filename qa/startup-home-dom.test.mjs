import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH,args:['--no-sandbox']}: {})});
try{
  const page=await browser.newPage();
  await page.setContent('<main id="view"><section class="hero"></section><div class="dashboard"><textarea id="draft">keep this draft</textarea><video id="player"></video><div class="feed"></div></div></main>');
  await page.evaluate(()=>{
    window.state={view:'home',articles:[],lang:'en'};
    window.articleCard=a=>'<article data-article="'+a.id+'">'+a.title_en+'</article>';
    window.articles=()=>'';
    window.home=()=>'<section class="hero"></section>'+(state.articles.length?'<section><div class="article-grid">'+state.articles.map(articleCard).join('')+'</div></section>':'')+'<div class="dashboard"></div>';
    window.bindDynamic=()=>{window.bindCount=(window.bindCount||0)+1};
    window.originalPlayer=document.querySelector('#player');
    window.originalDraft=document.querySelector('#draft');
  });
  await page.addScriptTag({content:fs.readFileSync(new URL('../scripts/featured-articles-v160.js',import.meta.url),'utf8')});
  for(const rows of [[{id:1,title_en:'First',status:'published',featured:true}],[{id:2,title_en:'Second',status:'published',featured:true}],[]]){
    const result=await page.evaluate(rows=>{
      state.articles=rows;NEISPatchHomeArticles();
      return {ids:[...document.querySelectorAll('[data-article]')].map(x=>x.dataset.article),samePlayer:originalPlayer===document.querySelector('#player'),sameDraft:originalDraft===document.querySelector('#draft'),draft:originalDraft.value};
    },rows);
    assert.deepEqual(result.ids,rows.map(r=>String(r.id)));
    assert.equal(result.samePlayer,true);assert.equal(result.sameDraft,true);assert.equal(result.draft,'keep this draft');
  }
  console.log('Home article DOM test passed: insert, replace, remove, draft/player preservation.');
}finally{await browser.close()}
