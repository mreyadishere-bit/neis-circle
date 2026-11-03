import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright';

const js=fs.readFileSync('scripts/neis-game-connectors-v1.js','utf8');
const css=fs.readFileSync('styles/neis-game-connectors-v1.css','utf8');
const html=fs.readFileSync('index.html','utf8');
assert.ok(html.includes('scripts/neis-game-connectors-v1.js')&&!html.includes('<script src="scripts/neis-play-v1.js'),'legacy in-app game engine is no longer loaded');
assert.ok(js.includes('start_direct_conversation')&&js.includes('circle_messages'),'DM and Circle invites retained');
assert.ok(!js.includes('setInterval(')&&!js.includes('chess.js@'),'no game polling or local chess engine');
assert.ok(css.includes('@media(max-width:560px)')&&css.includes('@media(max-width:800px)'),'responsive modal sizes');

const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox']});
try {
 for(const width of [360,768,1366]){
  const page=await browser.newPage({viewport:{width,height:850}});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.setContent('<header>NEIS Circle</header><nav class="rail-nav"><button data-nav="library">Saved</button></nav><nav class="bottom-nav"><button data-mobile-more>More</button></nav><main id="view"><section id="messages-view"><form id="liveChatForm"><textarea></textarea></form></section></main>');
  await page.evaluate(()=>{
   window.authUser={id:'me'};
   window.state={view:'messages',lang:'en',follows:[{follower_id:'me',following_id:'friend',status:'accepted'},{follower_id:'friend',following_id:'me',status:'accepted'}],members:[{id:'friend',full_name:'Test Friend',username:'testfriend'}],circleRows:[{id:'c1',name:'Math Club'}],circleMembers:[{circle_id:'c1',user_id:'me',status:'active'}]};
   window.__sent=[];
   const fixtures={
    follows:window.state.follows,
    circle_members:window.state.circleMembers,
    profiles:window.state.members,
    circles:window.state.circleRows
   };
   window.sb={
    from(table){
     return {
      select(){return this},
      or(){return this},
      eq(){return this},
      in(){return this},
      then(resolve,reject){return Promise.resolve({data:fixtures[table]||[],error:null}).then(resolve,reject)},
      insert(payload){window.__sent.push({table,payload});return Promise.resolve({error:null})}
     };
    },
    rpc(name,args){window.__sent.push({name,args});return Promise.resolve({data:name==='start_direct_conversation'?'conversation-1':true,error:null})}
   };
  });
  await page.addStyleTag({path:'styles/neis-game-connectors-v1.css'});
  await page.addScriptTag({path:'scripts/neis-game-connectors-v1.js'});
  await page.locator('[data-neis-connect-open]').first().click();
  await page.locator('#neisGamesOverlay').waitFor();
  assert.equal(await page.locator('.neis-connect-card').count(),13,'thirteen carefully chosen games in catalog');
  assert.equal(await page.locator('.neis-connect-cover svg').count(),14,'distinct vector covers on every card and active game');
  assert.equal(await page.locator('#messages-view').count(),1,'original NEIS chat remains in DOM');

  await page.locator('[data-game="choose:chesscom"]').click();
  assert.ok((await page.locator('.neis-connect-selected').innerText()).includes('Chess.com'));
  await page.locator('#neisGameLink').fill('https://evil.example/?to=chess.com');
  await page.locator('[data-game="invite"]').click();
  assert.ok((await page.locator('.neis-connect-notice').innerText()).includes('does not belong'),'reject misleading off-domain links without closing invite panel');

  await page.locator('#neisGameLink').fill('https://link.chess.com/play/ixm2tD');
  await page.locator('[data-game="invite"]').click();
  await page.locator('[data-game="toggle:user:friend"]').click();
  await page.locator('[data-game="toggle:circle:c1"]').click();
  await page.locator('[data-game="send"]').click();
  await page.waitForFunction(()=>window.__sent.some(x=>x.table==='messages')&&window.__sent.some(x=>x.table==='circle_messages'));
  const posted=await page.evaluate(()=>window.__sent);
  assert.equal(posted.find(x=>x.table==='messages').payload.conversation_id,'conversation-1');
  assert.ok(posted.find(x=>x.table==='circle_messages').payload.body.includes('link.chess.com/play/ixm2tD'),'Chess.com official invitation preserved');
  await page.locator('.neis-connect-notice.success').waitFor();

  assert.ok(await page.locator('.neis-connect-dialog').evaluate(x=>x.scrollWidth<=x.clientWidth+2),'dialog does not overflow at '+width+'px');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#neisGamesOverlay').count(),0,'Escape closes modal');
  assert.equal(await page.locator('#messages-view').count(),1,'chat stays untouched');
  assert.equal(errors.length,0,'browser errors at '+width+'px: '+errors.join('; '));
  await page.close();
 }
 console.log('NEIS_GAME_HUB_V2_RESPONSIVE_INVITES=PASS');
}finally{
 await browser.close();
}
