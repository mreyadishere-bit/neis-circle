import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox']});
try{
 for(const mode of ['dark','light']){
  for(const width of [360,390,768,1280]){
   const page=await browser.newPage({viewport:{width,height:850}});
   await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1">'+
   '<div id="view"><section class="admin-hero"></section>'+
   '<section id="neisServerUsage" class="module-card"><header class="neis-usage-top"><h2>Server Usage</h2><button data-neis-usage-refresh>Refresh</button></header>'+
   '<div class="neis-usage-grid"><div class="neis-usage-card"><span class="neis-usage-label">CPU usage</span><div class="neis-usage-value">23%</div></div>'+
   '<div class="neis-usage-card"><span class="neis-usage-label">RAM used</span><div class="neis-usage-value">3 GiB</div></div>'+
   '<div class="neis-usage-card"><span class="neis-usage-label">Disk used</span><div class="neis-usage-value">28%</div></div></div>'+
   '<div class="neis-usage-lower"><div class="neis-usage-card">CPU and RAM history</div>'+
   '<div class="neis-usage-card">Service breakdown</div></div></section>'+
   '<section id="neisDbPanel" class="module-card"><div class="nd-grid"><div class="nd-card"><div class="nd-value">43 MiB</div></div></div></section></div>');
   await page.evaluate(mode=>{
    document.documentElement.dataset.theme=mode;
    document.documentElement.style.setProperty('--card',mode==='dark'?'#132a34':'#ffffff');
    document.documentElement.style.setProperty('--soft',mode==='dark'?'#203946':'#eef5f7');
    document.documentElement.style.setProperty('--ink',mode==='dark'?'#f0f8fa':'#162a32');
    document.documentElement.style.setProperty('--muted',mode==='dark'?'#b7cad2':'#536a76');
    document.documentElement.style.setProperty('--line',mode==='dark'?'#355260':'#d3e1e8');
   },mode);
   await page.addStyleTag({content:'#neisServerUsage .neis-usage-card{background:#f3f5f7;color:#e9f6fc}#neisServerUsage .neis-usage-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}#neisServerUsage .neis-usage-lower{display:grid;grid-template-columns:1.2fr 1fr;gap:12px;margin-top:12px}#neisDbPanel .nd-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}'});
   await page.addStyleTag({path:'styles/ui-v14.css'});
   const values=await page.evaluate(()=>{
    const card=document.querySelector('.neis-usage-card');
    const text=document.querySelector('.neis-usage-value');
    const panel=document.querySelector('#neisServerUsage');
    const soft=getComputedStyle(document.documentElement).getPropertyValue('--soft').trim();
    const parsed=document.createElement('div');parsed.style.background=soft;document.body.append(parsed);
    const expected=getComputedStyle(parsed).backgroundColor;parsed.remove();
    return {
     bg:getComputedStyle(card).backgroundColor,expected,
     fg:getComputedStyle(text).color,
     cols:getComputedStyle(document.querySelector('.neis-usage-grid')).gridTemplateColumns.split(' ').length,
     panelWidth:panel.getBoundingClientRect().width,
     dbWidth:document.querySelector('#neisDbPanel').getBoundingClientRect().width,
     vw:window.innerWidth
    };
   });
   assert.equal(values.bg,values.expected,'usage cards inherit correct theme color at '+mode+'/'+width);
   assert.ok(values.panelWidth<=width+1&&values.dbWidth<=width+1,'admin panels must fit viewport');
   assert.ok(values.fg!==values.bg,'usage value must not disappear against its card');
   if(width<=560)assert.equal(values.cols,1,'small phone usage cards stack vertically');
   await page.close();
  }
 }
 console.log('ADMIN_DARK_RESPONSIVE=PASS');
}finally{await browser.close()}
