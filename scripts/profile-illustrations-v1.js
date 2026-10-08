/* NEIS Circle — approved illustrated profile avatars (CC0 styles only). */
(()=>{
 'use strict';
 const groups=[['Characters','lorelei'],['People','open-peeps'],['Creative','notionists'],['Sketches','notionists-neutral'],['Cats','cats'],['Creatures','critters'],...['Sports','Music','Science','Art','Reading','Gaming','Nature','Travel','Food','Technology'].map(x=>[x,'hobby'])];
 // Curated Twemoji artwork, graphics licensed CC BY 4.0.
 const hobbies={
 Sports:'26bd 1f3c0 1f3c8 1f3be 1f3d3 1f3bf 1f3b3 1f6b4 1f94a',
 Music:'1f3b5 1f3b6 1f3b8 1f3b9 1f3ba 1f3bb 1f941 1f3a7 1f399',
 Science:'1f52c 1f52d 1f9ea 1f9ec 1f9ed 1f4e1 1fa90 1fa7a 1f9f2',
 Art:'1f3a8 1f58c 1f58d 1f5bc 1f9f6 1f9f5 1f3ad 1f4f7 1f4d0',
 Reading:'1f4da 1f4d6 1f4d5 1f4d7 1f4d8 1f4d9 1f4dd 1f4dc 1f4d6',
 Gaming:'1f3ae 1f579 1f3af 1f9e9 265f 1f0cf 1f3b2 1f3b0 1f3c6',
 Nature:'1f33f 1f340 1f33b 1f337 1f335 1f333 1f334 1f98b 1f41d',
 Travel:'1f30d 1f5fa 1f9ed 1f680 1f6f8 1f6eb 1f6a2 1f3d4 1f3d6',
 Food:'1f355 1f354 1f35c 1f35e 1f34e 1f353 1f36a 1f950 1f9c1',
 Technology:'1f4bb 1f4f1 1f916 1f4bd 1f4e1 1f50b 1f5a8 1f4bf 1f579'
 };
 // Retain provider style and a deterministic seed in the persistent avatar URL.
 const url=(style,seed)=>style==='hobby'?'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/'+seed+'.svg':'https://api.dicebear.com/'+(style==='cats'?'11.x':'10.x')+'/'+style+'/svg?seed='+encodeURIComponent(seed);
 const authorized=u=>/^https:\/\/api\.dicebear\.com\/(?:10\.x\/(?:lorelei|open-peeps|notionists|notionists-neutral|critters|blobs|marbles|moods)|11\.x\/cats)\/svg\?seed=neis-[a-z]{3,24}-[0-9]{1,3}$/.test(String(u||''))||/^https:\/\/cdn\.jsdelivr\.net\/gh\/twitter\/twemoji@14\.0\.2\/assets\/svg\/[a-f0-9-]+\.svg$/.test(String(u||''));
 const escHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 // Show approved illustrations in every preexisting avatar location, without modifying identity records.
 const previousAvatar=avatar;
 avatar=function(person,large){
   const image=person?.avatar_url||((person?.author_id||person?.sender_id)&&Array.isArray(state?.members)?state.members.find(p=>String(p.id)===String(person.author_id||person.sender_id))?.avatar_url:null);
   if(authorized(image))return '<span class="avatar neis-illustrated-avatar '+(large?'large':'')+'"><img src="'+escHtml(image)+'" alt="" loading="lazy" decoding="async"></span>';
   return previousAvatar(person,large);
 };
 // Expose the picker in the actual Your profile edit dialog, not just the profile page.
 function addEditProfilePicker(){
   const form=document.getElementById('profileFormPlus');
   if(!form||form.querySelector('[data-edit-illustration]'))return;
   const actions=form.querySelector('.modal-actions');
   if(!actions)return;
   const section=document.createElement('div');
   section.className='neis-avatar-profile-field';
   section.innerHTML='<div><b>'+(state.lang==='ar'?'الصورة الرمزية':'Profile illustration')+'</b><small>'+(state.lang==='ar'?'اختر رسمة من مجموعتنا — بدون رفع صور':'Choose an illustration — no photo uploads')+'</small></div><button type="button" class="secondary" data-edit-illustration onclick="window.NEISIllustrations?.openPicker()">'+(state.lang==='ar'?'تصفح الرسومات':'Browse illustrations')+'</button>';
   actions.before(section);
 }
 const editDialogObserver=new MutationObserver(addEditProfilePicker);
 const dialogRoot=document.getElementById('modalRoot');
 if(dialogRoot)editDialogObserver.observe(dialogRoot,{childList:true,subtree:true});
 document.addEventListener('click',event=>{
   if(event.target.closest('[data-action="profile"]'))queueMicrotask(addEditProfilePicker);
 });
 queueMicrotask(addEditProfilePicker);
 // The initial picker selects from a limited approved palette; no arbitrary URLs or photos.
 let selected=null,filter='all',query='';
 function items(){
   const collection=[];
   groups.forEach(([category,style])=>{
     if(style==='hobby')hobbies[category].split(' ').forEach((seed,index)=>collection.push({category,style,seed,index:index+1}));
     else for(let i=1;i<=28;i++)collection.push({category,style,seed:'neis-'+style.replace(/-/g,'')+'-'+i,index:i});
   });
   return collection;
 }
 const all=items();
 const getCurrent=()=>state.members?.find(p=>String(p.id)===String(authUser?.id))?.avatar_url||'';
 function renderPicker(){
   const root=document.getElementById('neisIllustrationPicker');if(!root)return;
   root.querySelector('[data-avatar-preview]').src=selected?.url||(authorized(getCurrent())?getCurrent():url('lorelei','neis-lorelei-1'));
   const results=all.filter(x=>(filter==='all'||x.category===filter)&&(!query||(x.category+' '+x.style+' '+x.index).toLowerCase().includes(query)));
   root.querySelector('[data-avatar-grid]').innerHTML=results.map(x=>{
     const img=url(x.style,x.seed),active=selected?.url===img;
     return '<button type="button" class="neis-illustration-choice '+(active?'is-selected':'')+'" data-avatar-style="'+x.style+'" data-avatar-seed="'+x.seed+'" aria-label="'+escHtml(x.category+' illustration '+x.index)+'" aria-pressed="'+active+'"><img src="'+img+'" alt="" loading="lazy"><span class="neis-avatar-choice-tick">✓</span></button>';
   }).join('');
   root.querySelector('[data-avatar-save]').disabled=!selected;
 }
 function openPicker(){
   if(document.getElementById('neisIllustrationPicker'))return;
   selected=null;filter='all';query='';
   const modal=document.createElement('div');modal.id='neisIllustrationPicker';modal.className='neis-avatar-layer';modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');
   modal.setAttribute('aria-label','Choose a profile illustration');
   modal.innerHTML='<div class="neis-avatar-dialog"><header class="neis-avatar-head"><div><small>YOUR PROFILE</small><h2>'+(state.lang==='ar'?'اختر صورة رمزية':'Choose an illustration')+'</h2><p>'+(state.lang==='ar'?'صور رمزية فقط — دون رفع صور شخصية':'Illustrations only — no personal photo uploads')+'</p></div><button type="button" data-avatar-close aria-label="Close">×</button></header><div class="neis-avatar-preview"><img data-avatar-preview alt="Selected illustration preview"><div><b>'+(state.lang==='ar'?'صورتك الرمزية':'Your profile illustration')+'</b><span>'+(state.lang==='ar'?'اختر من المجموعة أدناه':'Pick your favorite from the gallery')+'</span></div></div><div class="neis-avatar-filters"><input type="search" data-avatar-search placeholder="Search illustrations…" aria-label="Search illustrations"><div data-avatar-categories class="neis-avatar-categories"></div></div><div class="neis-avatar-scroll"><div data-avatar-grid class="neis-avatar-grid"></div></div><footer class="neis-avatar-footer"><small>DiceBear (CC0) · Twemoji graphics (CC BY 4.0) · © Twitter</small><button type="button" class="primary" data-avatar-save disabled>Save illustration</button></footer></div>';
   document.body.appendChild(modal);
   modal.querySelector('[data-avatar-categories]').innerHTML=[['All','all'],...groups.map(g=>[g[0],g[0]])].map(([label,value])=>'<button type="button" data-avatar-category="'+value+'" class="'+(value==='all'?'active':'')+'">'+label+'</button>').join('');
   renderPicker();
   modal.querySelector('[data-avatar-search]').focus();
 }
 window.NEISIllustrations={openPicker};
 document.addEventListener('click',async e=>{
   if(e.target.closest('[data-edit-illustration]')){openPicker();return}
   const root=e.target.closest('#neisIllustrationPicker');if(!root)return;
   if(e.target.closest('[data-avatar-close]')||e.target===root){root.remove();return}
   const cat=e.target.closest('[data-avatar-category]');if(cat){filter=cat.dataset.avatarCategory;root.querySelectorAll('[data-avatar-category]').forEach(x=>x.classList.toggle('active',x===cat));renderPicker();return}
   const choice=e.target.closest('[data-avatar-seed]');if(choice){selected={style:choice.dataset.avatarStyle,seed:choice.dataset.avatarSeed,url:url(choice.dataset.avatarStyle,choice.dataset.avatarSeed)};renderPicker();return}
   const save=e.target.closest('[data-avatar-save]');if(!save||!selected||save.disabled)return;
   save.disabled=true;save.textContent='Saving…';
   try{
     const {data,error}=await sb.rpc('set_illustrated_profile_avatar',{p_style:selected.style,p_seed:selected.seed});
     if(error)throw error;
     const p=state.members?.find(x=>String(x.id)===String(authUser.id));if(p)p.avatar_url=data;
     if(state.profile)state.profile.avatar_url=data;
     try{window.NEISProfileCache?.clear?.(authUser.id)}catch(_){}
     root.remove();render();
     if(typeof toast==='function')toast('Profile illustration updated.');
   }catch(err){save.disabled=false;save.textContent='Save illustration';if(typeof toast==='function')toast(err.message||'Could not save illustration.')}
 });
 document.addEventListener('input',e=>{if(!e.target.matches?.('#neisIllustrationPicker [data-avatar-search]'))return;query=e.target.value.trim().toLowerCase();renderPicker()});
 document.addEventListener('keydown',e=>{if(e.key==='Escape')document.getElementById('neisIllustrationPicker')?.remove()});
})();
