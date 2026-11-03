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
assert.ok(js.includes('enhanceChatMessageText')&&js.includes('neis-connect-recipient'),'game invite chat cards retained');
assert.ok(js.includes('if(language===currentGameLanguage)return'),'ignore redundant language mutations');
assert.ok(js.includes('if(!inChat&&!fullViewChange)'),'ignore unrelated post/feed changes');
assert.ok(js.includes('void loadRecipients();'),'lazy recipients available when invited');
assert.ok(html.includes('neis-game-connectors-v1.js?v=gamehub-perf-20261103" async'),'nonessential Games script does not block DOMContentLoaded');
assert.ok(/neis-game-connectors-v1\.css[^>]+media="print"/.test(html),'nonessential Games stylesheet does not block the initial paint');
assert.ok(fs.readFileSync('scripts/navigation-v14.js','utf8').includes('neis-mobile-game-entry'),'Games appears in mobile More menu');

const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox']});
try {
 for(const width of [360,768,1366]){
  const page=await browser.newPage({viewport:{width,height:850}});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.setContent('<header>NEIS Circle</header><nav class="rail-nav"><button data-nav="library">Saved</button></nav><nav class="bottom-nav"><button data-mobile-more>More</button></nav><div id="mobileNavRoot"></div><main id="view"><section id="messages-view"><form id="liveChatForm"><textarea></textarea></form><div id="chatFlow" class="chat-flow"></div></section></main>');
  await page.evaluate(()=>{
   window.authUser={id:'me'};
   window.state={view:'messages',lang:'en',follows:[{follower_id:'me',following_id:'friend',status:'accepted'},{follower_id:'friend',following_id:'me',status:'accepted'}],members:[{id:'friend',full_name:'Test Friend',username:'testfriend'}],circleRows:[{id:'c1',name:'Math Club'}],circleMembers:[{circle_id:'c1',user_id:'me',status:'active'}]};
   window.__sent=[];
   window.__reads=[];
   const fixtures={
    follows:window.state.follows,
    circle_members:window.state.circleMembers,
    profiles:window.state.members,
    circles:window.state.circleRows
   };
   window.sb={
    from(table){
     window.__reads.push(table);
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
  await page.evaluate(()=>{for(let i=0;i<10;i++){const b=document.createElement('button');b.type='button';b.dataset.neisConnectOpen='1';b.textContent='Games';document.querySelector('.bottom-nav').before(b)}});
  await page.addScriptTag({path:'scripts/navigation-v14.js'});
  await page.addScriptTag({path:'scripts/neis-game-connectors-v1.js'});
  assert.equal(await page.locator('.bottom-nav').evaluate(el=>el.parentElement.querySelectorAll(':scope > button[data-neis-connect-open]').length),0,'remove duplicate buttons outside the nav');
  assert.equal(await page.locator('.bottom-nav > [data-neis-connect-open]').count(),0,'keep original five-button mobile navigation');
  assert.equal(await page.locator('#liveChatForm > [data-neis-connect-open]').count(),1,'one game button in chat');
  await page.locator('[data-neis-connect-open]').first().click();
  await page.locator('#neisGamesOverlay').waitFor();
  assert.equal(await page.locator('.neis-connect-card').count(),13,'thirteen carefully chosen games in catalog');
  assert.equal(await page.locator('.neis-connect-cover svg').count(),14,'distinct vector covers on every card and active game');
  assert.equal(await page.evaluate(()=>window.__reads.length),0,'opening games must not query contacts or Circles');
  assert.equal(await page.locator('#messages-view').count(),1,'original NEIS chat remains in DOM');

  await page.locator('[data-game="choose:chesscom"]').click();
  assert.ok((await page.locator('.neis-connect-selected').innerText()).includes('Chess.com'));
  await page.locator('#neisGameLink').fill('https://evil.example/?to=chess.com');
  await page.locator('[data-game="invite"]').click();
  assert.ok((await page.locator('.neis-connect-notice').innerText()).includes('does not belong'),'reject misleading off-domain links without closing invite panel');
  assert.equal(await page.evaluate(()=>window.__reads.length),0,'invalid invites must not query contacts');

  await page.locator('#neisGameLink').fill('https://link.chess.com/play/ixm2tD');
  await page.locator('[data-game="invite"]').click();
  await page.waitForFunction(()=>window.__reads.includes('follows'));
  await page.locator('[data-game="toggle:user:friend"]').click();
  await page.locator('[data-game="toggle:circle:c1"]').click();
  const oldScroll=await page.locator('.neis-connect-layout').evaluate(el=>{el.scrollTop=Math.max(0,el.scrollHeight-el.clientHeight-80);return el.scrollTop});
  await page.locator('[data-game="toggle:user:friend"]').evaluate(el=>el.click());
  const newScroll=await page.locator('.neis-connect-layout').evaluate(el=>el.scrollTop);
  assert.equal(newScroll,oldScroll,'recipient selection does not reset scroll position');
  await page.locator('[data-game="toggle:user:friend"]').evaluate(el=>el.click());
  await page.locator('[data-game="send"]').click();
  await page.waitForFunction(()=>window.__sent.some(x=>x.table==='messages')&&window.__sent.some(x=>x.table==='circle_messages'));
  const posted=await page.evaluate(()=>window.__sent);
  assert.equal(posted.find(x=>x.table==='messages').payload.conversation_id,'conversation-1');
  assert.ok(posted.find(x=>x.table==='circle_messages').payload.body.includes('link.chess.com/play/ixm2tD'),'Chess.com official invitation preserved');
  await page.locator('.neis-connect-notice.success').waitFor();

  await page.locator('#chatFlow').evaluate(el=>{
   const bubble=document.createElement('div');bubble.className='chat-message';
   const content=document.createElement('span');content.className='message-text';
   content.textContent='🎮 Join me for Chess.com\nhttps://link.chess.com/play/ixm2tD\nOpen the link to join the game.';
   bubble.append(content);el.append(bubble);
  });
  await page.locator('#chatFlow .neis-chat-game-card').first().waitFor();
  assert.ok((await page.locator('#chatFlow .neis-chat-game-card').first().getAttribute('href')).includes('link.chess.com/play/ixm2tD'),'chat invitation links to correct game');
  assert.ok((await page.locator('#chatFlow .neis-chat-game-card').first().innerText()).includes('Join game'),'English chat game CTA');
  assert.equal(await page.locator('#chatFlow .neis-chat-game-copy').count(),1,'copy link is a chat button');

  await page.evaluate(()=>{window.state.lang='ar'});
  await page.locator('[data-game="filter:chess"]').click();
  assert.match(await page.locator('.neis-connect-card-caption').first().innerText(),/[\u0600-\u06ff]/,'Arabic tags');
  await page.locator('[data-game="filter:all"]').click();
  assert.ok((await page.locator('.neis-connect-card-caption').allTextContents()).every(label=>/[\u0600-\u06ff]/.test(label)),'all 13 games have Arabic descriptions');
  await page.locator('[data-game="filter:chess"]').click();
  assert.match(await page.locator('.neis-connect-instructions').innerText(),/[\u0600-\u06ff]/,'Arabic game instructions');
  await page.locator('#chatFlow').evaluate(el=>{
   const bubble=document.createElement('div');bubble.className='chat-message';
   const content=document.createElement('span');content.className='message-text';
   content.textContent='🎮 هيا نلعب Chess.com\nhttps://link.chess.com/play/another\nافتح الرابط للانضمام إلى اللعبة.';
   bubble.append(content);el.append(bubble);
  });
  await page.locator('#chatFlow .neis-chat-game-card').nth(1).waitFor();
  assert.ok((await page.locator('#chatFlow .neis-chat-game-card').nth(1).innerText()).includes('انضم للعبة'),'Arabic chat game CTA');

  assert.ok(await page.locator('.neis-connect-dialog').evaluate(x=>x.scrollWidth<=x.clientWidth+2),'dialog does not overflow at '+width+'px');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#neisGamesOverlay').count(),0,'Escape closes modal');
  await page.locator('[data-mobile-more]').click();
  assert.equal(await page.locator('#mobileNavRoot [data-neis-connect-open]').count(),1,'Games appears exactly once in More sheet');
  await page.locator('#mobileNavRoot [data-neis-connect-open]').click();
  await page.locator('#neisGamesOverlay').waitFor();
  assert.equal(await page.locator('#mobileNavRoot [data-neis-connect-open]').count(),0,'More sheet closes when Games opens');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#messages-view').count(),1,'chat stays untouched');
  assert.equal(errors.length,0,'browser errors at '+width+'px: '+errors.join('; '));
  await page.close();
 }
 console.log('NEIS_GAME_HUB_V2_CHAT_I18N_SCROLL=PASS');
}finally{
 await browser.close();
}
