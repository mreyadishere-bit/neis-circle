import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright';
const js=fs.readFileSync('scripts/neis-game-connectors-v1.js','utf8');
const css=fs.readFileSync('styles/neis-game-connectors-v1.css','utf8');
const html=fs.readFileSync('index.html','utf8');
assert.ok(html.includes('scripts/neis-game-connectors-v1.js')&&!html.includes('<script src="scripts/neis-play-v1.js'),'old game engine no longer loaded');
assert.ok(js.includes("start_direct_conversation")&&js.includes("circle_messages"),'DM and Circle invites retained');
assert.ok(!js.includes('setInterval(')&&!js.includes('chess.js@'),'no game polling or local chess rules');
assert.ok(css.includes('@media(max-width:560px)')&&css.includes('@media(max-width:900px)'),'responsive modal');
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox']});
try{
 for(const width of [360,768,1366]){
  const page=await browser.newPage({viewport:{width,height:850}});
  const errors=[];page.on('pageerror',x=>errors.push(x.message));
  await page.setContent('<header>NEIS Circle</header><nav class="rail-nav"><button data-nav="library">Saved</button></nav><nav class="bottom-nav"><button data-mobile-more>More</button></nav><main id="view"><section id="messages-view"><form id="liveChatForm"><textarea></textarea></form></section></main>');
  await page.evaluate(()=>{
   window.authUser={id:'me'};
   window.state={view:'messages',lang:'en',follows:[{follower_id:'me',following_id:'friend',status:'accepted'},{follower_id:'friend',following_id:'me',status:'accepted'}],members:[{id:'friend',full_name:'Test Friend'}],circleRows:[{id:'c1',name:'Math Club'}],circleMembers:[{circle_id:'c1',user_id:'me',status:'active'}]};
   window.__sent=[];
   window.sb={
    from(table){return {insert(payload){window.__sent.push({table,payload});return Promise.resolve({error:null})}}},
    rpc(name,args){window.__sent.push({name,args});return Promise.resolve({data:'conversation-1',error:null})}
   };
  });
  await page.addStyleTag({path:'styles/neis-game-connectors-v1.css'});
  await page.addScriptTag({path:'scripts/neis-game-connectors-v1.js'});
  await page.locator('[data-neis-connect-open]').first().click();
  await page.locator('#neisGamesOverlay').waitFor();
  assert.equal(await page.locator('.neis-connect-card').count(),7,'seven providers listed');
  assert.equal(await page.locator('#messages-view').count(),1,'original chat remains in DOM');
  await page.locator('[data-game="choose:skribbl"]').click();
  assert.ok((await page.locator('.neis-connect-selected').innerText()).includes('skribbl.io'));
  await page.locator('#neisGameLink').fill('https://evil.example/?to=skribbl.io');
  await page.locator('[data-game="invite"]').click();
  assert.ok((await page.locator('.neis-connect-notice').innerText()).includes('valid HTTPS'),'reject unsafe invitations');
  await page.locator('#neisGameLink').fill('https://skribbl.io/?private=abc');
  await page.locator('[data-game="invite"]').click();
  await page.locator('[data-game="send-user:friend"]').click();
  await page.waitForFunction(()=>window.__sent.some(x=>x.table==='messages'));
  await page.locator('[data-game="send-circle:c1"]').click();
  await page.waitForFunction(()=>window.__sent.some(x=>x.table==='circle_messages'));
  const posted=await page.evaluate(()=>window.__sent);
  assert.equal(posted.find(x=>x.table==='messages').payload.conversation_id,'conversation-1');
  assert.ok(posted.find(x=>x.table==='circle_messages').payload.body.includes('https://skribbl.io/'));
  assert.ok((await page.locator('.neis-connect-dialog').evaluate(x=>x.scrollWidth<=x.clientWidth+2)),'dialog does not overflow');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#neisGamesOverlay').count(),0,'Escape closes modal');
  assert.equal(await page.locator('#messages-view').count(),1,'chat stays untouched');
  assert.equal(errors.length,0,'browser errors '+width+': '+errors.join(';'));
  await page.close();
 }
 console.log('NEIS_EXTERNAL_GAMES_RESPONSIVE_INVITES=PASS');
}finally{await browser.close()}
