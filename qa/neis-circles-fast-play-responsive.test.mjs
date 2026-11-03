import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright';
const social=fs.readFileSync('scripts/05-social.js','utf8');
const play=fs.readFileSync('scripts/neis-play-v1.js','utf8');
const css=fs.readFileSync('styles/neis-play-v1.css','utf8');
assert.ok(social.includes('async function loadCirclesFast(force=false)'),'Circles bootstrap is independent');
const early=social.indexOf('const circlesEarly=loadCirclesFast();');
const heavy=social.indexOf('await coreLoad();',early);
assert.ok(early>0&&heavy>early,'Circles start before heavy feed loading');
assert.ok(social.includes('state.circlesLoading?')&&social.includes('dataErrors?.circles?'),'Loading and error states not false empty');
assert.ok(social.includes('data-circle-retry'),'User can retry a failed Circle load');
assert.ok(social.includes('circlesFastPromise')&&social.includes('circlesFastLoadedAt'),'Coalesced short-lived Circle cache');
assert.ok(!social.includes("if(!circleRes.error)state.circleRows="),'Circles no longer wait on chat promise');
assert.ok(play.includes("if(S.open&&!root()){S.open=false"),'Play exits when routed DOM is replaced');
assert.ok(play.includes('playListLoadingPromise')&&play.includes('playListLastLoaded'),'Game list requests deduplicated');
assert.ok(css.includes('max-width:1120px')&&css.includes('@media(max-width:650px)'),'Compact responsive game UI');
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox']});
try{
 for(const width of [360,768,1366]){
  const page=await browser.newPage({viewport:{width,height:900}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setContent('<nav class="rail-nav"><button data-nav="messages">Messages</button></nav><nav class="bottom-nav"><button data-mobile-more>More</button></nav><div id="view"><p>Messages</p></div>');
  await page.evaluate(()=>{
   window.authUser={id:'u1'};
   window.state={view:'messages',lang:'en',follows:[],circleRows:[],circleMembers:[],members:[],isAdmin:false};
   window.nav=view=>{window.state.view=view;document.querySelector('#view').innerHTML='<section id="messages-view">Messages shown</section>'};
   window.sb={from:()=>{const q={select:()=>q,order:()=>q,limit:()=>Promise.resolve({data:[],error:null}),gte:()=>q,lte:()=>q};return q},rpc:()=>Promise.resolve({data:[],error:null})};
  });
  await page.addStyleTag({path:'styles/neis-play-v1.css'});
  await page.addScriptTag({path:'scripts/neis-play-v1.js'});
  await page.locator('.rail-nav [data-neis-play-open]').click();
  await page.locator('#neisPlayRoot').waitFor();
  await page.evaluate(()=>window.nav('messages')); // same state.view as when Play opened!
  await page.locator('#messages-view').waitFor();
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#neisPlayRoot').count(),0,'Play must not reclaim same-route Messages');
  await page.locator('.rail-nav [data-neis-play-open]').click();
  await page.locator('#neisPlayRoot').waitFor();
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  assert.ok(overflow<=2,'No horizontal overflow at '+width+'px: '+overflow);
  assert.equal(errors.length,0,'Browser errors at '+width+': '+errors.join('; '));
  await page.close();
 }
 console.log('NEIS_CIRCLES_FAST_PLAY_NAV_RESPONSIVE=PASS');
}finally{await browser.close()}
