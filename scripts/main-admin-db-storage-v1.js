/* NEIS Circle – owner-only, OVH-backed PostgreSQL storage breakdown. */
(()=>{
'use strict';
const OWNER='25b556a3-ec6f-49e7-ac6c-1b09720e3bfd';
const owner=()=>typeof authUser!=='undefined'&&authUser?.id===OWNER&&
 typeof state!=='undefined'&&state?.isAdmin===true;
if(typeof admin!=='function')return;
const previous=admin;
const $=id=>document.getElementById('neisDb'+id);
const num=x=>Number.isFinite(Number(x))?Number(x):0;
const mib=x=>(num(x)/1048576).toFixed(2)+' MiB';
const signed=x=>(x>=0?'+':'−')+mib(Math.abs(x));
const elm=(tag,css='',label)=>{
 const e=document.createElement(tag);
 if(css)e.className=css;
 if(label!==undefined)e.textContent=String(label);
 return e;
};
const css=[
'#neisDbPanel{margin-top:18px;padding:22px!important;border:1px solid var(--line);border-radius:17px;background:var(--card);color:var(--ink)}',
'#neisDbPanel *{box-sizing:border-box}',
'#neisDbPanel .nd-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-bottom:16px}',
'#neisDbPanel h2{margin:0;font-size:18px;font-weight:750}',
'#neisDbPanel .nd-sub{font-size:12px;color:var(--muted);line-height:1.6;margin:5px 0}',
'#neisDbPanel .nd-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:11px;margin:14px 0}',
'#neisDbPanel .nd-card{background:var(--soft);border:1px solid var(--line);border-radius:12px;padding:15px;min-width:0}',
'#neisDbPanel .nd-value{font-weight:750;font-size:24px;font-variant-numeric:tabular-nums;margin-top:4px}',
'#neisDbPanel .nd-table-wrap{overflow:auto;border:1px solid var(--line);border-radius:12px;margin-top:13px}',
'#neisDbPanel table{border-collapse:collapse;width:100%;min-width:640px;font-size:12px}',
'#neisDbPanel th,#neisDbPanel td{text-align:left;padding:11px 12px;border-bottom:1px solid var(--line);white-space:nowrap}',
'#neisDbPanel th{background:var(--soft);color:var(--muted);font-weight:650;font-size:11px}',
'#neisDbPanel tr:last-child td{border-bottom:0}',
'#neisDbPanel .nd-table-bar{height:4px;border-radius:10px;background:var(--soft);overflow:hidden;margin-top:6px;min-width:100px}',
'#neisDbPanel .nd-table-bar span{height:100%;background:var(--accent);display:block}',
'#neisDbPanel button{background:var(--card);border:1px solid var(--line);color:var(--ink);border-radius:9px;padding:8px 12px;font-size:12px;cursor:pointer}',
'#neisDbPanel button:disabled{opacity:.5;cursor:default}',
'#neisDbPanel .nd-history{display:flex;align-items:flex-end;gap:4px;height:105px;padding:10px 1px 0;border-bottom:1px solid var(--line);overflow:hidden}',
'#neisDbPanel .nd-history-col{flex:1;min-width:4px;background:var(--accent);border-radius:3px 3px 0 0;opacity:.76}',
'#neisDbPanel .nd-empty{padding:20px 6px;text-align:center;color:var(--muted)}',
'@media(max-width:700px){#neisDbPanel{padding:15px!important}#neisDbPanel .nd-grid{grid-template-columns:1fr 1fr}}',
'@media(max-width:410px){#neisDbPanel .nd-grid{grid-template-columns:1fr}}'
].join('');
const shell='<style>'+css+'</style>'+
'<section id="neisDbPanel" class="module-card" aria-label="OVH Database Storage Breakdown">'+
'<header class="nd-head"><div><h2>Database Storage Breakdown</h2>'+
'<p class="nd-sub">PostgreSQL · OVH VPS · Main Admin only</p></div>'+
'<div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap">'+
'<span id="neisDbStatus" class="nd-sub">Connecting…</span>'+
'<button type="button" id="neisDbRefresh">Refresh</button></div></header>'+
'<div class="nd-grid">'+
'<div class="nd-card"><span class="nd-sub">Database total</span><div id="neisDbTotal" class="nd-value">—</div>'+
'<div class="nd-sub">Includes system overhead, indexes, TOAST</div></div>'+
'<div class="nd-card"><span class="nd-sub">Tables &amp; indexes</span>'+
'<div id="neisDbRelations" class="nd-value">—</div><div class="nd-sub">public + auth + storage</div></div>'+
'<div class="nd-card"><span class="nd-sub">Growth vs last recorded day</span>'+
'<div id="neisDbGrowth" class="nd-value">—</div><div id="neisDbCompared" class="nd-sub">Gathering baseline</div></div>'+
'</div>'+
'<div class="nd-card"><b>Daily database history</b><div id="neisDbHistory" class="nd-history" aria-label="Last 90 daily database measurements"></div>'+
'<p id="neisDbHistoryCaption" class="nd-sub">A daily baseline is collected automatically; daily changes appear after the first full day.</p></div>'+
'<div class="nd-table-wrap"><table><thead><tr><th>Table</th><th>Total size</th><th>Data</th>'+
'<th>Indexes</th><th>% of database</th></tr></thead>'+
'<tbody id="neisDbRows"><tr><td colspan="5" class="nd-empty">Loading storage details…</td></tr></tbody></table></div>'+
'<p id="neisDbRetention" class="nd-sub" style="margin-top:13px">24h detailed metrics · 90d daily summaries · completed email receipts retained 30–90 days. Student records are never included in this cleanup.</p>'+
'<p class="nd-sub">Size of individual tables is not the whole PostgreSQL database: other schemas, internal structures and free pages also take space. Deleted records may not immediately reduce the displayed database size.</p></section>';
let loading=false,lastRoot=null,queued=false,requestId=0;
admin=function(){
 const markup=previous.apply(this,arguments);
 if(!owner())return markup;
 queueMicrotask(()=>{if(state?.view==='admin')void load()});
 return markup+shell;
};
function set(id,value){const e=$(id);if(e)e.textContent=String(value)}
function render(data){
 if(!owner()||!$('Panel'))return;
 const db=num(data?.database_bytes),rows=Array.isArray(data?.tables)?data.tables:[];
 set('Total',mib(db));set('Relations',mib(data?.relations_bytes));
 const delta=data?.daily_change_bytes;
 set('Growth',delta===null||delta===undefined?'Collecting':signed(num(delta)));
 set('Compared',data?.previous_day?'Compared with '+data.previous_day+' (UTC)':'Waiting for a previous-day baseline');
 const tbody=$('Rows');if(tbody)tbody.replaceChildren();
 if(!rows.length&&tbody){
   const tr=tbody.insertRow(),td=tr.insertCell();td.colSpan=5;td.className='nd-empty';
   td.textContent='No table sizes available.';
 }
 for(const entry of rows){
   const tr=tbody.insertRow(),label=(entry.schema||'')+'.'+(entry.table||'');
   const total=num(entry.bytes);
   tr.insertCell().textContent=label;
   tr.insertCell().textContent=mib(total);
   tr.insertCell().textContent=mib(entry.data_bytes);
   tr.insertCell().textContent=mib(entry.index_bytes);
   const td=tr.insertCell();
   const p=db>0?Math.max(0,Math.min(100,total/db*100)):0;
   td.appendChild(elm('span','',p.toFixed(1)+'%'));
   const bar=elm('div','nd-table-bar'),fill=elm('span');
   fill.style.width=p+'%';bar.appendChild(fill);td.appendChild(bar);
 }
 const hist=$('History');
 if(hist){
   hist.replaceChildren();
   const days=Array.isArray(data?.history)?data.history.slice(-90):[];
   const values=days.map(x=>num(x.bytes)).filter(n=>n>0);
   if(values.length===0){hist.appendChild(elm('div','nd-empty','Awaiting first daily storage snapshot'))}
   else{
     const lo=Math.min(...values),hi=Math.max(...values),span=hi-lo;
     for(const row of days){
       const val=num(row.bytes);
       const bar=elm('div','nd-history-col');
       const h=span===0?56:Math.max(12,(val-lo)/span*80+16);
       bar.style.height=h+'%';
       bar.title=row.day+': '+mib(val);
       bar.setAttribute('aria-label',bar.title);
       hist.appendChild(bar);
     }
   }
   set('HistoryCaption',days.length+' daily snapshot'+(days.length===1?'':'s')+
      ' stored · UTC day boundaries · maximum 90 days');
 }
 set('Retention','Detailed monitoring: '+num(data?.detail_samples)+' samples, 24h retention · Daily history: 90 days · Accepted email outbox: '+
   num(data?.sent_outbox_count)+' records, 30 days (manual broadcasts: 90 days). Pending/failed mail is never pruned.');
}
async function load(force=false){
 const root=$('Panel');if(!root||!owner()||typeof sb==='undefined'||!sb)return;
 if(loading){queued=true;return}
 if(!force&&lastRoot===root)return;
 lastRoot=root;loading=true;
 const n=++requestId;
 set('Status','● Loading…');
 try{
   const response=await sb.rpc('main_admin_database_storage');
   if(response.error)throw response.error;
   if(!owner()||!root.isConnected||n!==requestId)return;
   render(response.data);
   set('Status','● OVH connected');
 }catch(error){
   if(root.isConnected){
     set('Status','● Unavailable');
     const r=$('Rows');if(r){r.replaceChildren();
       const tr=r.insertRow(),td=tr.insertCell();td.colSpan=5;td.className='nd-empty';
       td.textContent='Unable to load storage: '+(error?.message||'Try again.');}
   }
 }finally{loading=false;if(queued){queued=false;void load(true)}}
}
document.addEventListener('click',event=>{
 if(!owner()||event.target?.id!=='neisDbRefresh')return;
 void load(true);
});
})();