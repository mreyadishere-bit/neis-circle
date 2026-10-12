import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

const compactCSS=fs.readFileSync('styles/desktop-hover-rail-density-v2.css','utf8');
const fluidCSS=fs.readFileSync('styles/desktop-hover-rail-fluid-v3.css','utf8');
const originalCSS=fs.readFileSync('styles/desktop-hover-rail-v1.css','utf8');
const originalJS=fs.readFileSync('scripts/desktop-hover-rail-v1.js','utf8');
const seed=Array.from({length:13},(_,i)=>{
 const keys=['home','discover','circles','messages','connections','library','opportunities',
              'gallery','articles','study','timetable','admin','settings'];
 const k=keys[i];return '<button class="nav-btn" '+
   (k==='settings'?'data-action="settings"':'data-nav="'+k+'"')+
   ' title="'+k+'" aria-label="'+k+'"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/></svg></button>';
}).join('');
const baseCSS=':root{--card:#fff;--ink:#182820;--accent:#08784a;--muted:#6a7470;'+
 '--line:#e1e4e1;--soft:#eaf1ef;--paper:#f8faf7}*{box-sizing:border-box}'+
 'body{margin:0;background:var(--paper)}'+
 '.rail{position:fixed;z-index:30;left:0;top:0;bottom:0;width:84px;display:flex;'+
 'flex-direction:column;align-items:center;padding:22px 14px;border-right:1px solid var(--line);'+
 'background:var(--card)}body.rtl .rail{left:auto;right:0;border-right:0;border-left:1px solid var(--line)}'+
 '.logo{width:50px;height:50px;border:0;border-radius:18px;background:var(--accent);color:#fff}'+
 '.rail-nav{display:grid;gap:9px;margin-top:34px}'+
 '.nav-btn{position:relative;width:48px;height:48px;display:grid;place-items:center;'+
 'border:0;border-radius:16px;background:transparent;color:var(--muted)}'+
 '.nav-btn svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.8}'+
 '.top,.stage{margin-left:84px}body.rtl .top,body.rtl .stage{margin-left:0;margin-right:84px}'+
 '@media(max-width:760px){.rail{display:none}.top,.stage{margin:0}}';
const html='<!doctype html><html><head><style>'+baseCSS+'</style></head><body>'+
 '<aside class="rail"><button class="logo" data-nav="home">NC</button><nav class="rail-nav">'+
 seed+'</nav></aside><main class="stage">NEIS Circle</main></body></html>';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1366,height:900}});
try{
 await page.setContent(html);
 await page.addStyleTag({content:originalCSS});
 await page.addStyleTag({content:compactCSS});
 await page.addStyleTag({content:fluidCSS});
 await page.addScriptTag({content:originalJS});
 await page.waitForSelector('.neis-hover-rail');
 const nav=page.locator('.rail-nav');
 const rail=page.locator('.rail');
 async function check(height){
   await page.setViewportSize({width:1366,height});
   await page.mouse.move(680,300);
   await page.mouse.move(40,160);
   await page.waitForTimeout(370);
   const m=await page.evaluate(()=>{
     const rail=document.querySelector('.rail');
     const nav=rail.querySelector('.rail-nav');
     const items=[...nav.querySelectorAll('.nav-btn')];
     const icons=items.map(b=>b.querySelector('svg')?.getBoundingClientRect());
     const labels=items.map(b=>b.querySelector('.neis-rail-label')?.getBoundingClientRect());
     const br=rail.getBoundingClientRect(), nr=nav.getBoundingClientRect();
     const footer=rail.querySelector('.neis-rail-footer').getBoundingClientRect();
     return {
       opened:rail.classList.contains('is-expanded'),
       navScroll:nav.scrollHeight-nav.clientHeight,
       lastItemBottom:items.at(-1).getBoundingClientRect().bottom,
       footerTop:footer.top,
       leftIcons:icons.map(x=>x.left+x.width/2),
       labelLeft:labels.map(x=>x.left),
       navLeft:nr.left,navRight:nr.right,railLeft:br.left,
       navWidth:nr.width,buttonWidth:items[0].getBoundingClientRect().width,
       itemCenters:items.map(b=>{const q=b.getBoundingClientRect();return q.top+q.height/2}),
       computedAlignment:getComputedStyle(nav).alignContent
     };
   });
   assert.equal(m.opened,true,'rail expanded at '+height);
   assert.equal(m.computedAlignment,'space-evenly','remaining vertical space is distributed at '+height);
   assert.ok(m.navScroll<=1,'navigation should not need vertical scroll at '+height+': '+JSON.stringify(m));
   assert.ok(m.lastItemBottom<=m.footerTop-1,'last section must fit above pin at '+height);
   assert.ok(m.leftIcons.every(x=>x<67),'icons must remain close to left edge at '+height);
   assert.ok(m.labelLeft.every(x=>x>=60&&x<=90),'labels line up consistently near left edge at '+height);
   assert.ok(m.buttonWidth>=200,'expanded clickable active row spans sidebar at '+height);
   assert.equal(await page.locator('.nav-btn').count(),13);
   if(height>=900){
     const distance=m.itemCenters[1]-m.itemCenters[0];
     assert.ok(distance>=57,'desktop nav should have comfortable breathing room: '+height+' '+distance);
   }
   console.log('FLUID_SIDEBAR_'+height+'PX=PASS');
 }
 for(const height of [1080,900,768,700,600,540,500]) await check(height);
 await page.setViewportSize({width:1366,height:900});
 await page.evaluate(()=>document.body.classList.add('rtl'));
 await page.mouse.move(650,300);
 await page.mouse.move(1326,160);
 await page.waitForTimeout(370);
 const rtl=await page.evaluate(()=>{
    const r=document.querySelector('.rail').getBoundingClientRect();
    const buttons=[...document.querySelectorAll('.rail-nav .nav-btn')];
    const ico=buttons.map(x=>x.querySelector('svg').getBoundingClientRect());
    return {right:r.right, centers:ico.map(x=>x.left+x.width/2), width:r.width};
 });
 assert.equal(Math.round(rtl.right),1366);
 assert.ok(rtl.centers.every(x=>x>1366-66),'RTL icons align close to the right edge');
 await page.setViewportSize({width:900,height:768});
 assert.equal(await rail.evaluate(n=>Math.round(n.getBoundingClientRect().width)),84,'tablet unchanged');
 await page.setViewportSize({width:390,height:768});
 assert.equal(await rail.evaluate(n=>getComputedStyle(n).display),'none','mobile unchanged');
 console.log('FLUID_SIDEBAR_RTL_AND_DEVICES=PASS');
}finally{await browser.close()}
