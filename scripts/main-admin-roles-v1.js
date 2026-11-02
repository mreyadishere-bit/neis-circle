/* Unified Access Control → Manage Administrators. RPCs enforce every role change. */
(()=>{
  'use strict';
  if(typeof admin!=='function')return;
  const MAIN_ID='25b556a3-ec6f-49e7-ac6c-1b09720e3bfd';
  const main=()=>typeof authUser!=='undefined'&&authUser?.id===MAIN_ID;
  let serial=0,searchTimer=null,capabilities=null,lastVerifiedUser=null;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const notify=s=>{if(typeof toast==='function')toast(s);else window.alert(s)};
  const active=()=>typeof state!=='undefined'&&state?.isAdmin===true;
  async function loadRoles(){
    const root=document.getElementById('mainAdminRoles');
    if(!root||!active()||typeof sb==='undefined'||!sb||!authUser)return;
    const current=++serial;
    const results=root.querySelector('[data-role-results]');
    if(!results)return;
    root.hidden=true;
    try{
      const {data:perms,error:permissionsError}=await sb.rpc('neis_admin_capabilities');
      if(permissionsError)throw permissionsError;
      if(current!==serial||!root.isConnected)return;
      capabilities=perms;
      const canAccess=Boolean(perms?.super_admin);
      const before=window.neisSuperAdminGranted===true&&window.neisSuperAdminUser===authUser.id;
      window.neisSuperAdminGranted=canAccess;
      window.neisSuperAdminUser=authUser.id;
      if(!canAccess){results.textContent='Access denied.';return}
      root.hidden=false;
      const badge=root.querySelector('[data-access-level]');
      if(badge)badge.textContent=perms.owner?'Main Admin · protected':'Super Admin';
      // Rebuild the legacy owner-only panels once when a verified super admin signs in.
      if(!before&&!perms.owner&&lastVerifiedUser!==authUser.id&&typeof render==='function'){
        lastVerifiedUser=authUser.id;
        render();
        return;
      }
      results.textContent='Loading administrators…';
      const query=root.querySelector('[data-role-search]')?.value?.trim().slice(0,80)||'';
      const response=await sb.rpc('neis_admin_users',{p_search:query});
      if(current!==serial||!root.isConnected)return;
      if(response.error)throw response.error;
      const users=Array.isArray(response.data)?response.data:[];
      // Admins at the top. A search includes students for granting new access.
      users.sort((a,b)=>(Number(b.is_owner)-Number(a.is_owner))||
        (Number(b.is_super)-Number(a.is_super))||
        (Number(b.role==='admin')-Number(a.role==='admin'))||
        String(a.full_name||a.username).localeCompare(String(b.full_name||b.username)));
      results.replaceChildren();
      if(!users.length){results.innerHTML='<div class="main-admin-empty">No matching accounts.</div>';return}
      const fragment=document.createDocumentFragment();
      for(const user of users){
        const owner=user.user_id===MAIN_ID||user.is_owner===true;
        const superRole=!owner&&user.is_super===true;
        const standardAdmin=!owner&&!superRole&&user.role==='admin';
        const row=document.createElement('div');row.className='main-admin-role-row';
        const name=esc(user.full_name||user.username||'Account');
        const username=esc(user.username||'user');
        const initials=(user.full_name||user.username||'U').trim().split(/\s+/).slice(0,2)
          .map(p=>p[0]).join('').toUpperCase();
        const label=owner?'Main Admin':superRole?'Super Admin':standardAdmin?'Admin':'Student';
        const cls=owner?'is-owner':superRole?'is-super':standardAdmin?'is-admin':'is-member';
        row.innerHTML='<div class="main-admin-person"><span class="main-admin-avatar" aria-hidden="true">'+esc(initials)+'</span>'+
          '<div class="main-admin-role-name"><b>'+name+'</b><small>@'+username+'</small></div></div>'+
          '<span class="main-admin-role-pill '+cls+'">'+label+'</span>'+
          '<div class="main-admin-role-action" data-account-actions></div>';
        const actions=row.querySelector('[data-account-actions]');
        if(owner){
          const label=document.createElement('span');label.className='main-admin-protected';
          label.textContent='Protected';actions.append(label);
        }else{
          if(perms.owner&&standardAdmin||perms.owner&&superRole){
            const btn=document.createElement('button');btn.type='button';
            btn.className=superRole?'main-admin-remove':'main-admin-grant';
            btn.dataset.roleSuper=user.user_id;
            btn.dataset.roleSuperEnable=String(!superRole);
            btn.textContent=superRole?'Remove Super Admin':'Make Super Admin';
            actions.append(btn);
          }
          // Super admins can manage regular admins, never owner/other super admins.
          if(!superRole&&user.user_id!==authUser.id){
            const btn=document.createElement('button');btn.type='button';
            btn.className=standardAdmin?'main-admin-remove':'main-admin-grant';
            btn.dataset.roleRegular=user.user_id;
            btn.dataset.roleRegularEnable=String(!standardAdmin);
            btn.textContent=standardAdmin?'Remove Admin':'Make Admin';
            actions.append(btn);
          }
        }
        fragment.append(row);
      }
      results.append(fragment);
      const count=root.querySelector('[data-role-count]');
      if(count)count.textContent=users.length+' accounts shown'+(query?'':' · search for more');
    }catch(error){
      if(current!==serial||!root.isConnected)return;
      root.hidden=false;results.textContent='Could not load administrators: '+(error?.message||'Retry');
    }
  }
  const baseAdmin=admin;
  admin=function(){
    const page=baseAdmin.apply(this,arguments);
    if(!active())return page;
    queueMicrotask(()=>{if(state.view==='admin')void loadRoles()});
    return page+`<section class="module-card main-admin-panel" id="mainAdminRoles" hidden>
      <div class="main-admin-header">
        <div><span class="main-admin-eyebrow">ACCESS CONTROL</span>
          <h2>Manage Administrators</h2>
          <p>Manage Admin and Super Admin permissions in one place. Only the main admin can grant or revoke Super Admin.</p>
        </div><span class="main-admin-security" data-access-level>Main Admin</span>
      </div>
      <div class="main-admin-toolbar">
        <label class="main-admin-search"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="10.8" cy="10.8" r="7.3"/><path d="m16 16 5 5"/></svg>
          <input data-role-search type="search" autocomplete="off" aria-label="Find user to manage access" placeholder="Search users to grant access"></label>
        <small data-role-count></small><button type="button" class="secondary" data-role-refresh>Refresh</button>
      </div>
      <div class="main-admin-table-head"><span>ACCOUNT</span><span>ROLE</span><span>ACTIONS</span></div>
      <div class="main-admin-role-list" data-role-results aria-live="polite">Loading…</div>
    </section>`;
  };
  document.addEventListener('input',event=>{
    if(!event.target?.matches?.('#mainAdminRoles [data-role-search]'))return;
    clearTimeout(searchTimer);searchTimer=setTimeout(()=>void loadRoles(),270);
  });
  document.addEventListener('click',async event=>{
    const button=event.target?.closest?.('#mainAdminRoles button');
    if(!button||!active()||button.disabled)return;
    if(button.hasAttribute('data-role-refresh')){void loadRoles();return}
    if(!capabilities?.super_admin||!authUser)return;
    const superId=button.dataset.roleSuper;
    const normalId=button.dataset.roleRegular;
    const id=superId||normalId;
    if(!id||id===MAIN_ID||id===authUser.id)return;
    const elevated=Boolean(superId);
    if(elevated&&!capabilities.owner)return;
    const enabled=elevated?button.dataset.roleSuperEnable==='true':
      button.dataset.roleRegularEnable==='true';
    const name=button.closest('.main-admin-role-row')?.querySelector('b')?.textContent||'this account';
    if(!window.confirm((enabled?'Grant ':'Revoke ')+(elevated?'Super Admin':'Admin')+' permissions '+(enabled?'to ':'from ')+name+'?'))return;
    button.disabled=true;button.textContent='Saving…';
    try{
      const rpc=elevated?'neis_admin_set_super':'neis_admin_set_regular_admin';
      const args=elevated?{p_user_id:id,p_enabled:enabled}:
        {p_user_id:id,p_make_admin:enabled};
      const res=await sb.rpc(rpc,args);if(res.error)throw res.error;
      await loadRoles();
      notify('Access permissions updated.');
    }catch(error){button.disabled=false;button.textContent='Retry update';
      notify(error?.message||'Role update failed.')}
  });
})();