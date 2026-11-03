import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright';

const js=fs.readFileSync('scripts/neis-game-connectors-v1.js','utf8');
const css=fs.readFileSync('styles/neis-game-connectors-v1.css','utf8');
const html=fs.readFileSync('index.html','utf8');
assert.ok(html.includes('scripts/neis-game-connectors-v1.js')&&!html.includes('<script src="scripts/neis-play-v1.js'),'legacy in-app game engine is no longer loaded');
assert.ok(js.includes('start_direct_conversation')&&js.includes('circle_messages'),'DM and Circle invites retained');
assert.ok(!js.includes('neis-game-provider')&&!js.includes('window.open('),'no popup/window.open for external games');
assert.ok(js.includes('target="_blank" rel="noopener noreferrer"'),'game launch links use native secure new-tab navigation');
assert.ok(js.includes('class="neis-rail-label"'),'Games button has expanded-sidebar label');

assert.ok(!js.includes('setInterval(')&&!js.includes('chess.js@'),'no game polling or local chess engine');
assert.ok(css.includes('@media(max-width:560px)')&&css.includes('@media(max-width:800px)'),'responsive modal sizes');
assert.ok(js.includes('enhanceChatMessageText')&&js.includes('neis-connect-recipient'),'game invite chat cards retained');
assert.ok(js.includes('if(language===currentGameLanguage)return'),'ignore redundant language mutations');
assert.ok(js.includes('if(!inChat&&!fullViewChange)'),'ignore unrelated post/feed changes');
assert.ok(js.includes('void loadRecipients();'),'lazy recipients available when invited');
assert.match(html,/<script[^>]*src="scripts\/neis-game-connectors-v1\.js\?v=[^"]+"[^>]*\basync\b/,'nonessential Games script does not block DOMContentLoaded');
assert.ok(/neis-game-connectors-v1\.css[^>]+media="print"/.test(html),'nonessential Games stylesheet does not block the initial paint');
assert.ok(fs.readFileSync('scripts/navigation-v14.js','utf8').includes('neis-mobile-game-entry'),'Games appears in mobile More menu');

const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox']});
try {
 for(const width of [360,768,1366]){
  const page=await browser.newPage({viewport:{width,height:850}});
  page.setDefaultTimeout(9000); // Fail on a broken UI instead of hanging the release queue.
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.setContent('<header>NEIS Circle</header><aside class="rail neis-hover-rail"><nav class="rail-nav"><button data-nav="library">Saved</button></nav></aside><nav class="bottom-nav"><button data-mobile-more>More</button></nav><div id="mobileNavRoot"></div><main id="view"><section id="messages-view"><form id="liveChatForm"><button type="button" data-neis-connect-open class="neis-connect-chat-trigger">Games</button><textarea></textarea></form><form id="circleChatForm"><button type="button" data-neis-connect-open class="neis-connect-chat-trigger">Games</button><textarea></textarea></form><div id="chatFlow" class="chat-flow"></div></section></main>');
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
  // Supply only the primary-button theme used by the comparison, not the
  // whole production layout CSS (which hides the desktop rail at 360px).
  await page.addStyleTag({content:':root{--accent:#2676b5} button{font:inherit;color:inherit} .primary{height:43px;padding:0 16px;border:0;border-radius:13px;background:var(--accent);color:#fff;font-weight:700}'});
  await page.addStyleTag({path:'styles/neis-game-connectors-v1.css'});
  await page.evaluate(()=>{for(let i=0;i<10;i++){const b=document.createElement('button');b.type='button';b.dataset.neisConnectOpen='1';b.textContent='Games';document.querySelector('.bottom-nav').before(b)}});
  await page.addScriptTag({path:'scripts/navigation-v14.js'});
  await page.addScriptTag({path:'scripts/neis-game-connectors-v1.js'});
  assert.equal(await page.locator('.bottom-nav').evaluate(el=>el.parentElement.querySelectorAll(':scope > button[data-neis-connect-open]').length),0,'remove duplicate buttons outside the nav');
  assert.equal(await page.locator('.bottom-nav > [data-neis-connect-open]').count(),0,'keep original five-button mobile navigation');
  assert.equal(await page.locator('#liveChatForm [data-neis-connect-open],#circleChatForm [data-neis-connect-open]').count(),0,'Games button removed from both chat composers');
  assert.equal(await page.locator('.rail-nav [data-neis-connect-open] .neis-rail-label').innerText(),'Games','desktop Games sidebar label is visible in the markup');
  assert.equal(await page.locator('.rail-nav [data-neis-connect-open] .neis-rail-label').count(),1,'only one desktop Games label exists');
  await page.locator('[data-neis-connect-open]').first().click();
  await page.locator('#neisGamesOverlay').waitFor();
  assert.equal(await page.locator('.neis-connect-card').count(),13,'thirteen carefully chosen games in catalog');
  assert.equal(await page.locator('.neis-connect-list-heading,.neis-connect-provider-note').count(),0,'redundant Discover Games and Official Sites headers removed');
  assert.equal(await page.locator('.neis-connect-filters .neis-connect-appy-link').count(),0,'APPY removed from Games filters');
  assert.equal(await page.locator('.neis-connect-filters [data-game^="filter:"]').count(),5,'all category filters remain');
  // Render the actual home banner actions after Games initialises, then confirm the
  // shortcut is inserted next to Explore Circles and Your connections.
  await page.locator('#view').evaluate(view=>{
   const hero=document.createElement('section');hero.className='hero';
   hero.innerHTML='<div class="hero-main"><div style="display:flex;gap:8px"><button class="primary" data-nav="circles">Explore Circles</button><button class="secondary" data-nav="connections">Your connections</button></div></div>';
   view.prepend(hero);
  });
  const appy=page.locator('#view .hero-main .neis-home-appy-link');
  await appy.waitFor();
  assert.equal(await appy.count(),1,'one APPY action in home banner');
  assert.equal((await appy.innerText()).trim(),'APPY','APPY has no arrow icon');
  assert.equal(await appy.evaluate(el=>el.classList.contains('primary')),true,'APPY uses same primary class as Explore Circles');
  assert.equal(await appy.evaluate(el=>el.classList.contains('secondary')),false,'APPY no longer uses secondary white styling');
  const matchingStyles=await appy.evaluate(el=>{
   const reference=el.closest('.hero-main').querySelector('[data-nav="circles"]');
   const a=getComputedStyle(el),b=getComputedStyle(reference);
   return ['backgroundColor','color','borderRadius','height','paddingLeft','paddingRight','fontWeight','fontSize','lineHeight','fontFamily']
     .every(property=>a[property]===b[property]);
  });
  assert.equal(matchingStyles,true,'APPY matches primary button visual properties');
  // Verify dark mode specifically, since its old light-tinted hero could
  // create poor contrast, and its accent-contrast may change with the theme.
  await page.evaluate(()=>document.documentElement.dataset.theme='dark');
  const darkHero=await page.locator('.hero-main').evaluate(el=>{
   const style=getComputedStyle(el);
   const h=getComputedStyle(el.querySelector('button.primary'));
   const appy=getComputedStyle(el.querySelector('a.neis-home-appy-link'));
   const rgb=style.color.match(/[0-9]+(?:[.][0-9]+)?/g)?.slice(0,3).map(Number)||[];
   return {
    background:style.backgroundImage,
    textLight:rgb.length===3&&rgb.every(v=>v>220),
    actionSame:['backgroundColor','color','fontSize','lineHeight','fontWeight','height','borderRadius'].every(k=>h[k]===appy[k])
   };
  });
  assert.ok(darkHero.background.includes('gradient'),'dark hero must use dark gradient instead of old pale mint');
  assert.equal(darkHero.textLight,true,'dark hero text has high contrast');
  assert.equal(darkHero.actionSame,true,'APPY and Explore Circles remain identical in dark mode');
  await page.evaluate(()=>document.documentElement.dataset.theme='light');

  assert.equal(await appy.getAttribute('href'),'https://appy.neiscircle.site/','APPY opens the requested website');
  assert.equal(await appy.getAttribute('target'),'_blank','APPY opens in a separate browser tab');
  assert.equal(await appy.getAttribute('rel'),'noopener noreferrer','APPY uses safe new-tab navigation');
  assert.equal(await appy.evaluate(el=>el.previousElementSibling?.dataset.nav),'connections','APPY is immediately after Your connections');
  assert.equal(await page.locator('#view .hero-main .neis-home-actions').count(),1,'home actions wrap on small screens');
  await page.locator('#view .hero').evaluate(el=>el.replaceWith(el.cloneNode(true)));
  await page.waitForTimeout(30);
  assert.equal(await appy.count(),1,'home re-render never duplicates the APPY button');
  const spuriousAppyMutations=await page.evaluate(async()=>{
   const hero=document.querySelector('#view .hero-main');
   let count=0;
   const observer=new MutationObserver(records=>{count+=records.length});
   observer.observe(hero,{childList:true,subtree:true});
   // Force a harmless view-level update. It must not rewrite APPY children
   // or recursively trigger more mutations in the home hero.
   document.querySelector('#view').append(document.createElement('span'));
   await new Promise(resolve=>setTimeout(resolve,40));
   observer.disconnect();
   return count;
  });
  assert.equal(spuriousAppyMutations,0,'APPY home sync stays idempotent and cannot cause an observer loop');

  assert.equal(await page.locator('.neis-connect-cover svg').count(),14,'distinct vector covers on every card and active game');
  assert.equal(await page.evaluate(()=>window.__reads.length),0,'opening games must not query contacts or Circles');
  assert.equal(await page.locator('#messages-view').count(),1,'original NEIS chat remains in DOM');

  await page.locator('[data-game="choose:chesscom"]').click();
  assert.ok((await page.locator('.neis-connect-selected').innerText()).includes('Chess.com'));
  const launch=page.locator('.neis-connect-selected a.neis-connect-launch');
  assert.equal(await launch.getAttribute('href'),'https://www.chess.com/play/online/friend','launch targets official game URL');
  assert.equal(await launch.getAttribute('target'),'_blank','launch opens native new tab');
  assert.equal(await launch.getAttribute('rel'),'noopener noreferrer','launch isolates tab from NEIS Circle');
  assert.equal(await page.locator('.neis-connect-selected [data-game="start"]').count(),0,'no JavaScript popup launcher remains');
  const account=page.locator('.neis-connect-selected a.neis-connect-account');
  assert.equal(await account.getAttribute('target'),'_blank','account link opens new tab');
  await page.locator('[data-game="choose:wayground"]').click();
  const join=page.locator('.neis-connect-selected a.neis-connect-secondary');
  assert.equal(await join.getAttribute('target'),'_blank','join-game link opens new tab');
  await page.locator('[data-game="choose:chesscom"]').click();
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

  await page.evaluate(()=>{window.state.lang='ar';document.documentElement.lang='ar';document.documentElement.dir='rtl'});
  await page.locator('[data-game="filter:chess"]').click();
  assert.equal(await page.locator('.rail-nav [data-neis-connect-open] .neis-rail-label').innerText(),'الألعاب','sidebar Games label follows Arabic locale');
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
