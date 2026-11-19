/* Search result portraits only. No changes to existing search, routes or content. */
(function(){
  'use strict';
  if(typeof searchRow!=='function'||typeof renderSuggestions!=='function'||typeof profileAvatar!=='function')return;

  const profileCache=new Map();
  const authorCache=new Map();
  let cacheUser=String(authUser?.id||'');
  let lastHydratedSearch='';

  function forAccount(){
    const current=String(authUser?.id||'');
    if(current!==cacheUser){
      cacheUser=current;
      profileCache.clear();
      authorCache.clear();
      lastHydratedSearch='';
    }
  }
  function localRecord(type,id){
    const source=type==='post'?state.posts:type==='article'?state.articles:type==='circle'?state.circleRows:null;
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
    return String(item.author_id||local?.author_id||authorCache.get(item.type+':'+item.id)||'');
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
    if(type==='profile'||type==='post'||type==='article'){
      const id=authorId(item);
      const profile=profileForId(id);
      const name=fallbackName(item,profile);
      const person={...(profile||{}),id:id||undefined,full_name:name};
      if(type==='profile'&&!person.avatar_url&&item.avatar_url)person.avatar_url=item.avatar_url;
      return '<span class="search-result-avatar" aria-hidden="true">'+profileAvatar(person)+'</span>';
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
    const postIds=[],articleIds=[];
    for(const item of items){
      if(item.type!=='post'&&item.type!=='article')continue;
      const key=item.type+':'+item.id;
      if(item.author_id||localRecord(item.type,item.id)?.author_id||authorCache.has(key))continue;
      if(item.type==='post')postIds.push(String(item.id));
      else articleIds.push(String(item.id));
    }
    const tasks=[];
    if(postIds.length)tasks.push({type:'post',ids:postIds.slice(0,80),request:sb.from('posts').select('id,author_id').in('id',postIds.slice(0,80))});
    if(articleIds.length)tasks.push({type:'article',ids:articleIds.slice(0,80),request:sb.from('articles').select('id,author_id').in('id',articleIds.slice(0,80))});
    if(tasks.length){
      const results=await Promise.allSettled(tasks.map(task=>task.request));
      if(requestId!==searchRequestId||String(authUser?.id||'')!==userId)return;
      results.forEach((result,index)=>{
        const task=tasks[index];
        if(result.status!=='fulfilled'||result.value?.error)return;
        const records=Array.isArray(result.value?.data)?result.value.data:[];
        const matched=new Map(records.map(row=>[String(row.id),String(row.author_id||'')]));
        task.ids.forEach(id=>authorCache.set(task.type+':'+id,matched.get(id)||''));
      });
    }
    if(requestId!==searchRequestId||String(authUser?.id||'')!==userId)return;
    const ids=new Set();
    for(const item of items){
      if(item.type!=='post'&&item.type!=='article'&&item.type!=='profile')continue;
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
      if(requestId!==searchRequestId||String(authUser?.id||'')!==userId||result?.error)return;
      const returned=Array.isArray(result.data)?result.data:[];
      returned.forEach(p=>profileCache.set(String(p.id),p));
      pending.forEach(id=>{if(!profileCache.has(id))profileCache.set(id,{id})});
    }catch(_){
      // Search and profile navigation remain usable without avatar network access.
    }
  }

  function scheduleHydration(){
    forAccount();
    if(state.searchLoading||!Array.isArray(state.searchResults)||!state.searchResults.length)return;
    const ticket=cacheUser+':'+searchRequestId;
    if(lastHydratedSearch===ticket)return;
    lastHydratedSearch=ticket;
    const currentUser=cacheUser,requestId=searchRequestId;
    void hydrateProfiles(state.searchResults.slice(0,80),requestId,currentUser).then(()=>{
      if(requestId===searchRequestId&&String(authUser?.id||'')===currentUser)refreshVisible();
    }).catch(()=>{});
  }

  const originalSearchRow=searchRow;
  searchRow=function(item){
    return originalSearchRow(item).replace(/<span class="entity-icon">[^<]*<\/span>/,avatarMarkup(item));
  };
  const originalSuggestions=renderSuggestions;
  renderSuggestions=function(){
    const result=originalSuggestions();
    refreshVisible();
    scheduleHydration();
    return result;
  };
  window.NEISSearchAvatarUi={refresh:refreshVisible};
})();
