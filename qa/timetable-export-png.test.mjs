import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright';

const app=fs.readFileSync('styles/app.css','utf8');
const timetable=fs.readFileSync('styles/timetable-v147.css','utf8');
const button=fs.readFileSync('styles/timetable-export-png-v1.css','utf8');
const script=fs.readFileSync('scripts/timetable-export-png-v1.js','utf8');
const colors=['#2f7db8','#5e6a78','#10a879','#efb83f','#7a52d8'];
const dayNames=['Sunday','Monday','Tuesday','Wednesday','Thursday'];
const cards=[
 [{title:'Maths L2',color:colors[0],time:'10:00 AM → 12:30 PM',location:'School'},
  {title:'ICT',color:colors[2],time:'12:30 PM → 2:00 PM',location:'School'}],
 [{title:'Religion',color:colors[1],time:'7:30 AM → 8:30 AM',location:'School'},
  {title:'English',color:colors[3],time:'8:30 AM → 10:30 AM',location:'Online'},
  {title:'Maths L2',color:colors[0],time:'1:00 PM → 3:30 PM',location:'School'}],
 [{title:'ICT',color:colors[2],time:'10:00 AM → 11:30 AM',location:'School'}],
 [{title:'Physics L2',color:colors[4],time:'11:00 AM → 1:00 PM',location:'Online'},
  {title:'English',color:colors[3],time:'1:00 PM → 3:00 PM',location:'Online'}],
 [{title:'Maths L2',color:colors[0],time:'8:00 AM → 10:00 AM',location:'School'}]
];
const makeBoard=()=>'<section class="tt-board tt-days-5">'+dayNames.map((day,i)=>
 '<section class="tt-day tt-count-'+cards[i].length+(i===1?' today':'')+'" style="--tt-row-count:'+cards[i].length+'">'+
 '<header><div><span>'+day+'</span>'+(i===1?'<b>Today</b>':'')+'</div>'+
 '<div class="tt-day-actions"><button aria-label="Add">+</button></div></header>'+
 '<div class="tt-day-body">'+cards[i].map((r,n)=>
 '<article class="tt-event" style="--tt-color:'+r.color+'"><div class="tt-event-main">'+
 '<div class="tt-event-top"><b class="tt-event-name">'+r.title+'</b>'+
 '<div class="tt-event-tools"><span class="tt-event-category">Class</span>'+
 '<button class="tt-event-menu" type="button">•••</button></div></div>'+
 '<div class="tt-time-row"><time><strong>'+r.time.split(' → ')[0]+'</strong>'+
 '<span>→</span><strong>'+r.time.split(' → ')[1]+'</strong></time><em>15m before</em></div>'+
 '<span class="tt-location-pill">'+r.location+'</span>'+
 '</div></article>').join('')+
 '</div></section>').join('')+'</section>';
const pageHTML='<!doctype html><html lang="en"><head><meta charset="UTF-8">'+
 '<style>'+app+'</style><style>'+timetable+'</style><style>'+button+'</style></head>'+
 '<body><main id="view"><section class="tt-head"><h1>My timetable</h1>'+
 '<div class="tt-head-actions"><button class="primary">Add class</button></div></section>'+
 '<div class="tt-desktop-only">'+makeBoard()+'</div><div class="tt-mobile-only">Mobile view</div>'+
 '</main></body></html>';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
async function runCase(width,height){
 const context=await browser.newContext({viewport:{width,height},acceptDownloads:true});
 const page=await context.newPage();
 const errors=[];
 page.on('pageerror',err=>errors.push(err.message));
 try{
  await page.setContent(pageHTML,{waitUntil:'load'});
  await page.evaluate(()=>{
    window.state={lang:'en',view:'timetable',onboardingComplete:true,timetable:{ready:true,loading:false}};
    window.authUser={id:'6c2d2e12-cccc-4acd-a000-d43fcedbbc73'};
    window.toast=msg=>{window.__exportToast=msg};
    window.__imagePixels=null;
    const original=HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob=function(cb,type,...rest){
      const ctx=this.getContext('2d');
      const w=this.width,h=this.height;
      const bg=ctx.getImageData(Math.min(w-1,Math.round(w*.95)),Math.min(h-1,Math.round(h*.95)),1,1).data;
      const card=ctx.getImageData(Math.round(w*.12),Math.round(h*.18),1,1).data;
      window.__imagePixels={w,h,bg:[...bg],card:[...card]};
      return original.call(this,cb,type,...rest);
    };
  });
  await page.addScriptTag({content:script});
  const btn=page.locator('#ttExportPng');
  await btn.waitFor();
  assert.ok(await btn.isVisible(),'Export button visible at '+width);
  assert.equal(await page.locator('.tt-board .tt-day').count(),5);
  const downloadPromise=page.waitForEvent('download',{timeout:20000});
  await btn.click();
  const download=await downloadPromise;
  assert.ok(download.suggestedFilename().endsWith('.png'));
  const png=fs.readFileSync(await download.path());
  assert.equal(png.subarray(1,4).toString('ascii'),'PNG');
  const imgWidth=png.readUInt32BE(16),imgHeight=png.readUInt32BE(20);
  assert.ok(imgWidth>=3000,'high-resolution desktop image width, got '+imgWidth);
  assert.ok(imgHeight>=1200,'full board height');
  const pixels=await page.evaluate(()=>window.__imagePixels);
  assert.ok(pixels&&pixels.bg[3]===255);
  assert.ok(pixels.card.some((x,i)=>i<3&&x<220),
    'colored timetable card should not be a blank white image, '+JSON.stringify(pixels));
  assert.equal(await page.locator('.tt-png-private-renderer').count(),0,'temporary renderer disposed');
  assert.equal(await page.locator('.tt-board .tt-day').count(),5,'source board not altered');
  assert.equal(await btn.isEnabled(),true);
  assert.deepEqual(errors,[],'no browser exceptions');
  console.log('PNG_EXPORT_'+width+'x'+height+'=PASS '+imgWidth+'x'+imgHeight+' '+png.byteLength+' bytes');
  return {imgWidth,imgHeight};
 }finally{await context.close()}
}
try{
  const desktop=await runCase(1590,950);
  const mobile=await runCase(390,790);
  assert.equal(desktop.imgWidth,mobile.imgWidth,'desktop and mobile export equal widths');
  assert.equal(desktop.imgHeight,mobile.imgHeight,'desktop and mobile export equal heights');
  console.log('PNG_EXPORT_DESKTOP_MOBILE_PARITY=PASS');
}finally{await browser.close()}
