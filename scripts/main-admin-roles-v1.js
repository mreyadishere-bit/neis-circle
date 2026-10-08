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
    if(!data?.length){results.textContent='No matching users.';return}
    const frag=document.createDocumentFragment();
    for(const p of data){
      const isMain=p.user_id===MAIN_ID,admin=p.role==='admin';
      const row=document.createElement('div');
      row.className='main-admin-role-row';
      row.innerHTML='<div class="main-admin-role-name"><b>'+htmlEscape(p.full_name||'Student')+'</b><small>@'+htmlEscape(p.username||'student')+' · '+htmlEscape(isMain?'Main Admin':admin?'Admin':p.role||'Student')+'</small></div>'+
        (isMain?'<span class="main-admin-protected">Protected</span>':'<button type="button" class="secondary" data-role-user="'+htmlEscape(p.user_id)+'" data-role-enable="'+(!admin)+'">'+(admin?'Remove Admin':'Make Admin')+'</button>');
      frag.appendChild(row);
    }
    results.appendChild(frag);
  }
  const baseAdmin=admin;
  admin=function(){
    const page=baseAdmin();
    if(!isOwner()||!state.isAdmin)return page;
    queueMicrotask(()=>{if(state.view==='admin')loadRoles()});
    return page+`<section class="module-card" id="mainAdminRoles" style="margin-top:20px">
      <h2>Manage Administrators</h2>
      <p>Grant or revoke platform Admin permissions. Only the Main Admin can change roles.</p>
      <label class="field">Search students by name or username<input data-role-search type="search" autocomplete="off" placeholder="Search students…"></label>
      <div data-role-results aria-live="polite">Loading users…</div>
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
      button.textContent=makeAdmin?'Make Admin':'Remove Admin';
      if(typeof toast==='function')toast(error.message||'Role update failed.');
    }
  });
})();