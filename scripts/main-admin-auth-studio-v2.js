/* Supabase Studio-inspired identity browser, scoped to main admin and OVH. */
(()=>{
  'use strict';
  const MAIN_ADMIN='25b556a3-ec6f-49e7-ac6c-1b09720e3bfd';
  const isOwner=()=>typeof authUser!=='undefined'&&authUser?.id===MAIN_ADMIN&&
    typeof state!=='undefined'&&state?.isAdmin===true;
  if(typeof admin!=='function')return;
  const rootId='neisAuthStudio';
  const $=(suffix)=>document.getElementById('naStudio'+suffix);
  let currentPage=0, pageSize=20, search='', searchField='all', filter='all';
  let provider='all', sort='created_desc', busy=false, pending=false, nonce=0, loadedRoot=null;
  let overview=null, data=null, detailsId=null, detailsGeneration=0;
  const selected=new Set();
  const available=[
    ['user_id','UID'],['display_name','Display name'],['email','Email'],['phone','Phone'],
    ['providers','Providers'],['provider_type','Provider type'],['created_at','Created at'],
    ['last_sign_in_at','Last sign in at'],['status','Status'],['branch','Branch'],
    ['grade','Grade'],['role','Role']
  ];
  let columns=new Set(available.map(x=>x[0]));
  const when=(raw,long=false)=>{
    if(!raw)return '—';
    const d=new Date(raw);
    return Number.isNaN(d.getTime())?'—':long?d.toString():d.toLocaleString(undefined,
      {day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
  };
  const el=(tag,className='',txt)=>{
    const node=document.createElement(tag);
    if(className)node.className=className;
    if(txt!==undefined)node.textContent=String(txt);
    return node;
  };
  const styles=[
    '#neisAuthStudio{--st-bg:#101111;--st-panel:#151616;--st-border:#303232;--st-hover:#1e2020;--st-fg:#f5f5f5;--st-secondary:#a2a4a4;--st-green:#07894f;--st-warn:#ce9662;background:var(--st-bg)!important;border:1px solid var(--st-border)!important;color:var(--st-fg)!important;border-radius:14px;padding:0!important;margin:20px 0;overflow:hidden;font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif}',
    '#neisAuthStudio *{box-sizing:border-box}',
    '#neisAuthStudio [hidden]{display:none!important}',
    '#neisAuthStudio .st-title{padding:21px 25px 16px;border-bottom:1px solid var(--st-border);display:flex;align-items:center;justify-content:space-between;gap:12px}',
    '#neisAuthStudio h2{font-size:19px;margin:0;color:var(--st-fg);font-weight:650}',
    '#neisAuthStudio h3{font-size:16px;margin:0}',
    '#neisAuthStudio .st-sub{font-size:11px;color:var(--st-secondary)}',
    '#neisAuthStudio .st-actionbar{display:flex;align-items:center;gap:9px;flex-wrap:wrap;padding:13px 20px;background:#171818;border-bottom:1px solid var(--st-border)}',
    '#neisAuthStudio input,#neisAuthStudio select,#neisAuthStudio button{font-family:inherit;color:var(--st-fg);font-size:12px}',
    '#neisAuthStudio input,#neisAuthStudio select,#neisAuthStudio button.st-btn,#neisAuthStudio summary{height:37px;min-width:0;border-radius:8px;border:1px solid #3a3d3c;background:#222424;padding:0 12px}',
    '#neisAuthStudio input::placeholder{color:#8c9291}',
    '#neisAuthStudio input:focus-visible,#neisAuthStudio select:focus-visible,#neisAuthStudio button:focus-visible,#neisAuthStudio summary:focus-visible{outline:2px solid #6cb69b;outline-offset:2px}',
    '#neisAuthStudio button{cursor:pointer}',
    '#neisAuthStudio button:disabled{opacity:.45;cursor:default}',
    '#neisAuthStudio .st-btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;white-space:nowrap}',
    '#neisAuthStudio .st-btn:hover:not(:disabled),#neisAuthStudio summary:hover{background:#2c2d2d}',
    '#neisAuthStudio .st-add{background:#046b41!important;border-color:#19794f!important;font-weight:700}',
    '#neisAuthStudio .st-add:hover{background:#0c8051!important}',
    '#neisAuthStudio .st-search{display:flex;align-items:center;flex:1 1 360px;min-width:190px;gap:0}',
    '#neisAuthStudio .st-search select{max-width:148px;border-radius:8px 0 0 8px;border-right:0}',
    '#neisAuthStudio .st-search input{min-width:100px;flex:1;border-radius:0 8px 8px 0;background:#121313}',
    '#neisAuthStudio .st-push{margin-left:auto}',
    '#neisAuthStudio select{appearance:auto}',
    '#neisAuthStudio select option{background:#222;color:white}',
    '#neisAuthStudio details{position:relative}',
    '#neisAuthStudio details summary{display:flex;align-items:center;cursor:pointer;list-style:none;gap:7px;white-space:nowrap;user-select:none}',
    '#neisAuthStudio details summary::-webkit-details-marker{display:none}',
    '#neisAuthStudio .st-menu{position:absolute;top:calc(100% + 6px);right:0;z-index:12;min-width:230px;max-height:360px;overflow:auto;padding:12px;background:#242626;border:1px solid #424646;border-radius:10px;box-shadow:0 12px 30px #0008}',
    '#neisAuthStudio .st-check{display:flex;align-items:center;gap:9px;padding:6px 4px;font-size:12px;cursor:pointer}',
    '#neisAuthStudio input[type=checkbox]{width:15px;height:15px;min-width:15px;accent-color:#159e70;cursor:pointer}',
    '#neisAuthStudio .st-table{width:100%;overflow:auto;max-height:590px;scrollbar-color:#555 #1c1d1d}',
    '#neisAuthStudio table{min-width:980px;width:max-content;max-width:none;border-collapse:separate;border-spacing:0;table-layout:fixed;font-size:12px}',
    '#neisAuthStudio th{background:#181919;position:sticky;top:0;z-index:2;text-align:left;white-space:nowrap;font-weight:650;padding:12px 11px;border-right:1px solid #292c2b;border-bottom:1px solid #343736;color:#ddd;vertical-align:middle}',
    '#neisAuthStudio th button{color:inherit;background:transparent;border:0;font-size:12px;padding:0;cursor:pointer;text-align:left}',
    '#neisAuthStudio td{height:52px;background:#111212;border-right:1px solid #2b2c2c;border-bottom:1px solid #272a29;padding:9px 11px;vertical-align:middle;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '#neisAuthStudio tr:hover td{background:var(--st-hover)}',
    '#neisAuthStudio tr.st-checked td{background:#173024}',
    '#neisAuthStudio .st-choose{width:47px;min-width:47px;text-align:center}',
    '#neisAuthStudio .st-uid{width:316px;min-width:316px}',
    '#neisAuthStudio .st-name{width:210px;min-width:210px}',
    '#neisAuthStudio .st-mail{width:310px;min-width:310px}',
    '#neisAuthStudio .st-phone{width:176px;min-width:176px}',
    '#neisAuthStudio .st-provider{width:165px;min-width:165px}',
    '#neisAuthStudio .st-provider-type{width:122px;min-width:122px}',
    '#neisAuthStudio .st-datetime{width:242px;min-width:242px}',
    '#neisAuthStudio .st-other{width:145px;min-width:145px}',
    '#neisAuthStudio .st-link{color:#f4f4f4;text-align:left;border:0;background:none;padding:0;white-space:nowrap;font-weight:620;max-width:100%;overflow:hidden;text-overflow:ellipsis}',
    '#neisAuthStudio .st-link:hover{color:#83d4b2;text-decoration:underline}',
    '#neisAuthStudio .st-avatar{width:25px;height:25px;border-radius:50%;display:inline-grid;place-items:center;font-size:11px;font-weight:700;background:#6b57aa;color:white}',
    '#neisAuthStudio .st-provider-label{display:inline-flex;align-items:center;gap:7px}',
    '#neisAuthStudio .st-google{display:inline-grid;place-items:center;width:24px;height:24px;background:#202323;border-radius:50%;border:1px solid #383c3c;font-size:15px;font-weight:850;color:#4285f4}',
    '#neisAuthStudio .st-soft{color:var(--st-secondary)}',
    '#neisAuthStudio .st-state{padding:4px 7px;border-radius:7px;background:#23352e;color:#7ed2a8}',
    '#neisAuthStudio .st-state.warn{background:#372f21;color:#e0b478}',
    '#neisAuthStudio .st-state.bad{background:#3b2528;color:#f49c9b}',
    '#neisAuthStudio .st-foot{display:flex;gap:9px;justify-content:space-between;align-items:center;flex-wrap:wrap;padding:13px 20px;border-top:1px solid var(--st-border);font-size:11px;color:var(--st-secondary)}',
    '#neisAuthStudio .st-meta{display:flex;gap:12px;flex-wrap:wrap;align-items:center}',
    '#neisAuthStudio .st-detail{border-top:1px solid var(--st-border);padding:24px;background:#151717}',
    '#neisAuthStudio .st-detail-head{display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap;margin-bottom:18px}',
    '#neisAuthStudio .st-detail-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:14px 0 0}',
    '#neisAuthStudio .st-field{border:1px solid #323534;border-radius:10px;padding:12px;background:#1d2020;min-width:0}',
    '#neisAuthStudio dt{color:var(--st-secondary);font-size:11px;margin-bottom:6px}',
    '#neisAuthStudio dd{margin:0;font-size:12px;word-break:break-word;white-space:normal}',
    '#neisAuthStudio .st-empty{padding:35px 20px!important;text-align:center;color:#a4aaaa}',
    '#neisAuthStudio .st-toast{font-size:11px;color:#94d2b6}',
    '@media(max-width:700px){#neisAuthStudio .st-actionbar{padding:12px}#neisAuthStudio .st-title{padding:16px}#neisAuthStudio .st-search{flex-basis:100%}#neisAuthStudio .st-push{margin-left:0}#neisAuthStudio .st-detail-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}',
    '@media(max-width:460px){#neisAuthStudio .st-search select{max-width:125px}#neisAuthStudio .st-detail-grid{grid-template-columns:1fr}}'
  ].join('');
  const shell=
    '<style id="naStudioCss">'+styles+'</style>'+
    '<section class="module-card" id="neisAuthStudio" aria-label="OVH Authentication Users">'+
    '<div class="st-title"><div><h2>Users</h2><div class="st-sub">Authentication · OVH · Main Admin only</div></div>'+
    '<span id="naStudioStatus" class="st-sub">● Connecting…</span></div>'+
    '<div class="st-actionbar">'+
      '<label class="st-search"><select id="naStudioField" aria-label="Search field">'+
        '<option value="all">Unified search</option><option value="id">User ID</option>'+
        '<option value="email">Email</option><option value="phone">Phone</option>'+
        '<option value="name">Display name</option></select>'+
        '<input type="search" id="naStudioQuery" aria-label="Search users" autocomplete="off" placeholder="Search by user ID, email, phone or name"></label>'+
      '<select id="naStudioFilter" aria-label="User status filter"><option value="all">All users</option>'+
        '<option value="confirmed">Confirmed</option><option value="pending">Unconfirmed</option>'+
        '<option value="blocked">Blocked / inactive</option><option value="admins">Admins</option>'+
        '<option value="no_profile">Missing profile</option><option value="signed_in_30d">Active in 30 days</option></select>'+
      '<select id="naStudioProvider" aria-label="Provider"><option value="all">Provider: All</option>'+
        '<option value="google">Google</option><option value="other">Other providers</option></select>'+
      '<details id="naStudioColumns"><summary>All columns ▾</summary><div class="st-menu" id="naStudioColumnsMenu"></div></details>'+
      '<select id="naStudioSort" aria-label="Sort users">'+
        '<option value="created_desc">↓ Sorted by created at</option>'+
        '<option value="created_asc">↑ Oldest first</option>'+
        '<option value="last_sign_in_desc">↓ Last sign in</option>'+
        '<option value="last_sign_in_asc">↑ Least recent sign in</option>'+
        '<option value="email_asc">↑ Email A–Z</option><option value="email_desc">↓ Email Z–A</option>'+
        '<option value="name_asc">↑ Display name</option></select>'+
      '<button type="button" class="st-btn st-push" data-st-action="refresh" title="Refresh users">↻ Refresh</button>'+
      '<details id="naStudioAddMenu"><summary class="st-add">＋ Add user ▾</summary>'+
        '<div class="st-menu"><div style="font-weight:650;margin-bottom:6px">Google Sign-in only</div>'+
        '<p class="st-sub" style="margin:5px 0 12px">Accounts are created securely when students first sign in with Google. No password-based users are created.</p>'+
        '<button class="st-btn" type="button" data-st-action="copy-invite">Copy sign-up link</button></div></details>'+
    '</div>'+
    '<div class="st-actionbar" id="naStudioSelectedBar" hidden>'+
      '<span id="naStudioSelectedCount" class="st-sub">0 selected</span>'+
      '<button type="button" class="st-btn" data-st-action="copy-ids">Copy UIDs</button>'+
      '<button type="button" class="st-btn" data-st-action="export-selected">Export selected CSV</button>'+
      '<button type="button" class="st-btn" data-st-action="clear-selection">Clear selection</button>'+
    '</div>'+
    '<div class="st-table" role="region" aria-label="Users table (scroll horizontally)" tabindex="0">'+
      '<table><thead id="naStudioHead"></thead><tbody id="naStudioRows"></tbody></table></div>'+
    '<div class="st-foot"><div class="st-meta"><span id="naStudioPage">Loading…</span>'+
      '<span id="naStudioSummary">Self-hosted Auth</span></div>'+
      '<div style="display:flex;align-items:center;gap:8px"><span id="naStudioToast" class="st-toast" aria-live="polite"></span>'+
        '<button class="st-btn" type="button" data-st-action="prev">← Previous</button>'+
        '<button class="st-btn" type="button" data-st-action="next">Next →</button></div></div>'+
    '<div id="naStudioDetail" class="st-detail" hidden></div>'+
    '</section>';
  const oldAdmin=admin;
  admin=function(){
    const page=oldAdmin.apply(this,arguments);
    if(!isOwner())return page;
    queueMicrotask(()=>{if(state.view==='admin')void load()});
    return page+shell;
  };
  function message(msg){const node=$('Toast');if(node)node.textContent=msg;}
  function statusOf(u){
    if(u.banned||u.account_status&&u.account_status!=='active')return ['Blocked','bad'];
    if(!u.confirmed)return ['Unconfirmed','warn'];
    if(!u.has_profile)return ['No profile','warn'];
    return ['Confirmed',''];
  }
  function showColumns(){
    const m=$('ColumnsMenu');if(!m)return;m.replaceChildren();
    for(const [key,title] of available){
      const label=el('label','st-check');
      const check=el('input');check.type='checkbox';check.checked=columns.has(key);
      check.dataset.stColumn=key;
      label.append(check,document.createTextNode(title));m.appendChild(label);
    }
  }
  function colClass(k){
    return ['user_id'].includes(k)?'st-uid':
      k==='display_name'?'st-name':k==='email'?'st-mail':
      k==='phone'?'st-phone':k==='providers'?'st-provider':
      k==='provider_type'?'st-provider-type':
      ['created_at','last_sign_in_at'].includes(k)?'st-datetime':'st-other';
  }
  function shown(){return available.filter(x=>columns.has(x[0]));}
  function addCell(tr,k,u){
    const td=el('td');td.className=colClass(k);td.title='';
    const val=u[k];
    if(k==='user_id'||k==='email'||k==='display_name'){
      const b=el('button','st-link',k==='user_id'?u.user_id||'—':
        k==='email'?u.email||'—':u.display_name||'—');
      b.type='button';b.dataset.stDetail=u.user_id;b.title='Open user details';
      td.appendChild(b);
    }else if(k==='providers'){
      const label=el('span','st-provider-label');
      const tag=el('span','st-google',u.google_provider?'G':'●');
      label.append(tag,document.createTextNode((u.providers||[]).join(', ')||'—'));td.appendChild(label);
    }else if(k==='provider_type'){
      td.textContent=u.google_provider?'Social':'Other';
    }else if(k==='status'){
      const [text,cls]=statusOf(u);td.appendChild(el('span','st-state '+cls,text));
    }else if(k==='created_at'||k==='last_sign_in_at'){
      td.textContent=when(val,true);td.title=when(val,true);
    }else{
      td.textContent=val==null||val===''?'—':String(val);
      td.title=td.textContent;
    }
    tr.appendChild(td);
  }
  function render(){
    const head=$('Head'),body=$('Rows');if(!head||!body)return;
    head.replaceChildren();body.replaceChildren();
    const htr=el('tr');
    const all=el('th','st-choose'),allCheck=el('input');allCheck.type='checkbox';
    allCheck.dataset.stSelectAll='1';
    const users=Array.isArray(data?.users)?data.users:[];
    allCheck.checked=users.length>0&&users.every(u=>selected.has(u.user_id));
    allCheck.indeterminate=users.some(u=>selected.has(u.user_id))&&!allCheck.checked;
    allCheck.setAttribute('aria-label','Select all users on this page');
    all.appendChild(allCheck);htr.appendChild(all);
    for(const [key,title] of shown()){
      const th=el('th',colClass(key)),sortKey={
        user_id:null,display_name:'name_asc',email:'email_asc',
        created_at:'created_desc',last_sign_in_at:'last_sign_in_desc'
      }[key];
      if(sortKey){
        const b=el('button','',title+' '+(sort===sortKey?'▾':'⌄'));
        b.type='button';b.dataset.stSort=key;th.appendChild(b);
      }else th.textContent=title;
      htr.appendChild(th);
    }
    head.appendChild(htr);
    if(!users.length){
      const row=el('tr'),cell=el('td','st-empty','No users found with these filters.');
      cell.colSpan=shown().length+1;row.appendChild(cell);body.appendChild(row);
    }
    for(const u of users){
      const tr=el('tr',selected.has(u.user_id)?'st-checked':'');
      const checkCell=el('td','st-choose'),ch=el('input');
      ch.type='checkbox';ch.dataset.stSelect=u.user_id;ch.checked=selected.has(u.user_id);
      ch.setAttribute('aria-label','Select '+(u.display_name||u.email||'account'));
      checkCell.appendChild(ch);tr.appendChild(checkCell);
      for(const [key] of shown())addCell(tr,key,u);
      body.appendChild(tr);
    }
    const total=Number(data?.total)||0,offset=currentPage*pageSize;
    const label=$('Page');if(label)label.textContent=total?
      (offset+1)+'–'+(offset+users.length)+' of '+total+' users':'0 users';
    const summary=$('Summary');if(summary&&overview)summary.textContent=
      String(overview.confirmed||0)+' confirmed · '+
      String(overview.google||0)+' Google · '+String(overview.signed_in_30d||0)+' signed in (30d)';
    const prev=document.querySelector('#neisAuthStudio [data-st-action="prev"]');
    const next=document.querySelector('#neisAuthStudio [data-st-action="next"]');
    if(prev)prev.disabled=currentPage===0;
    if(next)next.disabled=offset+users.length>=total;
    renderSelection();
  }
  function renderSelection(){
    const bar=$('SelectedBar'),count=$('SelectedCount');
    if(bar)bar.hidden=selected.size===0;
    if(count)count.textContent=selected.size+' selected (current page)';
  }
  async function load(force=false){
    const root=document.getElementById(rootId);
    if(!root||!isOwner()||typeof sb==='undefined'||!sb)return;
    if(busy){pending=true;return}
    if(!force&&loadedRoot===root)return;
    loadedRoot=root;busy=true;const seq=++nonce;
    const tag=$('Status');if(tag)tag.textContent='● Loading…';
    showColumns();
    try{
      const requests=[sb.rpc('main_admin_auth_users',{
        p_search:search,p_filter:filter,p_sort:sort,p_limit:pageSize,
        p_offset:currentPage*pageSize,p_search_field:searchField,p_provider:provider
      })];
      if(!overview||force)requests.push(sb.rpc('main_admin_auth_overview'));
      const responses=await Promise.all(requests);
      if(responses[0].error)throw responses[0].error;
      if(responses[1]?.error)throw responses[1].error;
      if(!root.isConnected||!isOwner()||seq!==nonce)return;
      data=responses[0].data;if(responses[1])overview=responses[1].data;
      if(tag)tag.textContent='● OVH connected';
      const values=Array.isArray(data?.users)?data.users:[];
      const valid=new Set(values.map(u=>u.user_id));
      for(const id of selected){if(!valid.has(id))selected.delete(id);}
      render();
    }catch(e){
      if(root.isConnected){
        if(tag)tag.textContent='● Data unavailable';
        message('Unable to load users · '+(e?.message||'Retry'));
        const rows=$('Rows');if(rows){rows.replaceChildren();const tr=el('tr'),td=el('td','st-empty',
          'Unable to load accounts. Try refreshing.');td.colSpan=shown().length+1;tr.appendChild(td);rows.appendChild(tr);}
      }
    }finally{busy=false;if(pending){pending=false;void load(true)}}
  }
  function newQuery(){
    search=$('Query')?.value?.slice(0,100)||'';
    searchField=$('Field')?.value||'all';filter=$('Filter')?.value||'all';
    provider=$('Provider')?.value||'all';sort=$('Sort')?.value||'created_desc';
    currentPage=0;selected.clear();void load(true);
  }
  function field(container,label,value){
    const box=el('div','st-field'),dt=el('dt','',label),dd=el('dd');
    dd.textContent=Array.isArray(value)?value.join(', ')||'—':
      value===true?'Yes':value===false?'No':
      value==null||value===''?'—':String(value);
    box.append(dt,dd);container.appendChild(box);
  }
  function renderDetail(d){
    const pane=$('Detail');if(!pane)return;
    pane.replaceChildren();pane.hidden=false;
    if(!d){pane.textContent='User record not found.';return}
    const header=el('div','st-detail-head'),texts=el('div'),title=el('h3','',d.profile?.full_name||d.email||'User details');
    const sub=el('p','st-sub',d.email||'No email address');texts.append(title,sub);
    const actions=el('div'),close=el('button','st-btn','Close');close.type='button';close.dataset.stAction='close-detail';
    const copy=el('button','st-btn','Copy UID');copy.type='button';copy.dataset.stCopyUid=d.user_id;
    actions.append(copy,close);actions.style.display='flex';actions.style.gap='8px';
    header.append(texts,actions);pane.appendChild(header);
    const p=d.profile||{},grid=el('dl','st-detail-grid');
    for(const [key,val] of [
      ['UID',d.user_id],['Display name',p.full_name],['Email',d.email],
      ['Provider(s)',d.providers],['Email confirmed',when(d.confirmed_at,true)],
      ['Created at',when(d.created_at,true)],['Last signed in',when(d.last_sign_in_at,true)],
      ['Auth ban',d.banned_until&&new Date(d.banned_until)>new Date()?
        'Until '+when(d.banned_until,true):'No'],
      ['Username',p.username],['Role',p.role],['Account status',p.account_status],
      ['Grade',p.grade],['Branch',p.branch],['Campus',p.campus],
      ['Graduation year',p.graduation_year],['Onboarding complete',p.onboarding_complete],
      ['Verified',p.verified],['Published posts',d.posts_count],
      ['Interests',p.interests],['Skills',p.skills],['Bio',p.bio]
    ])field(grid,key,val);
    pane.appendChild(grid);
    const note=el('p','st-sub',
      'Identity information is read-only here. Password hashes, access tokens and private Google metadata are never returned.');
    note.style.marginTop='15px';pane.appendChild(note);
    pane.scrollIntoView({behavior:'smooth',block:'nearest'});
  }
  async function showDetail(id){
    const pane=$('Detail');if(!isOwner()||!pane||!id||!sb)return;
    detailsId=id;const gen=++detailsGeneration;
    pane.hidden=false;pane.replaceChildren(el('p','st-sub','Loading account details…'));
    try{
      const {data:record,error}=await sb.rpc('main_admin_auth_user_detail',{p_user_id:id});
      if(error)throw error;
      if(gen===detailsGeneration&&isOwner()&&pane.isConnected)renderDetail(record);
    }catch(e){if(gen===detailsGeneration&&pane.isConnected)pane.replaceChildren(
      el('p','st-sub','Could not load details: '+(e?.message||'Retry')))}
  }
  function copyText(text){
    if(!text)return;
    if(navigator.clipboard?.writeText){
      navigator.clipboard.writeText(text).then(()=>message('Copied to clipboard'))
        .catch(()=>message('Clipboard access is unavailable'));
    }else message('Clipboard access is unavailable in this browser');
  }
  function exportSelected(){
    const users=(data?.users||[]).filter(u=>selected.has(u.user_id));
    if(!users.length)return;
    const headings=['UID','Display name','Email','Phone','Providers','Created at','Last sign in at'];
    const fields=u=>[u.user_id,u.display_name,u.email,u.phone,(u.providers||[]).join(';'),
      u.created_at,u.last_sign_in_at];
    // Excel-safe CSV: prevent spreadsheet formula injection.
    const cell=v=>{
      const str=String(v??'').replace(/^[\s]*[=+\-@]/,x=>"'"+x);
      return '"'+str.replace(/"/g,'""')+'"';
    };
    const body=[headings.map(cell).join(','),...users.map(u=>fields(u).map(cell).join(','))].join('\r\n');
    const blob=new Blob(['\ufeff'+body],{type:'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob);const a=document.createElement('a');
    a.href=url;a.download='neis-selected-users.csv';document.body.appendChild(a);a.click();a.remove();
    URL.revokeObjectURL(url);message('Exported '+users.length+' selected users');
  }
  let searchTimer;
  document.addEventListener('input',e=>{
    if(!isOwner())return;
    if(e.target?.id==='naStudioQuery'){
      clearTimeout(searchTimer);searchTimer=setTimeout(newQuery,300);
    }
  });
  document.addEventListener('change',e=>{
    if(!isOwner())return;
    if(e.target?.dataset?.stColumn){
      const key=e.target.dataset.stColumn;
      if(e.target.checked)columns.add(key);
      else if(columns.size>1)columns.delete(key);
      else e.target.checked=true;
      render();return;
    }
    if(e.target?.dataset?.stSelect){
      const id=e.target.dataset.stSelect;
      if(e.target.checked)selected.add(id);else selected.delete(id);
      render();return;
    }
    if(e.target?.dataset?.stSelectAll){
      for(const u of data?.users||[]){
        if(e.target.checked)selected.add(u.user_id);else selected.delete(u.user_id);
      }
      render();return;
    }
    if(['naStudioField','naStudioFilter','naStudioProvider','naStudioSort'].includes(e.target?.id))
      newQuery();
  });
  document.addEventListener('click',e=>{
    if(!isOwner())return;
    const root=e.target?.closest?.('#neisAuthStudio');if(!root)return;
    const button=e.target?.closest?.('button');if(!button)return;
    if(button.dataset.stDetail){void showDetail(button.dataset.stDetail);return}
    if(button.dataset.stCopyUid){copyText(button.dataset.stCopyUid);return}
    if(button.dataset.stSort){
      const k=button.dataset.stSort;
      if(k==='created_at')sort=sort==='created_desc'?'created_asc':'created_desc';
      if(k==='last_sign_in_at')sort=sort==='last_sign_in_desc'?'last_sign_in_asc':'last_sign_in_desc';
      if(k==='email')sort=sort==='email_asc'?'email_desc':'email_asc';
      if(k==='display_name')sort='name_asc';
      const select=$('Sort');if(select)select.value=sort;
      currentPage=0;selected.clear();void load(true);return;
    }
    switch(button.dataset.stAction){
      case 'refresh':overview=null;void load(true);break;
      case 'prev':if(currentPage>0){currentPage--;selected.clear();void load(true)}break;
      case 'next':if((currentPage+1)*pageSize<(Number(data?.total)||0)){
        currentPage++;selected.clear();void load(true)}break;
      case 'clear-selection':selected.clear();render();break;
      case 'copy-ids':copyText([...selected].join('\n'));break;
      case 'export-selected':exportSelected();break;
      case 'copy-invite':copyText('https://neiscircle.site/');break;
      case 'close-detail':detailsId=null;detailsGeneration++;
        if($('Detail')){$('Detail').hidden=true;$('Detail').replaceChildren()}break;
    }
  });
})();
