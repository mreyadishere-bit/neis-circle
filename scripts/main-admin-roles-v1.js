/* Main-admin role management. Server RPCs enforce permissions independently of the UI. */
(()=>{
  'use strict';
  const MAIN_ID='25b556a3-ec6f-49e7-ac6c-1b09720e3bfd';
  const isOwner=()=>typeof authUser!=='undefined'&&authUser?.id===MAIN_ID;
  const htmlEscape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let generation=0,searchTimer=null;
  async function loadRoles(){
    const root=document.getElementById('mainAdminRoles');
    if(!root||!isOwner()||typeof sb==='undefined'||!sb)return;
    const serial=++generation;
    const results=root.querySelector('[data-role-results]');
    if(!results)return;
    const query=root.querySelector('[data-role-search]')?.value||'';
    results.textContent='Loading users…';
    const {data,error}=await sb.rpc('main_admin_list_roles',{p_search:query.trim().slice(0,80)});
    if(serial!==generation||!root.isConnected)return;
    if(error){results.textContent='Could not load users: '+error.message;return}
    results.replaceChildren();
    if(!data?.length){results.innerHTML='<div class="main-admin-empty">No matching students found.</div>';return}
    const frag=document.createDocumentFragment();
    for(const p of data){
      const isMain=p.user_id===MAIN_ID,admin=p.role==='admin';
      const row=document.createElement('div');
      row.className='main-admin-role-row';
      const name=htmlEscape(p.full_name||'Student'),user=htmlEscape(p.username||'student');
      const initials=(p.full_name||p.username||'S').trim().split(/\s+/).slice(0,2).map(word=>word[0]).join('').toUpperCase();
      row.innerHTML='<div class="main-admin-person"><span class="main-admin-avatar" aria-hidden="true">'+htmlEscape(initials)+'</span><div class="main-admin-role-name"><b>'+name+'</b><small>@'+user+'</small></div></div>'+
        '<span class="main-admin-role-pill '+(isMain?'is-owner':admin?'is-admin':'is-member')+'">'+(isMain?'Main Admin':admin?'Admin':'Student')+'</span>'+
        '<div class="main-admin-role-action">'+(isMain?'<span class="main-admin-protected">Protected</span>':'<button type="button" class="'+(admin?'main-admin-remove':'main-admin-grant')+'" data-role-user="'+htmlEscape(p.user_id)+'" data-role-enable="'+(!admin)+'">'+(admin?'Remove access':'Make admin')+'</button>')+'</div>';
      frag.appendChild(row);
    }
    results.appendChild(frag);
    const count=root.querySelector('[data-role-count]');if(count)count.textContent=data.length+' users shown';
  }
  const baseAdmin=admin;
  admin=function(){
    const page=baseAdmin();
    if(!isOwner()||!state.isAdmin)return page;
    queueMicrotask(()=>{if(state.view==='admin')loadRoles()});
    return page+`<section class="module-card main-admin-panel" id="mainAdminRoles">
      <div class="main-admin-header"><div><span class="main-admin-eyebrow">ACCESS CONTROL</span><h2>Manage Administrators</h2><p>Grant or revoke platform-wide administrator permissions.</p></div><span class="main-admin-security">Main Admin only</span></div>
      <div class="main-admin-toolbar"><label class="main-admin-search"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="10.8" cy="10.8" r="7.3"/><path d="m16 16 5 5"/></svg><input data-role-search type="search" aria-label="Search students" autocomplete="off" placeholder="Search by name or username"></label><small data-role-count></small></div>
      <div class="main-admin-table-head"><span>STUDENT</span><span>ROLE</span><span>ACTION</span></div>
      <div class="main-admin-role-list" data-role-results aria-live="polite">Loading users…</div>
    </section>`;
  };
  document.addEventListener('input',event=>{
    if(!event.target?.matches?.('#mainAdminRoles [data-role-search]'))return;
    clearTimeout(searchTimer);
    searchTimer=setTimeout(loadRoles,250);
  });
  document.addEventListener('click',async event=>{
    const button=event.target?.closest?.('#mainAdminRoles [data-role-user]');
    if(!button||!isOwner()||button.disabled)return;
    const makeAdmin=button.dataset.roleEnable==='true';
    const username=button.closest('.main-admin-role-row')?.querySelector('b')?.textContent||'this user';
    if(!confirm((makeAdmin?'Make ':'Remove Admin from ')+username+'?'))return;
    button.disabled=true;button.textContent='Saving…';
    try{
      const {error}=await sb.rpc('main_admin_set_user_role',{p_user_id:button.dataset.roleUser,p_make_admin:makeAdmin});
      if(error)throw error;
      await loadRoles();
      if(typeof toast==='function')toast(makeAdmin?'Admin access granted.':'Admin access removed.');
    }catch(error){
      button.disabled=false;
      button.textContent=makeAdmin?'Make admin':'Remove access';
      if(typeof toast==='function')toast(error.message||'Role update failed.');
    }
  });
})();