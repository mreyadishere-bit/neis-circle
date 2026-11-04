import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright';
const nav=fs.readFileSync('scripts/navigation-v14.js','utf8');
const ui=fs.readFileSync('styles/ui-v14.css','utf8');
const games=fs.readFileSync('styles/neis-game-connectors-v1.css','utf8');
const ai=fs.readFileSync('scripts/timetable-ai-v1.js','utf8');
assert.ok(!nav.includes('>🎮</span>'),'mobile Games entry must not use emoji');
const desktop=fs.readFileSync('scripts/neis-game-connectors-v1.js','utf8');
assert.match(nav,/neis-mobile-game-icon neis-connect-rail-icon[^]*?♟<\/span>/,'mobile uses chess pawn with desktop class');
assert.match(desktop,/neis-connect-rail-icon[^]*?♟<\/span>/,'mobile and desktop share exact Games icon');
assert.match(ui,/\.circle-create-button::before/,'mobile Circle create button shows one plus');
assert.match(ui,/overflow:hidden!important;text-overflow:ellipsis/,'home composer text never wraps');
assert.match(games,/flex-flow:row nowrap!important/,'mobile Home actions never wrap');
assert.match(ai,/syncMobileViewport/,'Timetable overlay has visual viewport tracking');
assert.match(ai,/if\(field && !window\.matchMedia/,'opening Timetable AI avoids auto-open keyboard on mobile');

const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox']});
try{
 for(const width of [360,390,430,600]){
  const page=await browser.newPage({viewport:{width,height:800},isMobile:true,hasTouch:true});
  page.setDefaultTimeout(9000);
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1">'+
  '<div id="view" class="view"><section class="hero"><div class="hero-main"><div class="neis-home-actions">'+
  '<button class="primary" data-nav="circles">Explore Circles</button>'+
  '<button class="secondary" data-nav="connections">Your connections</button>'+
  '<a href="https://appy.neiscircle.site/" class="primary neis-home-appy-link">APPY</a>'+
  '</div></div></section><div class="page-title"><h1>Circles</h1>'+
  '<button aria-label="New circle" class="primary circle-create-button" data-new-circle>+ New circle</button></div>'+
  '<div class="composer-bar"><div class="avatar">EA</div><button data-action="compose">Share something useful...</button>'+
  '<button data-action="compose" class="compose">+</button></div></div>'+
  '<section id="ttAiPanel" class="ttai-panel"><header class="ttai-header">Timetable AI</header>'+
  '<div class="ttai-chat"><p class="ttai-bubble">Message A</p><p class="ttai-bubble">Message B</p></div>'+
  '<footer class="ttai-footer"><form class="ttai-compose"><textarea class="ttai-input"></textarea></form></footer></section>');
  await page.addStyleTag({content:':root{--accent:#1c9c83;--accent-contrast:#fff;--ink:#193d34;--card:#fff;--line:#d0ded9;--soft:#edf4f1} .hero-main{padding:16px}.composer-bar{padding:10px;display:flex}.avatar{flex:0 0 40px}.ttai-panel{display:flex;flex-direction:column;position:fixed}'});
  await page.addStyleTag({path:'styles/neis-game-connectors-v1.css'});
  await page.addStyleTag({path:'styles/ui-v14.css'});
  await page.addStyleTag({path:'styles/timetable-ai-v1.css'});
  const result=await page.evaluate(()=>{
   const actions=document.querySelector('.neis-home-actions');
   const children=[...actions.children].map(x=>x.getBoundingClientRect());
   const row=actions.getBoundingClientRect();
   const create=document.querySelector('.circle-create-button').getBoundingClientRect();
   const input=document.querySelector('.composer-bar > button[data-action="compose"]');
   const composer=getComputedStyle(input);
   const dialog=document.querySelector('.ttai-panel');
   dialog.style.setProperty('--ttai-visible-height','620px');
   dialog.style.setProperty('--ttai-visible-top','0px');
   const messages=document.querySelector('.ttai-chat').getBoundingClientRect();
   return {
    oneRow:children.every(x=>Math.abs(x.top-children[0].top)<2),
    fits:children.every(x=>x.left>=row.left-2&&x.right<=row.right+2),
    square:Math.abs(create.width-create.height)<2,
    composerSingleLine:composer.whiteSpace==='nowrap'&&composer.textOverflow==='ellipsis',
    paneHasHeight:messages.height>150
   };
  });
  assert.equal(result.oneRow,true,'all Home buttons remain on one row at '+width);
  assert.equal(result.fits,true,'no clipped Home buttons at '+width);
  assert.equal(result.square,true,'Circles create icon square at '+width);
  assert.equal(result.composerSingleLine,true,'composer stays single-line at '+width);
  assert.equal(result.paneHasHeight,true,'AI conversation remains visible at '+width);
  assert.deepEqual(errors,[],'no page errors');
  await page.close();
 }
 console.log('NEIS_MOBILE_UI_POLISH=PASS');
}finally{await browser.close()}
