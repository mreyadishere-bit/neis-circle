/* Primary-admin-only OVH capacity panel. Privileges enforced again by PostgreSQL RPC. */
(()=>{
  'use strict';
  const OWNER_ID='25b556a3-ec6f-49e7-ac6c-1b09720e3bfd';
  const isOwner=()=>typeof authUser!=='undefined'&&authUser?.id===OWNER_ID &&
    typeof state!=='undefined'&&state?.isAdmin;
  const originalAdmin=typeof admin==='function'?admin:null;
  if(!originalAdmin)return;
  let fetching=false,lastFetch=0,loadedRoot=null;
  const pct=n=>Math.max(0,Math.min(100,Number(n)||0));
  const fmt=(n,dec=1)=>Number.isFinite(Number(n))?Number(n).toFixed(dec):'—';
  const safe=(n,unit='')=>Number.isFinite(Number(n))?fmt(n)+unit:'—';
  const get=id=>document.getElementById('neisUsage'+id);
  const styles='<style id="neisUsageCss">'+
    '#neisServerUsage{margin-top:22px;padding:24px;border-radius:18px}' +
    '#neisServerUsage .neis-usage-top{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:20px}' +
    '#neisServerUsage h2{font-size:19px;margin:0;font-weight:750}'+
    '#neisServerUsage .neis-usage-muted{font-size:12px;opacity:.72;margin:4px 0 0}'+
    '#neisServerUsage .neis-usage-pill{border:1px solid currentColor;border-radius:32px;padding:5px 11px;font-size:12px}'+
    '#neisServerUsage .neis-usage-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}'+
    '#neisServerUsage .neis-usage-card{background:var(--surface2,var(--surface,#f3f5f7));border:1px solid var(--border,rgba(130,130,130,.2));border-radius:14px;padding:16px;min-width:0}'+
    '#neisServerUsage .neis-usage-label{font-size:12px;opacity:.7}'+
    '#neisServerUsage .neis-usage-value{font-size:25px;font-weight:750;line-height:1.3;margin:5px 0;font-variant-numeric:tabular-nums}'+
    '#neisServerUsage .neis-usage-bar{height:5px;background:rgba(128,128,128,.2);border-radius:5px;overflow:hidden;margin-top:12px}'+
    '#neisServerUsage .neis-usage-bar span{display:block;width:0;height:100%;background:#3aa585;transition:width .35s}'+
    '#neisServerUsage .neis-usage-lower{display:grid;grid-template-columns:1.2fr 1fr;gap:12px;margin-top:12px}'+
    '#neisServerUsage .neis-usage-chart{width:100%;height:150px;display:block}'+
    '#neisServerUsage table{width:100%;border-collapse:collapse;font-size:12px;min-width:370px}'+
    '#neisServerUsage td,#neisServerUsage th{text-align:left;padding:9px 6px;border-bottom:1px solid var(--border,rgba(128,128,128,.2))}'+
    '#neisServerUsage th{opacity:.7;font-weight:550}'+
    '#neisServerUsage button[data-neis-usage-refresh]{border:1px solid var(--border,rgba(128,128,128,.3));border-radius:8px;background:transparent;color:inherit;padding:6px 11px;cursor:pointer}'+
    '@media(max-width:750px){#neisServerUsage{padding:16px}#neisServerUsage .neis-usage-grid{grid-template-columns:repeat(2,minmax(0,1fr))}#neisServerUsage .neis-usage-lower{grid-template-columns:1fr}}'+
    '</style>';
  const card=(key,label,progress=false)=>
    '<div class="neis-usage-card"><div class="neis-usage-label">'+label+'</div>'+
    '<div id="neisUsage'+key+'" class="neis-usage-value">—</div>'+
    '<div id="neisUsage'+key+'Sub" class="neis-usage-muted">Waiting for measurements…</div>'+
    (progress?'<div class="neis-usage-bar"><span id="neisUsage'+key+'Bar"></span></div>':'')+'</div>';
  const panel=()=>styles+'<section class="module-card" id="neisServerUsage" aria-label="Private OVH server usage">'+
    '<div class="neis-usage-top"><div><h2>Server Usage <span aria-hidden="true">↗</span></h2>'+
    '<div class="neis-usage-muted">OVH VPS · Internal monitoring · Main Admin only</div></div>'+
    '<div style="display:flex;gap:10px;align-items:center"><span id="neisUsageStatus" class="neis-usage-pill">Connecting…</span>'+
    '<button type="button" data-neis-usage-refresh>Refresh</button></div></div>'+
    '<div class="neis-usage-grid">'+
    card('CPU','CPU usage',true)+card('RAM','RAM used',true)+card('Disk','Disk used',true)+
    card('Containers','Running Docker services')+card('Net','Network throughput')+card('Database','Database size')+'</div>'+
    '<div class="neis-usage-lower"><div class="neis-usage-card"><b>CPU and RAM history</b>'+
    '<svg class="neis-usage-chart" id="neisUsageChart" viewBox="0 0 600 150" preserveAspectRatio="none" role="img" aria-label="CPU and RAM usage chart"></svg>'+
    '<div class="neis-usage-muted">● CPU (blue) &nbsp; ● RAM (green) · Last 120 samples</div></div>'+
    '<div class="neis-usage-card"><b>Service breakdown</b><div style="overflow:auto"><table><thead><tr><th>Service</th><th>State</th><th>CPU</th><th>Memory</th></tr></thead>'+
    '<tbody id="neisUsageServices"><tr><td colspan="4">Loading…</td></tr></tbody></table></div></div></div>'+
    '<p class="neis-usage-muted" id="neisUsageUpdated">Updates automatically each minute. Restricted by authenticated server-side permissions.</p></section>';
  const oldAdmin=admin;
  admin=function(){
    const html=oldAdmin.apply(this,arguments);
    if(!isOwner())return html;
    queueMicrotask(()=>{if(state.view==='admin')void loadUsage()});
    return html+panel();
  };
  const fill=(id,value,detail,percentage)=>{
    const target=get(id);if(!target)return;
    target.textContent=value;
    const sub=get(id+'Sub');if(sub)sub.textContent=detail;
    const bar=get(id+'Bar');
    if(bar){const x=pct(percentage);bar.style.width=x+'%';bar.style.background=x>=90?'#dc6175':x>=75?'#d49a41':'#3aa585'}
  };
  function plot(data){
    const svg=get('Chart');if(!svg)return;
    svg.replaceChildren();
    const points=Array.isArray(data)?data.slice(-120):[];
    const ns='http://www.w3.org/2000/svg';
    for(let row=0;row<=4;row++){
      const line=document.createElementNS(ns,'path');
      const y=140-row*32.5;
      line.setAttribute('d','M0 '+y+' H600');
      line.setAttribute('stroke','currentColor');
      line.setAttribute('opacity','.13');
      svg.appendChild(line);
    }
    if(points.length<2)return;
    for(const [key,color] of [['cpu','#559bf0'],['ram','#39ab83']]){
      const el=document.createElementNS(ns,'polyline');
      el.setAttribute('points',points.map((point,i)=>{
        return (600*i/(points.length-1)).toFixed(2)+','+(140-130*pct(point[key])/100).toFixed(2);
      }).join(' '));
      el.setAttribute('fill','none');el.setAttribute('stroke',color);
      el.setAttribute('stroke-width','2.5');el.setAttribute('stroke-linejoin','round');
      el.setAttribute('vector-effect','non-scaling-stroke');
      svg.appendChild(el);
    }
  }
  function render(payload){
    const root=document.getElementById('neisServerUsage');
    if(!root||!isOwner())return;
    const d=payload?.current;
    if(!d){get('Status').textContent='Awaiting first sample';return;}
    const t=new Date(d.at||d.timestamp);
    const stale=!Number.isFinite(t.getTime())||Date.now()-t.getTime()>180000;
    get('Status').textContent=stale?'● Stale readings':'● Live';
    get('Status').style.color=stale?'#c4823d':'#289b70';
    const m=d.memory||{},k=d.disk||{},net=d.network||{},docker=d.docker||{};
    fill('CPU',safe(d.cpu,'%'),fmt(d.cores,0)+' cores · load '+fmt(d.load_1m,2),d.cpu);
    fill('RAM',safe(m.used_gib,' GiB'),fmt(m.total_gib,2)+' GiB total',m.percent);
    fill('Disk',safe(k.used_gib,' GiB'),fmt(k.total_gib,1)+' GiB total',k.percent);
    fill('Containers',docker.running==null?'—':String(docker.running),docker.error?'Docker stats unavailable':'Running containers');
    fill('Net',safe(net.rx_mib_s,' MiB/s'), '↓ Received · ↑ '+safe(net.tx_mib_s,' MiB/s')+' sent');
    fill('Database',d.database_bytes==null?'—':safe(d.database_bytes/1048576,' MiB'),'PostgreSQL storage used');
    get('Updated').textContent='Last sample: '+(Number.isFinite(t.getTime())?t.toLocaleString():'Unavailable')+
      ' · Collected on OVH and refreshed automatically every 60 seconds.';
    const rows=get('Services');rows.replaceChildren();
    const services=Array.isArray(docker.services)?docker.services:[];
    if(!services.length){const tr=rows.insertRow(),td=tr.insertCell();td.colSpan=4;td.textContent='Container statistics unavailable';}
    for(const service of services){
      const tr=rows.insertRow();
      for(const value of [service.name,service.status,service.cpu,service.memory]){
        const cell=tr.insertCell();cell.textContent=String(value??'—');
      }
    }
    plot(payload.history);
  }
  async function loadUsage(force=false){
    const root=document.getElementById('neisServerUsage');
    if(!root||!isOwner()||typeof sb==='undefined'||!sb||fetching)return;
    if(!force && root===loadedRoot && Date.now()-lastFetch<45000)return;
    fetching=true;loadedRoot=root;
    const status=get('Status');if(status)status.textContent='● Loading…';
    try{
      const {data,error}=await sb.rpc('main_admin_server_usage');
      if(error)throw error;
      if(root.isConnected&&root===document.getElementById('neisServerUsage')&&isOwner())render(data);
    }catch(e){
      if(root.isConnected&&root===document.getElementById('neisServerUsage')){
        get('Status').textContent='● Data unavailable';
        get('Updated').textContent='Monitoring request failed. '+(e?.message||'Try refreshing.');
      }
    }finally{fetching=false;lastFetch=Date.now();}
  }
  document.addEventListener('click',e=>{
    if(e.target?.closest?.('#neisServerUsage [data-neis-usage-refresh]'))void loadUsage(true);
  });
  setInterval(()=>{if(typeof state!=='undefined'&&state.view==='admin')void loadUsage(true)},60000);
})();
