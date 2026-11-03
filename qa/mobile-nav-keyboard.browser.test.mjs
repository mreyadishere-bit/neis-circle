import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright';

const nav=fs.readFileSync('scripts/navigation-v14.js','utf8');
const css=fs.readFileSync('styles/ui-v14.css','utf8');
const chat=fs.readFileSync('scripts/05-social.js','utf8');
const magnus=fs.readFileSync('scripts/magnus-neis-v1.js','utf8');
const timetable=fs.readFileSync('scripts/timetable-ai-v1.js','utf8');
assert.ok(nav.includes('list.scrollTop=0')&&nav.includes('focus({preventScroll:true})'),'More sheet opens from top without focus scrolling');
assert.ok(css.includes('overflow-anchor:none'),'More list cannot restore stale anchor');
assert.ok(chat.includes('if(dismissSoftKeyboardOnSend())input.blur()'),'Direct and Circle sends dismiss mobile keyboard');
assert.ok(!chat.includes("sendButton.addEventListener('pointerdown'")&&!chat.includes("circleSendButton.addEventListener('pointerdown'"),'Send does not force keyboard back up on pointerdown');
assert.ok(chat.includes('if(!dismissSoftKeyboardOnSend()&&input.isConnected)input.focus'),'desktop composer keeps expected focus');
assert.ok(magnus.includes('if(mobileSend())input.blur()')&&magnus.includes('if(!mobileSend()&&input.isConnected)'),'Magnus mobile send does not auto-focus');
assert.ok(timetable.includes("classList.contains('neis-native-app'))input.blur()"),'Timetable AI mobile send dismisses keyboard');

const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox']});
try{
 for(const viewport of [{width:390,height:844},{width:360,height:640}]){
  const page=await browser.newPage({viewport});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><button data-mobile-more type="button">More</button><div id="mobileNavRoot"></div>');
  await page.addStyleTag({path:'styles/ui-v14.css'});
  await page.addScriptTag({path:'scripts/navigation-v14.js'});
  await page.locator('[data-mobile-more]').click();
  const list=page.locator('.mobile-nav-list');
  await list.waitFor();
  assert.equal(await list.locator('button').first().innerText(),'Connections','first item is Connections');
  await list.evaluate(el=>{el.scrollTop=el.scrollHeight});
  const scrolled=await list.evaluate(el=>el.scrollTop);
  assert.ok(scrolled>0,'mobile All tools list is scrollable');
  await page.locator('.mobile-nav-close').click();
  await page.locator('[data-mobile-more]').click();
  assert.equal(await page.locator('.mobile-nav-list').evaluate(el=>el.scrollTop),0,'every open resets scroll');
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>r())));
  assert.equal(await page.locator('.mobile-nav-list').evaluate(el=>el.scrollTop),0,'scroll remains at top after frame/focus');
  assert.ok(await page.locator('.mobile-nav-list button').first().evaluate(el=>{
   const list=el.closest('.mobile-nav-list').getBoundingClientRect();
   const item=el.getBoundingClientRect();
   return item.top>=list.top-2&&item.bottom<=list.bottom+2;
  }),'top item visible, not clipped');
  assert.equal(errors.length,0,'no JS errors in More sheet: '+errors.join('; '));
  await page.close();
 }
 const page=await browser.newPage({viewport:{width:390,height:844}});
 const errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.setContent('<div id="magnusRoot"><div class="magnus-scroll" id="magnusFlow"></div><form id="magnusForm"><textarea id="magnusInput"></textarea><button type="submit" id="magnusSend">Send</button></form></div>');
 await page.evaluate(()=>{
  window.__magnusCalls=0;
  // setContent() uses about:blank; crypto.randomUUID is secure-context only.
  if(typeof crypto.randomUUID!=='function')Object.defineProperty(crypto,'randomUUID',{configurable:true,value:()=> 'local-test-request-id'});
  window.__sbMock={
   from(){return {select(){return this},order(){return this},limit(){return Promise.resolve({data:[],error:null})}}},
   functions:{invoke:async()=>{window.__magnusCalls++;return {data:{reply:'Hello!'},error:null}}},
   rpc:async()=>({data:true,error:null})
  };
 });
 await page.addScriptTag({path:'scripts/magnus-neis-v1.js'});
 await page.evaluate(()=>{
  window.NEISMagnus.bind(document.querySelector('#magnusRoot'),{
   sb:window.__sbMock,user:{id:'test-student'},routeTo:()=>{},lang:'en'
  });
 });
 await page.waitForTimeout(40);
 await page.locator('#magnusInput').fill('Hi');
 await page.locator('#magnusInput').focus();
 await page.locator('#magnusSend').click();
 await page.waitForFunction(()=>window.__magnusCalls===1&&!!document.querySelector('.magnus-line.bot'));
 assert.equal(await page.locator('#magnusInput').evaluate(el=>document.activeElement===el),false,'Magnus input does not refocus after a mobile send');
 assert.equal(errors.length,0,'no Magnus send errors: '+errors.join('; '));
 await page.close();
 console.log('NEIS_MOBILE_MORE_AND_SEND_KEYBOARD=PASS');
}finally{
 await browser.close();
}
