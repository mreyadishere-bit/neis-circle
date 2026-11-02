/* Protected Super Admin management. All authorization is enforced by SQL RPCs. */
(()=>{
  'use strict';
  if(typeof admin!=='function')return;
  const previous=admin;
  let nonce=0, capabilities=null, panel=null;
  const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const css=`<style>
  #neisSuperAdmin{margin-top:18px;padding:20px;border-radius:16px;border:1px solid var(--line);background:var(--card)}
  #neisSuperAdmin h2{margin:0 0 7px;font-size:18px}
  #neisSuperAdmin p{font-size:12px;color:var(--muted)}
  #neisSuperAdmin .sa-toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:14px 0}
  #neisSuperAdmin input{padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--ink);width:min(100%,340px)}
  #neisSuperAdmin .sa-row{display:flex;gap:12px;justify-content:space-between;align-items:center;padding:13px 0;border-top:1px solid var(--line);flex-wrap:wrap}
  #neisSuperAdmin .sa-person{display:grid;gap:3px;min-width:0}
  #neisSuperAdmin .sa-person small{color:var(--muted);overflow-wrap:anywhere}
  #neisSuperAdmin .sa-actions{display:flex;gap:8px;flex-wrap:wrap}
  #neisSuperAdmin button{border:1px solid var(--line);border-radius:9px;padding:8px 11px;background:var(--card);color:var(--ink);cursor:pointer}
  #neisSuperAdmin button:disabled{opacity:.45;cursor:not-allowed}
  #neisSuperAdmin .sa-danger{border-color:#d87171;color:#b12c2c}
  #neisSuperAdmin .sa-pill{font-size:11px;color:var(--muted)}
  </style>`;
  admin=function(){
    const html=previous.apply(this,arguments);
    if(!state?.isAdmin)return html;
    queueMicrotask(()=>{if(state.view==='admin')void refreshCapabilities()});
    return html+css+`<section id="neisSuperAdmin" hidden aria-label="Super Admin management">
      <h2>Super Admin &amp; Accounts</h2>
      <p>The main admin is permanently protected. Permanent deletion cannot be undone.</p>
      <div class="sa-toolbar"><input type="search" id="saSearch" placeholder="Search users" aria-label="Search users">
        <button id="saRefresh" type="button">Refresh</button></div>
      <div id="saUsers" aria-live="polite"></div>
    </section>`;
  };
  async function refreshCapabilities(){
    const root=document.getElementById('neisSuperAdmin');
    if(!root||typeof sb==='undefined'||!sb||!authUser)return;
    const seq=++nonce;
    try{
      const response=await sb.rpc('neis_admin_capabilities');
      if(response.error)throw response.error;
      if(seq!==nonce||!root.isConnected)return;
      capabilities=response.data;
      root.hidden=!Boolean(capabilities?.super_admin);
      if(!root.hidden)await listUsers();
    }catch{
      root.hidden=true;
      capabilities=null;
    }
  }
  async function listUsers(){
    const root=document.getElementById('neisSuperAdmin');
    if(!root||root.hidden||!capabilities?.super_admin)return;
    const host=root.querySelector('#saUsers');
    host.textContent='Loading…';
    const result=await sb.rpc('neis_admin_users',{p_search:root.querySelector('#saSearch').value.trim().slice(0,80)});
    if(!root.isConnected||root.hidden)return;
    if(result.error){host.textContent='Cannot load users: '+result.error.message;return}
    host.replaceChildren();
    const users=Array.isArray(result.data)?result.data:[];
    if(!users.length){host.textContent='No accounts found.';return}
    for(const user of users){
      const row=document.createElement('div');row.className='sa-row';
      const person=document.createElement('div');person.className='sa-person';
      const name=document.createElement('strong');name.textContent=user.full_name||user.username||'User';
      const label=document.createElement('small');
      label.textContent='@'+(user.username||'unknown')+' · '+(user.is_owner?'Main Admin':user.is_super?'Super Admin':user.role||'student');
      person.append(name,label);row.append(person);
      const actions=document.createElement('div');actions.className='sa-actions';
      if(user.is_owner){
        const badge=document.createElement('span');badge.className='sa-pill';badge.textContent='Protected account';actions.append(badge);
      }else{
        if(capabilities.owner){
          const promote=document.createElement('button');promote.type='button';
          promote.textContent=user.is_super?'Remove Super Admin':'Make Super Admin';
          promote.onclick=async()=>{
            if(!confirm((user.is_super?'Remove super admin from ':'Promote to super admin: ')+(user.full_name||user.username)+'?'))return;
            promote.disabled=true;
            const res=await sb.rpc('neis_admin_set_super',{p_user_id:user.user_id,p_enabled:!user.is_super});
            if(res.error){alert(res.error.message);promote.disabled=false;return}
            await listUsers();
          };
          actions.append(promote);
        }
        if(user.user_id!==authUser.id){
          const del=document.createElement('button');del.type='button';del.className='sa-danger';
          del.textContent='Delete permanently';
          del.onclick=async()=>{
            const expected='DELETE '+user.user_id;
            const confirmation=prompt('Permanently delete '+(user.full_name||user.username)+'? All related account data may be erased. This cannot be undone.\nType exactly:\n'+expected,'');
            if(confirmation!==expected)return;
            if(!confirm('Final confirmation: permanently delete this account?'))return;
            del.disabled=true;del.textContent='Deleting…';
            const res=await sb.rpc('neis_admin_delete_account',{p_user_id:user.user_id,p_confirmation:expected});
            if(res.error){alert('Deletion failed: '+res.error.message);del.disabled=false;del.textContent='Delete permanently';return}
            await listUsers();
          };
          actions.append(del);
        }
      }
      row.append(actions);host.append(row);
    }
  }
  let searchTimer;
  document.addEventListener('input',e=>{
    if(e.target?.id!=='saSearch')return;
    clearTimeout(searchTimer);searchTimer=setTimeout(listUsers,250);
  });
  document.addEventListener('click',e=>{if(e.target?.id==='saRefresh')void listUsers()});
})();
