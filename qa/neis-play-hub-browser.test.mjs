import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox']});
try{
 for(const width of [1440,390]){
  const page=await browser.newPage({viewport:{width,height:900}});
  page.on('pageerror',e=>{throw e});
  await page.setContent('<nav class="rail-nav"><button data-nav="home">Home</button><button data-nav="library">Saved</button></nav><nav class="bottom-nav"><button data-mobile-more>More</button></nav><div id="view"><div class="dashboard"><div class="main-column"></div></div></div>');
  await page.evaluate(()=>{
   window.authUser={id:'student1'};
   window.state={view:'home',lang:'en',follows:[{follower_id:'student1',following_id:'student2',status:'accepted'},{follower_id:'student2',following_id:'student1',status:'accepted'}],circleRows:[],circleMembers:[],members:[]};
   window.nav=view=>{window.state.view=view;document.getElementById('view').innerHTML='<div class="dashboard"><div class="main-column"></div></div>'};
   const tables={
    neis_play_decks:[],neis_play_daily:[{day:'2026-11-03',question:'Which quantity is measured in ohms?',options:['Resistance','Current','Energy','Power']}],
    neis_play_championships:[],neis_quizzes:[]
   };
   const query=table=>({select(){return this},order(){return this},limit(){return Promise.resolve({data:tables[table]||[],error:null})},gte(){return this},lte(){return this}});
   window.sb={from:query,rpc(name){
    if(name==='neis_play_my_rooms')return Promise.resolve({data:[{id:'room1',game:'chess',title:'A friendly challenge',status:'waiting'}],error:null});
    return Promise.resolve({data:null,error:{message:'Not a mock RPC'}});
   }};
  });
  await page.addStyleTag({path:'styles/neis-play-v1.css'});
  await page.addScriptTag({path:'scripts/neis-play-v1.js'});
  await page.locator('.rail-nav [data-neis-play-open]').click();
  await page.locator('.neis-hub-intro').waitFor();
  assert.equal(await page.locator('.neis-game-card').count(),3,'three authentic game categories');
  assert.equal(await page.locator('.neis-hub-room').count(),1,'actual active room');
  assert.ok((await page.locator('.neis-hub-daily').innerText()).includes('ohms'),'show real daily question');
  assert.ok((await page.locator('.neis-hub-metrics').innerText()).includes('1'),'show real mutual connections');
  assert.equal(await page.locator('#view #neisPlayRoot').count(),1,'Play is a native stage page');
  await page.locator('#neisPlayRoot [data-play="close"]').click();
  assert.equal(await page.locator('#neisPlayRoot').count(),0);
  await page.close();
 }
 console.log('NEIS_PLAY_EDITORIAL_HUB=PASS');
}finally{await browser.close()}
