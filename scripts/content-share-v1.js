/* Unified content sharing: Articles/Posts -> DMs or Circle chats. */
(function(){
  'use strict';
  if(window.__neisContentShareV1)return;
  window.__neisContentShareV1=true;
  const text=(en,ar)=>typeof t==='function'?t(en,ar):(state&&state.lang==='ar'?ar:en);
  const eq=(a,b)=>String(a==null?'':a)===String(b==null?'':b);

  function connectionRows(query){
    query=query||''; const me=authUser&&authUser.id,ids=new Set();
    (state.follows||[]).filter(f=>f.status==='accepted').forEach(f=>{
      if(eq(f.follower_id,me)&&!eq(f.following_id,me))ids.add(String(f.following_id));
      if(eq(f.following_id,me)&&!eq(f.follower_id,me))ids.add(String(f.follower_id));
    });
    const q=String(query).trim().toLocaleLowerCase(state.lang==='ar'?'ar':'en');
    return (state.members||[]).filter(p=>ids.has(String(p.id))&&!eq(p.id,me))
      .filter(p=>!q||[p.full_name,p.username,p.grade,p.branch].some(v=>String(v||'').toLocaleLowerCase(state.lang==='ar'?'ar':'en').includes(q)))
      .sort((a,b)=>String(a.full_name||'').localeCompare(String(b.full_name||''),state.lang==='ar'?'ar':'en'));
  }

  function circleRows(query){
    query=query||''; const me=authUser&&authUser.id;
    const joined=new Set((state.circleMembers||[]).filter(m=>eq(m.user_id,me)&&m.status==='active').map(m=>String(m.circle_id)));
    (state.circleRows||[]).forEach(c=>{if(eq(c.owner_id,me))joined.add(String(c.id));});
    const q=String(query).trim().toLocaleLowerCase(state.lang==='ar'?'ar':'en');
    return (state.circleRows||[]).filter(c=>joined.has(String(c.id)))
      .filter(c=>!q||[c.name,c.description,c.category].some(v=>String(v||'').toLocaleLowerCase(state.lang==='ar'?'ar':'en').includes(q)))
      .sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),state.lang==='ar'?'ar':'en'));
  }

  function personRow(person,selected){
    const name=person.full_name||text('NEIS Student','طالب NEIS');
    const initials=String(name).split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase();
    return '<button type="button" class="article-share-person '+(selected?'selected':'')+'" data-content-share-person="'+esc(String(person.id))+'" aria-pressed="'+(selected?'true':'false')+'"><span class="article-share-avatar">'+esc(initials||'NC')+'</span><span><b>'+esc(name)+'</b><small>@'+esc(person.username||'student')+(person.branch?' · '+esc(person.branch):'')+'</small></span><i>'+(selected?'✓':'')+'</i></button>';
  }

  function circleRow(circle,selected){
    const initials=String(circle.name||'NC').split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase();
    return '<button type="button" class="article-share-person content-share-circle '+(selected?'selected':'')+'" data-content-share-circle="'+esc(String(circle.id))+'" aria-pressed="'+(selected?'true':'false')+'"><span class="article-share-avatar">'+esc(initials||'NC')+'</span><span><b>'+esc(circle.name||text('Circle','مجتمع'))+'</b><small>'+esc(circle.category||text('Student Circle','مجتمع طلابي'))+'</small></span><i>'+(selected?'✓':'')+'</i></button>';
  }

  async function copyLink(type,id){
    const route=type==='article'?'articles/'+id:'post/'+id;
    const url=location.origin+location.pathname+'#/'+route;
    if(navigator.clipboard&&navigator.clipboard.writeText)await navigator.clipboard.writeText(url);
    else{const area=document.createElement('textarea');area.value=url;area.setAttribute('readonly','');area.style.position='fixed';area.style.opacity='0';document.body.appendChild(area);area.select();document.execCommand('copy');area.remove();}
  }

  async function sendToDm(userId,item){
    const started=await sb.rpc('start_direct_conversation',{target_user:userId});
    if(started.error||!started.data)return {ok:false,error:started.error};
    const conversationId=started.data; await sb.rpc('restore_own_conversation',{conversation_id_input:conversationId});
    const payload={conversation_id:conversationId,sender_id:authUser.id,body:item.type==='article'?text('📖 Shared an article','📖 تمت مشاركة مقال'):text('📝 Shared a post','📝 تمت مشاركة منشور')};
    if(item.type==='article')payload.shared_article_id=item.id; else payload.shared_post_id=item.id;
    const result=await sb.from('messages').insert(payload); return {ok:!result.error,error:result.error};
  }

  async function sendToCircle(circleId,item){
    const payload={circle_id:circleId,sender_id:authUser.id,body:item.type==='article'?text('📖 Shared an article','📖 تمت مشاركة مقال'):text('📝 Shared a post','📝 تمت مشاركة منشور')};
    if(item.type==='article')payload.shared_article_id=item.id; else payload.shared_post_id=item.id;
    const result=await sb.from('circle_messages').insert(payload); return {ok:!result.error,error:result.error};
  }

  function open(item){
    if(!authUser||!sb)return;
    const old=document.querySelector('#contentShareOverlay'); if(old)old.remove();
    const peopleSelected=new Set(),circleSelected=new Set(); let tab='dm';
    const overlay=document.createElement('div'); overlay.id='contentShareOverlay'; overlay.className='article-connection-share-overlay';
    overlay.innerHTML='<section class="article-connection-share-sheet content-share-sheet" role="dialog" aria-modal="true"><header><div><h2>'+(item.type==='article'?text('Share article','مشاركة المقال'):text('Share post','مشاركة المنشور'))+'</h2><p>'+esc(item.title||'')+'</p></div><button type="button" class="close" data-content-share-close>×</button></header><div class="content-share-tabs"><button type="button" class="active" data-content-share-tab="dm">'+text('DMs','الرسائل الخاصة')+'</button><button type="button" data-content-share-tab="circle">'+text('Circles','المجتمعات')+'</button></div><label class="article-share-search"><input id="contentShareSearch" autocomplete="off"></label><div id="contentShareList" class="article-share-people"></div><footer><button type="button" class="secondary" data-content-copy-link>'+text('Copy link','نسخ الرابط')+'</button><button type="button" class="primary" id="sendSharedContent" disabled>'+text('Send','إرسال')+' <b id="contentShareSelectedCount">0</b></button></footer></section>';
    document.body.appendChild(overlay);
    const list=overlay.querySelector('#contentShareList'),search=overlay.querySelector('#contentShareSearch'),send=overlay.querySelector('#sendSharedContent'),count=overlay.querySelector('#contentShareSelectedCount');
    const close=()=>overlay.remove(); const total=()=>peopleSelected.size+circleSelected.size; const sync=()=>{count.textContent=String(total());send.disabled=!total();};
    const render=()=>{
      if(tab==='dm'){const rows=connectionRows(search.value);search.placeholder=text('Search connections…','ابحث في العلاقات…');list.innerHTML=rows.length?rows.map(p=>personRow(p,peopleSelected.has(String(p.id)))).join(''):'<div class="empty"><b>'+text('No connections found','لا توجد علاقات')+'</b><span>'+text('Try another name.','جرّب اسمًا آخر.')+'</span></div>';}
      else{const rows=circleRows(search.value);search.placeholder=text('Search your Circles…','ابحث في مجتمعاتك…');list.innerHTML=rows.length?rows.map(c=>circleRow(c,circleSelected.has(String(c.id)))).join(''):'<div class="empty"><b>'+text('No joined Circles found','لا توجد مجتمعات منضم إليها')+'</b><span>'+text('Join a Circle first to share into its chat.','انضم إلى مجتمع أولًا للمشاركة في دردشته.')+'</span></div>';}
    };
    overlay.querySelectorAll('[data-content-share-close]').forEach(b=>b.onclick=close); overlay.addEventListener('click',e=>{if(e.target===overlay)close();});
    overlay.querySelectorAll('[data-content-share-tab]').forEach(button=>button.onclick=()=>{tab=button.dataset.contentShareTab;overlay.querySelectorAll('[data-content-share-tab]').forEach(x=>x.classList.toggle('active',x===button));search.value='';render();search.focus({preventScroll:true});});
    list.onclick=e=>{const p=e.target.closest('[data-content-share-person]'),c=e.target.closest('[data-content-share-circle]');if(p){const id=p.dataset.contentSharePerson;peopleSelected.has(id)?peopleSelected.delete(id):peopleSelected.add(id);render();sync();return;}if(c){const id=c.dataset.contentShareCircle;circleSelected.has(id)?circleSelected.delete(id):circleSelected.add(id);render();sync();}};
    search.oninput=render;
    overlay.querySelector('[data-content-copy-link]').onclick=async()=>{await copyLink(item.type,item.id);toast(item.type==='article'?text('Article link copied.','تم نسخ رابط المقال.'):text('Post link copied.','تم نسخ رابط المنشور.'));};
    send.onclick=async()=>{if(send.disabled||!total())return;send.disabled=true;let sent=0,failed=0,dmSent=0,circleSent=0;for(const id of peopleSelected){const r=await sendToDm(id,item);if(r.ok){sent++;dmSent++;}else failed++;}for(const id of circleSelected){const r=await sendToCircle(id,item);if(r.ok){sent++;circleSent++;}else failed++;}if(item.type==='article'&&sent){const methods=[];if(dmSent)methods.push('connections');if(circleSent)methods.push('circles');for(const method of methods){const tracked=await sb.from('article_shares').insert({article_id:item.id,user_id:authUser.id,method:method});if(tracked.error)console.warn('[NEIS content share tracking]',tracked.error);}}if(sent){close();toast(text('Shared to '+sent+' destination'+(sent===1?'':'s')+'.','تمت المشاركة إلى '+sent+' وجهة.'));}if(failed){toast(text(failed+' destination'+(failed===1?'':'s')+' could not receive it.','تعذر الإرسال إلى '+failed+' وجهة.'));send.disabled=false;}};
    render();sync();search.focus({preventScroll:true});
  }

  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-action="share"][data-id]'); if(!button)return;
    const post=(state.posts||[]).find(p=>eq(p.id,button.dataset.id)); if(!post)return;
    event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
    open({type:'post',id:post.id,title:post.title||text('Shared post','منشور مشارك')});
  },true);

  window.NEISContentShare={open:open};
})();