/* Read-only OVH Auth and Profiles dashboard for NEIS Circle's primary admin. */
(()=>{
'use strict';
const ADMIN_ID='25b556a3-ec6f-49e7-ac6c-1b09720e3bfd';
const isOwner=()=>typeof authUser!=='undefined'&&authUser?.id===ADMIN_ID&&typeof state!=='undefined'&&state?.isAdmin===true;
if(typeof admin!=='function')return;
const $=id=>document.getElementById('neisUsers'+id);
const fmtDate=(v,withTime=false)=>{if(!v)return 'Never';const d=new Date(v);return Number.isNaN(+d)?'Unknown':withTime?d.toLocaleString():d.toLocaleDateString()};
const styles=[
'#neisUsersPanel{margin-top:20px;padding:24px!important;overflow:hidden}',
'#neisUsersPanel *{box-sizing:border-box}',
'#neisUsersPanel .nu-head{display:flex;gap:14px;align-items:start;justify-content:space-between;flex-wrap:wrap;margin-bottom:22px}',
'#neisUsersPanel h2{font-size:22px;letter-spacing:-.5px;margin:2px 0 4px;font-weight:750}',
'#neisUsersPanel h3{font-size:16px;margin:0 0 4px}',
'#neisUsersPanel .nu-sub{font-size:12px;opacity:.68;margin:0}',
'#neisUsersPanel .nu-kicker{font-size:10px;letter-spacing:.12em;font-weight:700;opacity:.7}',
'#neisUsersPanel .nu-badge{font-size:12px;border:1px solid var(--border,rgba(120,120,120,.3));border-radius:30px;padding:6px 10px}',
'#neisUsersPanel .nu-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:18px}',
'#neisUsersPanel .nu-stat{border:1px solid var(--border,rgba(120,120,120,.18));border-radius:13px;background:var(--surface2,#f6f8f9);padding:15px}',
'#neisUsersPanel .nu-stat small{font-size:11px;opacity:.7}',
'#neisUsersPanel .nu-stat b{display:block;font-size:25px;font-variant-numeric:tabular-nums;margin-top:3px}',
'#neisUsersPanel .nu-tools{display:flex;gap:9px;flex-wrap:wrap;margin-bottom:13px}',
'#neisUsersPanel input,#neisUsersPanel select{border:1px solid var(--border,rgba(120,120,120,.3));color:inherit;background:var(--surface,#fff);padding:9px 11px;font:inherit;font-size:12px;min-height:41px;border-radius:9px;min-width:0}',
'#neisUsersPanel input{flex:1;min-width:180px}',
'#neisUsersPanel button{color:inherit;background:transparent;border:1px solid var(--border,rgba(120,120,120,.28));border-radius:9px;padding:8px 12px;cursor:pointer;font:inherit;font-size:12px;min-height:36px}',
'#neisUsersPanel button:disabled{opacity:.38;cursor:default}',
'#neisUsersPanel .nu-table{overflow:auto;border:1px solid var(--border,rgba(120,120,120,.2));border-radius:12px}',
'#neisUsersPanel table{border-collapse:collapse;width:100%;min-width:790px;font-size:12px}',
'#neisUsersPanel th{background:var(--surface2,#f6f8f9);color:var(--muted,#687680);text-transform:uppercase;font-size:10px;letter-spacing:.08em;text-align:left;font-weight:600}',
'#neisUsersPanel th,#neisUsersPanel td{padding:13px 11px;border-bottom:1px solid var(--border,rgba(120,120,120,.12));vertical-align:middle}',
'#neisUsersPanel .nu-email{opacity:.65;font-size:11px;word-break:break-word}',
'#neisUsersPanel .nu-status{display:inline-block;border-radius:30px;background:rgba(110,110,110,.12);padding:4px 8px;font-size:11px;white-space:nowrap}',
'#neisUsersPanel .nu-status.active{background:rgba(50,166,110,.12);color:#238b64}',
'#neisUsersPanel .nu-status.warn{background:rgba(195,142,47,.13);color:#a77522}',
'#neisUsersPanel .nu-status.blocked{background:rgba(218,85,92,.13);color:#cb515a}',
'#neisUsersPanel .nu-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:14px}',
'#neisUsersPanel .nu-detail{display:none;margin-top:18px;background:var(--surface2,#f6f8f9);padding:18px;border-radius:13px;border:1px solid var(--border,rgba(120,120,120,.18))}',
'#neisUsersPanel .nu-detail.open{display:block}',
'#neisUsersPanel .nu-detail-head{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:16px}',
'#neisUsersPanel .nu-fields{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin:0}',
'#neisUsersPanel .nu-field{background:var(--surface,#fff);border:1px solid var(--border,rgba(120,120,120,.14));padding:10px;border-radius:9px;min-width:0}',
'#neisUsersPanel dt{opacity:.6;font-size:11px}#neisUsersPanel dd{margin:3px 0 0;font-size:12px;word-break:break-word}',
'#neisUsersPanel .nu-empty{text-align:center;padding:35px 10px;opacity:.66}',
'@media(max-width:790px){#neisUsersPanel{padding:15px!important}#neisUsersPanel .nu-grid{grid-template-columns:repeat(2,minmax(0,1fr))}#neisUsersPanel .nu-fields{grid-template-columns:repeat(2,minmax(0,1fr))}}',
'@media(max-width:470px){#neisUsersPanel .nu-fields{grid-template-columns:1fr}#neisUsersPanel input{flex-basis:100%}}'
].join('');
const shell='<style>'+styles+'</style><section class="module-card" id="neisUsersPanel" aria-label="Authentication and users management">'+
'<div class="nu-head"><div><span class="nu-kicker">OVH / IDENTITY MANAGEMENT</span><h2>Authentication &amp; Users</h2>'+
'<p class="nu-sub">Secure read-only account viewer · Main Admin only</p></div>'+
'<div style="display:flex;gap:9px;align-items:center"><span class="nu-badge" id="neisUsersConnection">Connecting…</span>'+
'<button data-nu-refresh type="button">Refresh</button></div></div>'+
'<div class="nu-grid" id="neisUsersStats">'+
'<div class="nu-stat"><small>Total accounts</small><b>—</b></div><div class="nu-stat"><small>Confirmed</small><b>—</b></div>'+
'<div class="nu-stat"><small>Signed in (30 days)</small><b>—</b></div><div class="nu-stat"><small>New (7 days)</small><b>—</b></div></div>'+
'<div class="nu-tools"><input id="neisUsersSearch" type="search" placeholder="Search email, name, username, or ID" autocomplete="off" aria-label="Search accounts">'+
'<select id="neisUsersFilter" aria-label="Filter accounts"><option value="all">All accounts</option><option value="confirmed">Confirmed</option>'+
'<option value="pending">Unconfirmed</option><option value="blocked">Blocked or inactive</option><option value="admins">Administrators</option>'+
'<option value="no_profile">Missing profile</option><option value="signed_in_30d">Signed in (30 days)</option></select>'+
'<select id="neisUsersSort" aria-label="Sort accounts"><option value="newest">Newest first</option><option value="oldest">Oldest first</option>'+
'<option value="recent_login">Recent sign-in</option></select></div>'+
'<div class="nu-table"><table><thead><tr><th>User</th><th>Provider</th><th>Status</th><th>Branch · Grade</th>'+
'<th>Registered</th><th>Last sign-in</th><th></th></tr></thead><tbody id="neisUsersRows">'+
'<tr><td colspan="7" class="nu-empty">Loading user accounts…</td></tr></tbody></table></div>'+
'<div class="nu-footer"><span id="neisUsersPage" class="nu-sub">Loading…</span><div style="display:flex;gap:7px">'+
'<button data-nu-prev type="button" disabled>Previous</button><button data-nu-next type="button" disabled>Next</button></div></div>'+
'<section class="nu-detail" id="neisUsersDetail" aria-label="User details" aria-live="polite"></section>'+
'<p class="nu-sub" style="margin-top:14px">Data comes directly from OVH PostgreSQL. No passwords, password hashes, refresh tokens, or Google credentials are exposed.</p></section>';
let total=0,offset=0,filter='all',sort='newest',search='',stats=null,first=null;
let debounce=null,loading=false,pendingRefresh=false,seq=0;
const previous=admin;
admin=function(){
  const result=previous.apply(this,arguments);
  if(!isOwner())return result;
  queueMicrotask(()=>{if(state.view==='admin')void load()});
  return result+shell;
};
function stateBadge(u){
  if(u.banned||(u.account_status&&u.account_status!=='active'))return ['Blocked','blocked'];
  if(!u.confirmed)return ['Unconfirmed','warn'];
  if(!u.has_profile)return ['No profile','warn'];
  return ['Active','active'];
}
function putText(id,content){const el=$(id);if(el)el.textContent=String(content);}
function statsRender(){
  const root=$('Stats');if(!root||!stats)return;
  const values=[['Total accounts',stats.total],['Confirmed',stats.confirmed],['Signed in (30 days)',stats.signed_in_30d],['New (7 days)',stats.new_7d]];
  root.replaceChildren();
  for(const [label,n] of values){
    const card=document.createElement('div');card.className='nu-stat';
    const s=document.createElement('small');s.textContent=label;const b=document.createElement('b');b.textContent=String(n??'—');
    card.append(s,b);root.appendChild(card);
  }
}
function renderUsers(data){
  const rows=$('Rows');if(!rows)return;rows.replaceChildren();
  const users=Array.isArray(data?.users)?data.users:[];
  total=Math.max(0,Number(data?.total)||0);
  for(const user of users){
    const tr=rows.insertRow();
    const primary=tr.insertCell();
    const name=document.createElement('strong');name.textContent=user.full_name||user.username||'No profile';
    const email=document.createElement('div');email.className='nu-email';email.textContent=user.email||'No email';
    primary.append(name,email);
    tr.insertCell().textContent=user.google_provider?'Google':'Other';
    const stat=tr.insertCell(),pill=document.createElement('span'),[t,kind]=stateBadge(user);
    pill.className='nu-status '+kind;pill.textContent=t;stat.appendChild(pill);
    tr.insertCell().textContent=(user.branch||user.campus||'—')+' · '+(user.grade||'—');
    tr.insertCell().textContent=fmtDate(user.created_at);
    tr.insertCell().textContent=fmtDate(user.last_sign_in_at);
    const last=tr.insertCell(),button=document.createElement('button');button.type='button';
    button.dataset.nuUser=user.user_id;button.textContent='View';last.appendChild(button);
  }
  if(!users.length){const tr=rows.insertRow(),td=tr.insertCell();td.colSpan=7;td.className='nu-empty';td.textContent='No accounts match these filters.';}
  putText('Page',total?(offset+1)+'–'+(offset+users.length)+' of '+total+' accounts':'0 accounts');
  const prev=document.querySelector('#neisUsersPanel [data-nu-prev]'),next=document.querySelector('#neisUsersPanel [data-nu-next]');
  if(prev)prev.disabled=offset===0;if(next)next.disabled=offset+users.length>=total;
}
function field(box,title,value){
  const item=document.createElement('div');item.className='nu-field';
  const label=document.createElement('dt');label.textContent=title;
  const val=document.createElement('dd');val.textContent=Array.isArray(value)?(value.length?value.join(', '):'—'):
    value===true?'Yes':value===false?'No':value==null||value===''?'—':String(value);
  item.append(label,val);box.appendChild(item);
}
function detailRender(data){
  const root=$('Detail');if(!root)return;root.replaceChildren();root.className='nu-detail open';
  if(!data){root.textContent='Account not found';return;}
  const header=document.createElement('div');header.className='nu-detail-head';
  const main=document.createElement('div'),h=document.createElement('h3'),s=document.createElement('p');
  h.textContent=data.profile?.full_name||data.email||'User details';s.textContent=data.email||'No email';s.className='nu-sub';
  main.append(h,s);const close=document.createElement('button');close.type='button';close.textContent='Close';close.dataset.nuClose='1';
  header.append(main,close);root.appendChild(header);
  const grid=document.createElement('dl');grid.className='nu-fields';
  const p=data.profile||{};
  const items=[['User ID',data.user_id],['Email',data.email],['Provider',data.providers],
    ['Confirmed at',fmtDate(data.confirmed_at,true)],['Joined at',fmtDate(data.created_at,true)],
    ['Last sign-in',fmtDate(data.last_sign_in_at,true)],
    ['Auth restriction',data.banned_until&&new Date(data.banned_until)>new Date()?'Banned until '+fmtDate(data.banned_until,true):'None'],
    ['Full name',p.full_name],['Username',p.username],['Grade',p.grade],['Branch',p.branch],
    ['Campus',p.campus],['Graduation year',p.graduation_year],['Role',p.role],
    ['Account status',p.account_status],['Onboarding complete',p.onboarding_complete],
    ['Profile verified',p.verified],['Posts',data.posts_count],['Interests',p.interests],
    ['Skills',p.skills],['Bio',p.bio]];
  for(const [k,v] of items)field(grid,k,v);
  root.appendChild(grid);root.scrollIntoView({block:'nearest',behavior:'smooth'});
}
async function load(force=false){
  const root=$('Panel');if(!root||!isOwner()||typeof sb==='undefined'||!sb)return;
  if(loading){pendingRefresh=true;return;}
  if(!force&&root===first)return;
  first=root;loading=true;const current=++seq;putText('Connection','● Loading…');
  try{
    const requests=[sb.rpc('main_admin_auth_users',{p_search:search,p_filter:filter,p_sort:sort,p_limit:20,p_offset:offset})];
    if(!stats||force)requests.push(sb.rpc('main_admin_auth_overview'));
    const res=await Promise.all(requests);
    if(res[0].error)throw res[0].error;
    if(res[1]?.error)throw res[1].error;
    if(!isOwner()||!root.isConnected||current!==seq)return;
    if(res[1])stats=res[1].data;
    statsRender();renderUsers(res[0].data);putText('Connection','● OVH connected');
  }catch(e){
    if(root.isConnected){putText('Connection','● Unavailable');const rows=$('Rows');if(rows){rows.replaceChildren();const tr=rows.insertRow(),td=tr.insertCell();td.colSpan=7;td.className='nu-empty';td.textContent='Cannot load accounts: '+(e?.message||'Please retry.');}}
  }finally{
    loading=false;
    if(pendingRefresh){pendingRefresh=false;void load(true);}
  }
}
async function details(id){
  if(!isOwner()||typeof sb==='undefined'||!sb)return;
  const root=$('Detail');if(!root)return;root.className='nu-detail open';root.textContent='Loading account details…';
  try{
    const {data,error}=await sb.rpc('main_admin_auth_user_detail',{p_user_id:id});
    if(error)throw error;
    if(root.isConnected&&isOwner())detailRender(data);
  }catch(e){if(root.isConnected)root.textContent='Could not load account: '+(e?.message||'Try again.');}
}
document.addEventListener('input',event=>{
  if(event.target?.id!=='neisUsersSearch'||!isOwner())return;
  const value=event.target.value.slice(0,100);clearTimeout(debounce);
  debounce=setTimeout(()=>{search=value;offset=0;const d=$('Detail');if(d)d.className='nu-detail';void load(true)},300);
});
document.addEventListener('change',event=>{
  if(!isOwner()||!['neisUsersFilter','neisUsersSort'].includes(event.target?.id))return;
  filter=$('Filter')?.value||'all';sort=$('Sort')?.value||'newest';offset=0;
  const d=$('Detail');if(d)d.className='nu-detail';void load(true);
});
document.addEventListener('click',event=>{
  if(!isOwner())return;
  const node=event.target?.closest?.('#neisUsersPanel button');if(!node)return;
  if(node.matches('[data-nu-refresh]')){stats=null;void load(true)}
  else if(node.matches('[data-nu-next]')){offset+=20;void load(true)}
  else if(node.matches('[data-nu-prev]')){offset=Math.max(0,offset-20);void load(true)}
  else if(node.matches('[data-nu-user]'))void details(node.dataset.nuUser);
  else if(node.matches('[data-nu-close]')){const d=$('Detail');if(d){d.className='nu-detail';d.replaceChildren()}}
});
})();