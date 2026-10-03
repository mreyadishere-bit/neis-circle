/* NEIS Circle Secondary Data v173
   Resource-scoped loaders for non-core data.
   Prevents Articles/Gallery/Badges/Admin reports from riding every global refresh. */
(function(){
  'use strict';
  if(window.__neisSecondaryDataV173)return;
  window.__neisSecondaryDataV173=true;

  const PREFIX='neis-secondary-v173:';
  const memory=new Map();
  const inflight=new Map();
  const ttl={
    articles:3*60*1000,
    gallery:3*60*1000,
    badges:5*60*1000,
    reports:30*1000
  };

  const userKey=()=>String(window.authUser?.id||'guest');
  const cacheKey=name=>PREFIX+userKey()+':'+name;
  const cacheable=name=>name!=='reports';

  function readCache(name){
    if(!cacheable(name)||!window.authUser)return null;
    try{
      const raw=sessionStorage.getItem(cacheKey(name));
      if(!raw)return null;
      const parsed=JSON.parse(raw);
      if(!Array.isArray(parsed?.rows)||!Number(parsed?.savedAt))return null;
      const age=Math.max(0,Date.now()-Number(parsed.savedAt));
      return {rows:parsed.rows,savedAt:Number(parsed.savedAt),fresh:age<(ttl[name]||0)};
    }catch(_){return null}
  }
  function writeCache(name,rows){
    if(!cacheable(name)||!window.authUser||!Array.isArray(rows))return;
    try{sessionStorage.setItem(cacheKey(name),JSON.stringify({savedAt:Date.now(),rows}))}catch(_){}
  }
  function clearCache(name){
    try{
      if(name)sessionStorage.removeItem(cacheKey(name));
      else{
        for(let i=sessionStorage.length-1;i>=0;i--){
          const key=sessionStorage.key(i);
          if(key?.startsWith(PREFIX))sessionStorage.removeItem(key);
        }
      }
    }catch(_){}
  }
  function apply(name,rows){
    const data=Array.isArray(rows)?rows:[];
    if(name==='articles')state.articles=data;
    else if(name==='gallery')state.gallery=data;
    else if(name==='badges')state.profileBadges=data;
    else if(name==='reports')state.reports=data;
    memory.set(name,{loadedAt:Date.now(),userId:userKey()});
    if(cacheable(name))writeCache(name,data);
    return data;
  }
  function seed(name,rows){
    if(!Array.isArray(rows))return rows;
    return apply(name,rows);
  }
  function isFresh(name){
    const item=memory.get(name);
    return !!item&&item.userId===userKey()&&Date.now()-item.loadedAt<(ttl[name]||0);
  }
  async function request(name){
    if(name==='articles')return sb.from('articles').select('*,author:profiles!articles_author_id_fkey(full_name,username,grade,branch)').order('created_at',{ascending:false});
    if(name==='gallery')return sb.from('gallery_items').select('*,author:profiles!gallery_items_author_id_fkey(full_name,username,grade,branch)').order('created_at',{ascending:false});
    if(name==='badges')return sb.from('profile_badges').select('user_id,badge_key,awarded_at');
    if(name==='reports'){
      if(!state.isAdmin)return {data:[],error:null};
      return sb.rpc('admin_report_details');
    }
    return {data:[],error:new Error('unknown_secondary_resource')};
  }
  async function load(name,{force=false,useCache=true}={}){
    if(!sb||!authUser)return [];
    if(!force&&isFresh(name)){
      if(name==='articles')return state.articles||[];
      if(name==='gallery')return state.gallery||[];
      if(name==='badges')return state.profileBadges||[];
      if(name==='reports')return state.reports||[];
    }
    if(!force&&useCache){
      const cached=readCache(name);
      if(cached?.fresh){
        memory.set(name,{loadedAt:cached.savedAt,userId:userKey()});
        if(name==='articles')state.articles=cached.rows;
        else if(name==='gallery')state.gallery=cached.rows;
        else if(name==='badges')state.profileBadges=cached.rows;
        return cached.rows;
      }
    }
    if(inflight.has(name))return inflight.get(name);
    const promise=(async()=>{
      const result=await request(name);
      if(result?.error){
        console.warn('[NEIS secondary] '+name+' load failed',result.error);
        throw result.error;
      }
      return apply(name,result?.data||[]);
    })().finally(()=>inflight.delete(name));
    inflight.set(name,promise);
    return promise;
  }
  function invalidate(name){
    memory.delete(name);
    if(cacheable(name))clearCache(name);
  }
  async function ensureForView(view){
    const current=String(view||state.view||'');
    const tasks=[];
    if(current==='articles'||current==='home'||current==='messages')tasks.push('articles');
    if(current==='gallery'||current==='admin')tasks.push('gallery');
    if(current==='admin'&&!tasks.includes('articles'))tasks.push('articles');
    if(current==='profile-detail')tasks.push('badges');
    if(current==='admin')tasks.push('reports');
    if(!tasks.length)return;
    const before=current;
    let changed=false;
    await Promise.all(tasks.map(async name=>{
      const fresh=isFresh(name);
      try{await load(name);if(!fresh)changed=true}catch(_){}
    }));
    if(changed&&state.view===before&&typeof render==='function'){
      // Never force a Home rebuild for secondary data; active media must keep playing.
      if(before!=='home')render();
    }
  }
  function clearUser(){
    memory.clear();
    inflight.clear();
    clearCache();
  }

  window.NEISSecondaryData={
    version:'173.0',
    load,
    loadArticles:options=>load('articles',options),
    loadGallery:options=>load('gallery',options),
    loadBadges:options=>load('badges',options),
    loadReports:options=>load('reports',options),
    ensureForView,
    seed,
    invalidate,
    clearUser,
    isFresh
  };
})();