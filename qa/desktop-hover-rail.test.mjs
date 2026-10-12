import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
const css=fs.readFileSync('styles/desktop-hover-rail-v1.css','utf8');
const script=fs.readFileSync('scripts/desktop-hover-rail-v1.js','utf8');
const baseCss=':root{--card:#fff;--line:#ddd;--ink:#202a26;--accent:#0a7e52;--muted:#68746e;--soft:#eef5f0;--paper:#f8faf9}*{box-sizing:border-box}'+
'body{margin:0;background:var(--paper);color:var(--ink)}'+
'.rail{position:fixed;z-index:30;left:0;top:0;bottom:0;width:84px;display:flex;flex-direction:column;align-items:center;padding:22px 14px;border-right:1px solid var(--line);background:var(--card)}'+
'body.rtl .rail{left:auto;right:0;border-left:1px solid var(--line);border-right:0}'+
'.logo{width:50px;height:50px;border-radius:18px;border:0;background:var(--accent);color:#fff}'+
'.rail-nav{display:grid;gap:9px;margin-top:34px}'+
'.nav-btn{position:relative;width:48px;height:48px;display:grid;place-items:center;border:0;border-radius:16px;background:transparent;color:var(--muted)}'+
'.nav-btn svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.8}'+
'.nav-btn.active{background:var(--ink);color:var(--card)}'+
'.stage{margin-left:84px;min-height:1200px}.top{margin-left:84px;height:80px}'+
'body.rtl .stage,body.rtl .top{margin-left:0;margin-right:84px}'+
'@media(max-width:760px){.rail{display:none}.top,.stage{margin:0}}';
const items=[['home','Home'],['discover','Discover'],['circles','Circles'],['messages','Messages'],
 ['connections','Connections'],['library','Saved'],['opportunities','Opportunities'],
 ['gallery','Gallery'],['articles','Articles'],['study','Study'],['timetable','Timetable'],
 ['admin','Admin'],['settings','Settings']];
const buttons=items.map(([id,label])=>'<button class="nav-btn'+(id==='home'?' active':'')+
 '" '+(id==='settings'?'data-action="settings"':'data-nav="'+id+'"')+
 ' title="'+label+'" aria-label="'+label+'"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/></svg></button>').join('');
const html='<!DOCTYPE html><html lang="en"><head><style>'+baseCss+'</style></head><body>'+
 '<aside class="rail"><button class="logo" data-nav="home">NC</button>'+
 '<nav class="rail-nav" aria-label="Main navigation">'+buttons+'</nav></aside>'+
 '<header class="top">NEIS Circle</header><main class="stage">Content must not jump.</main></body></html>';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1366,height:900}});
try{
 await page.setContent(html);
 await page.addStyleTag({content:css});
 await page.addScriptTag({content:script});
 await page.waitForSelector('.rail.neis-hover-rail');
 const rail=page.locator('.rail');
 const width=()=>rail.evaluate(n=>Math.round(n.getBoundingClientRect().width));
 const stageX=()=>page.locator('.stage').evaluate(n=>Math.round(n.getBoundingClientRect().x));
 assert.equal(await width(),84);
 assert.equal(await stageX(),84);
 assert.equal(await page.locator('.neis-rail-label').count(),13);
 await page.mouse.move(700,300);
 await page.mouse.move(40,160);
 await page.waitForTimeout(450);
 assert.equal(await width(),248,'expanded width');
 assert.equal(await stageX(),84,'no content reflow');
 assert.equal(await page.locator('button[data-nav="home"] .neis-rail-label').textContent(),'Home');
 assert.equal(await page.locator('button[data-nav="home"] .neis-rail-label').evaluate(n=>getComputedStyle(n).opacity),'1');
 await page.mouse.move(650,300);
 await page.waitForTimeout(470);
 assert.equal(await width(),84,'collapsed after leaving');
 await page.evaluate(()=>{
   document.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true}));
   document.querySelector('button[data-nav="home"]').focus();
 });
 await page.waitForTimeout(330);
 assert.equal(await width(),248,'keyboard focus expands');
 await page.locator('.neis-rail-pin').click();
 assert.equal(await page.locator('.neis-rail-pin').getAttribute('aria-pressed'),'true');
 await page.mouse.move(730,400);
 await page.waitForTimeout(330);
 assert.equal(await width(),248,'pinned remains open');
 await page.locator('.neis-rail-pin').click();
 await page.mouse.move(730,400);
 await page.waitForTimeout(350);
 assert.equal(await width(),84,'unpin collapses on leave');
 await page.evaluate(()=>{
   document.body.classList.add('rtl');
   document.querySelector('button.nav-btn[data-nav="home"]').setAttribute('title','الرئيسية');
   document.activeElement.blur();
 });
 await page.waitForTimeout(50);
 assert.equal(await page.locator('button[data-nav="home"] .neis-rail-label').textContent(),'الرئيسية');
 assert.equal(await rail.evaluate(n=>getComputedStyle(n).right),'0px','RTL right anchor');
 await page.setViewportSize({width:900,height:800});
 await page.waitForTimeout(50);
 assert.equal(await width(),84,'tablet unaffected');
 await page.setViewportSize({width:390,height:760});
 assert.equal(await rail.evaluate(n=>getComputedStyle(n).display),'none','mobile rail hidden');
 await page.setViewportSize({width:1366,height:900});
 await page.evaluate(()=>document.documentElement.style.setProperty('--card','#17271d'));
 const bg=await rail.evaluate(n=>getComputedStyle(n).backgroundColor);
 assert.ok(bg.includes('rgb')||bg.includes('color('),'theme background resolves');
 console.log('SIDEBAR_HOVER_BROWSER=PASS');
 console.log('SIDEBAR_RTL_DESKTOP_ONLY=PASS');
 console.log('SIDEBAR_NO_CONTENT_REFLOW=PASS');
 console.log('SIDEBAR_KEYBOARD_PIN=PASS');
}finally{await browser.close()}
