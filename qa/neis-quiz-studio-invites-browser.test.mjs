import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox']});
const CODE='A1B2C3D4E5F60718';
function setup(page){
 return page.evaluate((code)=>{
  window.state={view:'home',lang:'en',follows:[],circleRows:[],circleMembers:[],members:[]};
  window.authUser={id:'student-1'};
  window.nav=v=>{window.state.view=v;document.querySelector('#view').innerHTML='<div id="home-view">Home</div>'};
  const tables={neis_play_decks:[],neis_play_daily:[],neis_play_championships:[],neis_quizzes:[],neis_quiz_questions:[]};
  const query=(table)=>{
   const q={
    select(){return q},order(){return q},eq(){return q},gte(){return q},lte(){return q},
    limit(){return Promise.resolve({data:tables[table]||[],error:null})},
    insert(obj){
     if(table==='neis_quizzes'){
      q.inserted={id:'quiz-1',owner_id:'student-1',title:obj.title,subject:obj.subject,visibility:'public'};
     }
     return q;
    },
    single(){return Promise.resolve({data:q.inserted,error:null})}
   };return q;
  };
  window.__quizAdded=[];
  window.__inviteJoined=0;
  window.__aiCalled=0;
  window.sb={
   from:query,
   rpc(name,args){
    if(name==='neis_play_my_rooms')return Promise.resolve({data:[],error:null});
    if(name==='neis_play_join_room'){window.__inviteJoined++;return Promise.resolve({data:'room-1',error:null})}
    if(name==='neis_play_room_snapshot')return Promise.resolve({data:{id:'room-1',code,creator_id:'student-2',game:'sketch',title:'Invited drawing room',status:'waiting',members:[{id:'student-2'},{id:'student-1'}],events:[],settings:{}},error:null});
    if(name==='neis_quiz_add_question'){window.__quizAdded.push(args);return Promise.resolve({data:'q-1',error:null})}
    return Promise.resolve({data:null,error:{message:'Unsupported mock '+name}});
   },
   functions:{invoke(name,{body}){window.__aiCalled++;window.__aiRequest=body;return Promise.resolve({data:{questions:[{prompt:'Which quantity is measured in ohms?',options:['Resistance','Current','Power','Energy'],correct_index:0,explanation:'Resistance has units of ohms.'}]},error:null})}}
  };
 },CODE);
}
try{
 for(const width of [1440,390]){
  const page=await browser.newPage({viewport:{width,height:900}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://neiscircle.site/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<nav class="rail-nav"><button data-nav="library">Saved</button></nav><nav class="bottom-nav"></nav><div id="view"><div id="home-view">Home</div></div>'}));
  await page.goto('https://neiscircle.site/?play='+CODE+'#/play/'+CODE);
  await setup(page);
  await page.addStyleTag({path:'styles/neis-play-v1.css'});
  await page.addScriptTag({path:'scripts/neis-play-v1.js'});
  await page.getByText('Invited drawing room').waitFor();
  assert.equal(await page.evaluate(()=>window.__inviteJoined),1,'invite auto-joins without manual navigation');
  assert.ok((await page.locator('#neisPlayRoot').innerText()).includes(CODE),'correct room opens');
  await page.locator('#neisPlayRoot [data-play="close"]').click();
  assert.equal(await page.locator('#neisPlayRoot').count(),0,'closing leaves the Play view');
  assert.ok(!(await page.url()).includes('?play='),'closing clears invite query');
  assert.ok(!(await page.url()).includes('#/play/'),'closing clears invite hash');
  await page.locator('.rail-nav [data-neis-play-open]').click();
  await page.locator('#neisPlayRoot [data-play="decks"]').click();
  await page.locator('[data-play-form="quiz-new"] [name="title"]').fill('Physics fundamentals');
  await page.locator('[data-play-form="quiz-new"] [name="subject"]').fill('Electricity');
  await page.locator('[data-play-form="quiz-new"] button[type=submit]').click();
  await page.locator('[data-play-form="quiz-generate"]').waitFor();
  assert.equal(await page.locator('[data-play-form="quiz-question"]').count(),0,'manual form hidden in AI mode');
  await page.locator('[data-play-form="quiz-generate"] [name="topic"]').fill('Ohm law');
  await page.locator('[data-play-form="quiz-generate"] button[type=submit]').click();
  await page.locator('[data-play-form="quiz-review"]').waitFor();
  assert.equal(await page.evaluate(()=>window.__aiCalled),1,'AI request issued from topic only');
  await page.locator('[data-play-form="quiz-review"] [name="p0"]').fill('What unit measures resistance?');
  await page.locator('[data-play-form="quiz-review"] button[type=submit]').click();
  await page.waitForFunction(()=>window.__quizAdded.length===1);
  assert.equal(await page.evaluate(()=>window.__quizAdded[0].p_prompt),'What unit measures resistance?','edits saved to database RPC');
  assert.equal(errors.length,0,'uncaught browser errors '+errors.join(', '));
  await page.close();
 }
 console.log('NEIS_QUIZ_STUDIO_INVITES_BROWSER=PASS');
}finally{await browser.close()}
