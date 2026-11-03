import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox']});
try{
 for(const width of [1440,390]){
  const page=await browser.newPage({viewport:{width,height:900}});
  const errors=[];page.on('pageerror',err=>errors.push(err.message));
  await page.setContent('<header><button data-action="notifications" id="bell">Notifications</button></header><nav class="rail-nav"><button data-nav="library">Saved</button></nav><nav class="bottom-nav"><button data-mobile-more>More</button></nav><main class="stage"><div id="view" class="view"><p>Home content</p></div></main>');
  await page.evaluate(()=>{
   window.authUser={id:'u1'};window.state={view:'home',lang:'en',isAdmin:false,posts:[],circleRows:[],follows:[],circleMembers:[],members:[]};
   window.nav=(v)=>{window.state.view=v;document.getElementById('view').innerHTML='<article id="routed-view">'+v+'</article>'};
   document.querySelector('#bell').addEventListener('click',()=>window.nav('notifications'));
   window.sb={
     from:(table)=>({select(){return this},order(){return this},limit(){return Promise.resolve({data:[],error:null})},lte(){return this},gte(){return this}}),
     rpc:(name)=>Promise.resolve({data:name==='neis_play_my_rooms'?[{id:'a',game:'chess',title:'Chess',creator_id:'u1',status:'waiting',member_count:1},{id:'a',game:'chess',title:'Chess',creator_id:'u1',status:'waiting',member_count:1},{id:'b',game:'sketch',title:'Sketch',creator_id:'u2',status:'playing',member_count:2}]:null,error:null})
   };
  });
  await page.addStyleTag({path:'styles/neis-play-v1.css'});
  await page.addScriptTag({path:'scripts/neis-play-v1.js'});
  await page.locator('.rail-nav [data-neis-play-open]').click();
  await page.locator('#neisPlayRoot').waitFor();
  await page.waitForFunction(()=>document.querySelectorAll('.neis-hub-room').length===2);
  assert.equal(await page.locator('.neis-hub-room').count(),2,'dedupes the repeated room');
  assert.equal(await page.locator('.neis-hub-room [data-play="manage:delete:a"]').count(),1,'host delete');
  assert.equal(await page.locator('.neis-hub-room [data-play="manage:leave:b"]').count(),1,'guest leave');
  await page.locator('#bell').click();
  await page.locator('#routed-view').waitFor();
  assert.equal(await page.locator('#routed-view').textContent(),'notifications','notification route survives Play');
  assert.equal(await page.locator('#neisPlayRoot').count(),0,'Play must not steal notification view');
  assert.equal(errors.length,0,'browser errors: '+errors.join(', '));
  await page.close();
 }
 console.log('NEIS_PLAY_NOTIFICATIONS_ROOM_BROWSER=PASS');
}finally{await browser.close()}
