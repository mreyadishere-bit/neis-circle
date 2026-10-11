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
    '#neisServerUsage .neis-forecast{margin-top:18px;border-top:1px solid var(--border,rgba(128,128,128,.2));padding-top:18px}'+
    '#neisServerUsage .neis-forecast h3{font-size:16px;margin:0 0 5px}'+
    '#neisServerUsage .neis-forecast-head{display:flex;gap:10px;justify-content:space-between;align-items:start;flex-wrap:wrap;margin-bottom:14px}'+
    '#neisServerUsage .neis-usage-alert{padding:12px 14px;margin-top:12px;border-radius:10px;border:1px solid var(--border,rgba(128,128,128,.3));background:rgba(128,128,128,.06);font-size:13px;line-height:1.65}'+
    '#neisServerUsage .neis-usage-alert.warn{border-color:#d49a41;background:rgba(212,154,65,.09)}'+
    '#neisServerUsage .neis-usage-alert.danger{border-color:#dc6175;background:rgba(220,97,117,.10)}'+
    '#neisServerUsage .neis-usage-alert ul{margin:6px 0 0;padding-left:20px}'+
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
    '<div class="neis-forecast"><div class="neis-forecast-head"><div><h3>Capacity Forecast</h3>'+
    '<div class="neis-usage-muted">Based on actual server measurements · 30-day history · no assumed growth rate</div></div>'+
    '<div id="neisUsageForecastConfidence" class="neis-usage-pill">Gathering baseline</div></div>'+
    '<div class="neis-usage-grid">'+card('DiskGrowth','Disk growth per day')+
    card('DiskETA','Time until 80% disk usage')+card('DBGrowth','Database growth per day')+'</div>'+
    '<div class="neis-usage-alert" id="neisUsageAlerts" aria-live="polite">Checking resource thresholds…</div>'+
    '<p class="neis-usage-muted">Forecasts appear once at least 3 days of consistent data are collected. They are estimates, not storage limits or promises. Database size is already included in total disk use; never add them together. Concurrent-user capacity requires separate load testing.</p></div>'+
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
  function estimateTrend(points,key){
    const source=(Array.isArray(points)?points:[])
      .filter(p=>p&&p[key]!=null)
      .map(p=>({day:Date.parse(p?.at)/86400000,y:Number(p?.[key])}))
      .filter(p=>Number.isFinite(p.day)&&Number.isFinite(p.y)&&p.y>=0)
      .sort((a,b)=>a.day-b.day);
    if(source.length<10)return {status:'collecting',days:0};
    const last=source[source.length-1].day;
    const data=source.filter(p=>p.day>=last-14);
    const span=data[data.length-1].day-data[0].day;
    if(data.length<10||span<3)return {status:'collecting',days:Math.max(0,span)};
    const count=data.length;
    const meanX=data.reduce((a,p)=>a+p.day,0)/count,meanY=data.reduce((a,p)=>a+p.y,0)/count;
    let sxx=0,sxy=0,syy=0;
    for(const p of data){let dx=p.day-meanX,dy=p.y-meanY;sxx+=dx*dx;sxy+=dx*dy;syy+=dy*dy;}
    if(sxx<=0)return {status:'collecting',days:span};
    const slope=sxy/sxx;
    const r2=syy>0?Math.max(0,Math.min(1,sxy*sxy/(sxx*syy))):1;
    return {status:slope<=0?'stable':r2<.3?'variable':'growing',
      slope:slope,days:span,r2:r2,points:count,
      confidence:span>=14&&r2>=.8?'Higher':span>=7&&r2>=.5?'Medium':'Early'};
  }
  function capacityForecast(payload){
    const d=payload.current||{},disk=d.disk||{};
    const trend=estimateTrend(payload.trends,'disk_used_gib');
    const db=estimateTrend((payload.trends||[]).map(p=>({
      at:p.at,
      db_gib:p.database_bytes==null?null:Number(p.database_bytes)/1073741824
    })),'db_gib');
    const diskPct=Number(disk.percent);
    const free=Number(disk.total_gib)-Number(disk.used_gib);
    const confident=get('ForecastConfidence');
    if(confident)confident.textContent=trend.status==='collecting'?'Gathering baseline · 3+ days':
      (trend.confidence||'Early')+' confidence · '+trend.days.toFixed(1)+' days';
    let label='Not enough history',eta='Need 3+ days of data';
    if(trend.status==='stable'){label='Stable or decreasing';eta='No growth-based date';}
    if(trend.status==='variable'){label='Fluctuating usage';eta='Trend too irregular';}
    if(trend.status==='growing'&&Number.isFinite(trend.slope)){
      label=fmt(trend.slope*1024,1)+' MiB/day';
      const at80=Number(disk.total_gib)*.8-Number(disk.used_gib);
      if(at80<=0)eta='Threshold reached';
      else{
        const days=at80/trend.slope;
        eta=days>3650?'Over 10 years':days>=365?fmt(days/365,1)+' years':
          days>=30?fmt(days/30.44,1)+' months':fmt(days,0)+' days';
      }
    }
    fill('DiskGrowth',label,'Sampled disk growth · last 14 days');
    fill('DiskETA',eta,'Estimated until 80% full · '+fmt(free,1)+' GiB free');
    const databaseValue=db.status==='collecting'?'Not enough history':
      db.status==='stable'?'Stable or decreasing':
      db.status==='variable'?'Fluctuating usage':fmt(db.slope*1024,1)+' MiB/day';
    fill('DBGrowth',databaseValue,'PostgreSQL growth tracked separately');
    const alerts=get('Alerts');if(!alerts)return;
    alerts.replaceChildren();
    const issues=[];
    const push=(kind,message)=>issues.push({kind,message});
    const cpu=Number(d.cpu),ram=Number(d.memory?.percent);
    if(Number.isFinite(diskPct)&&diskPct>=90)push('danger','Disk storage is 90%+ full. Free space and backups need urgent review.');
    else if(Number.isFinite(diskPct)&&diskPct>=80)push('warn','Disk storage has reached 80%. Plan additional storage.');
    if(Number.isFinite(ram)&&ram>=90)push('danger','RAM above 90% in the latest sample.');
    else if(Number.isFinite(ram)&&ram>=80)push('warn','RAM above 80% in the latest sample.');
    if(Number.isFinite(cpu)&&cpu>=90)push('warn','CPU above 90% in the latest sample. Check whether high load persists.');
    else if(Number.isFinite(cpu)&&cpu>=80)push('warn','CPU above 80% in the latest sample.');
    if(d.docker?.error||d.docker?.running==null)push('warn','Docker readings unavailable; check server monitoring.');
    if(d.database_bytes==null)push('warn','PostgreSQL size could not be read.');
    const sampleAge=Date.now()-Date.parse(d.at);
    if(!Number.isFinite(sampleAge)||sampleAge>180000)push('warn','Monitor readings are over three minutes old.');
    alerts.className='neis-usage-alert'+(issues.some(x=>x.kind==='danger')?' danger':issues.length?' warn':'');
    const strong=document.createElement('b');
    strong.textContent=issues.length?issues.length+' monitoring alert(s)':'✓ No current resource threshold alerts';
    alerts.appendChild(strong);
    if(issues.length){
      const list=document.createElement('ul');
      issues.forEach(issue=>{const li=document.createElement('li');li.textContent=issue.message;list.appendChild(li)});
      alerts.appendChild(list);
    }else{
      const p=document.createElement('p');p.className='neis-usage-muted';
      p.textContent='Alerts appear here at CPU/RAM 80% and disk 80% / 90%. These are in-dashboard alerts, not push notifications.';
      alerts.appendChild(p);
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
    capacityForecast(payload);
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
