/* Search result portraits only. No changes to existing search, routes or content. */
(function(){
  'use strict';
  if(typeof avatar!=='function'||typeof state==='undefined')return;

  const profileCache=new Map();
  const authorCache=new Map();
  let cacheUser=String(authUser?.id||'');
  let lastHydratedSearch='';
  let latestRequestId=0;

  function forAccount(){
    const current=String(authUser?.id||'');
    if(current!==cacheUser){
      cacheUser=current;
      profileCache.clear();
      authorCache.clear();
      lastHydratedSearch='';
      latestRequestId=0;
    }
  }
  function localRecord(type,id){
    const source=type==='post'?state.posts:type==='article'?state.articles:type==='circle'?state.circleRows:type==='opportunity'?state.opportunities:null;
    return Array.isArray(source)?source.find(item=>String(item.id)===String(id)):null;
  }
  function profileForId(id){
    if(!id)return null;
    const direct=(Array.isArray(state.members)?state.members:[]).find(p=>String(p.id)===String(id));
    const loaded=profileCache.get(String(id));
    // Prefer a verified, more recent avatar when the member list is partial.
    return loaded?.avatar_url?{...direct,...loaded}:direct||loaded||null;
  }
  function authorId(item){
    if(item.type==='profile')return String(item.id);
    const local=localRecord(item.type,item.id);
    return String(item.author_id||item.owner_id||local?.author_id||local?.owner_id||authorCache.get(item.type+':'+item.id)||'');
  }
  function fallbackName(item,profile){
    if(profile?.full_name)return profile.full_name;
    if(item.type==='profile')return item.title||'Student';
    const local=localRecord(item.type,item.id);
    return local?.user||local?.author?.full_name||'Student';
  }
  function avatarMarkup(item){
    forAccount();
    const type=String(item?.type||'');
    if(type==='profile'||type==='post'||type==='article'||type==='circle'||type==='opportunity'){
      const id=authorId(item);
      const profile=profileForId(id);
      const name=fallbackName(item,profile);
      const person={...(profile||{}),id:id||undefined,full_name:name};
      if(type==='profile'&&!person.avatar_url&&item.avatar_url)person.avatar_url=item.avatar_url;
      return '<span class="search-result-avatar" aria-hidden="true">'+avatar({...person,name:person.full_name,initials:initials(person.full_name||'Student'),color:'#006f5b'})+'</span>';
    }
    const symbol=type==='circle'?'i-circles':type==='opportunity'?'i-graduation':'i-book';
    return '<span class="search-result-avatar search-result-avatar--symbol" aria-hidden="true"><svg viewBox="0 0 24 24"><use href="#'+symbol+'"></use></svg></span>';
  }

  function refreshVisible(){
    const items=Array.isArray(state.searchResults)?state.searchResults:[];
    if(!items.length)return;
    const matches=new Map(items.map(x=>[String(x.type)+':'+String(x.id),x]));
    document.querySelectorAll('#searchSuggestions [data-search-open], .search-results-list [data-search-open]').forEach(button=>{
      const item=matches.get(button.dataset.searchOpen+':'+button.dataset.searchId);
      const current=button.querySelector('.entity-icon, .search-result-avatar');
      if(item&&current)current.outerHTML=avatarMarkup(item);
    });
  }

  async function hydrateProfiles(items,requestId,userId){
    if(!sb||!items.length)return;
    const postIds=[],articleIds=[],circleIds=[],opportunityIds=[];
    for(const item of items){
      if(!['post','article','circle','opportunity'].includes(item.type))continue;
      const key=item.type+':'+item.id;
      if(item.author_id||item.owner_id||localRecord(item.type,item.id)?.author_id||localRecord(item.type,item.id)?.owner_id||authorCache.has(key))continue;
      if(item.type==='post')postIds.push(String(item.id));
      else if(item.type==='article')articleIds.push(String(item.id));
      else if(item.type==='circle')circleIds.push(String(item.id));
      else opportunityIds.push(String(item.id));
    }
    const tasks=[];
    if(postIds.length)tasks.push({type:'post',ids:postIds.slice(0,80),request:sb.from('posts').select('id,author_id').in('id',postIds.slice(0,80))});
    if(articleIds.length)tasks.push({type:'article',field:'author_id',ids:articleIds.slice(0,80),request:sb.from('articles').select('id,author_id').in('id',articleIds.slice(0,80))});
    if(circleIds.length)tasks.push({type:'circle',field:'owner_id',ids:circleIds.slice(0,80),request:sb.from('circles').select('id,owner_id').in('id',circleIds.slice(0,80))});
    if(opportunityIds.length)tasks.push({type:'opportunity',field:'author_id',ids:opportunityIds.slice(0,80),request:sb.from('opportunities').select('id,author_id').in('id',opportunityIds.slice(0,80))});
    if(tasks.length){
      const results=await Promise.allSettled(tasks.map(task=>task.request));
      if(requestId!==latestRequestId||String(authUser?.id||'')!==userId)return;
      results.forEach((result,index)=>{
        const task=tasks[index];
        if(result.status!=='fulfilled'||result.value?.error)return;
        const records=Array.isArray(result.value?.data)?result.value.data:[];
        const matched=new Map(records.map(row=>[String(row.id),String(row[task.field||'author_id']||'')]));
        task.ids.forEach(id=>authorCache.set(task.type+':'+id,matched.get(id)||''));
      });
    }
    if(requestId!==latestRequestId||String(authUser?.id||'')!==userId)return;
    const ids=new Set();
    for(const item of items){
      if(!['post','article','profile','circle','opportunity'].includes(item.type))continue;
      const id=authorId(item);
      if(!id||profileCache.has(id))continue;
      const member=(Array.isArray(state.members)?state.members:[]).find(p=>String(p.id)===id);
      if(member?.avatar_url)continue;
      ids.add(id);
    }
    if(!ids.size)return;
    const pending=[...ids].slice(0,80);
    try{
      const result=await sb.from('profiles').select('id,full_name,avatar_url').in('id',pending);
      if(requestId!==latestRequestId||String(authUser?.id||'')!==userId||result?.error)return;
      const returned=Array.isArray(result.data)?result.data:[];
      returned.forEach(p=>profileCache.set(String(p.id),p));
      pending.forEach(id=>{if(!profileCache.has(id))profileCache.set(id,{id})});
    }catch(_){
      // Search and profile navigation remain usable without avatar network access.
    }
  }

  function scheduleHydration(items,requestId){
    forAccount();
    if(!Array.isArray(items)||!items.length||!sb||!authUser)return;
    latestRequestId=requestId;
    const ticket=cacheUser+':'+requestId;
    if(lastHydratedSearch===ticket)return;
    lastHydratedSearch=ticket;
    const currentUser=cacheUser;
    void hydrateProfiles(items.slice(0,80),requestId,currentUser).then(()=>{
      if(requestId===latestRequestId&&String(authUser?.id||'')===currentUser)refreshVisible();
    }).catch(()=>{});
  }

  // The search functions are private to scripts/05-social.js's IIFE.
  // Expose only portrait rendering/hydration; the search module itself calls this bridge.
  window.NEISSearchAvatarUi={markup:avatarMarkup,hydrate:scheduleHydration,refresh:refreshVisible};
})();
