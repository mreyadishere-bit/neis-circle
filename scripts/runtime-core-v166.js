/* NEIS Circle v168 — stable Home recovery without request loops. */
(function(){
  'use strict';
  if(window.__neisStableHomeRecoveryV168)return;
  window.__neisStableHomeRecoveryV168=true;

  const safeArray=value=>Array.isArray(value)?value:[];
  const same=(a,b)=>String(a??'')===String(b??'');
  const timeout=(label,ms)=>new Promise((_,reject)=>setTimeout(()=>reject(new Error(label+'_timeout')),ms));
  let hydratePromise=null;
  let startupRetryUsed=false;
  let lastSuccessAt=0;

  async function safeQuery(label,request,ms=8000){
    try{
      const result=await Promise.race([request,timeout(label,ms)]);
      return result&&typeof result==='object'?result:{data:null,error:new Error(label+'_invalid_result')};
    }catch(error){
      console.error('[NEIS] '+label+' load failed',error);
      return {data:null,error};
    }
  }

  function applyCore(posts,profiles,comments,reactions,bookmarks,articles){
    const commentCounts={},reactionCounts={};
    if(!comments?.error)safeArray(comments?.data).forEach(row=>commentCounts[row.post_id]=(commentCounts[row.post_id]||0)+1);
    if(!reactions?.error)safeArray(reactions?.data).forEach(row=>reactionCounts[row.post_id]=(reactionCounts[row.post_id]||0)+1);

    if(!profiles?.error){
      const rows=safeArray(profiles.data);
      state.members=rows;
      const own=rows.find(row=>same(row.id,authUser?.id));
      if(own){
        if(!profiles.cached){
          state.isAdmin=own.role==='admin'||same(authUser?.id,typeof NEIS_ADMIN_ID!=='undefined'?NEIS_ADMIN_ID:'25b556a3-ec6f-49e7-ac6c-1b09720e3bfd');
          if(own.onboarding_complete===true)state.onboardingComplete=true;
        }
        state.profile={
          ...state.profile,
          name:own.full_name||authUser?.user_metadata?.full_name||state.profile?.name||'Student',
          username:own.username||'',
          grade:own.grade||'',
          branch:own.branch||'',
          campus:own.campus||own.branch||'',
          bio:own.bio||'',
          interests:Array.isArray(own.interests)?own.interests.join(', '):(own.interests||''),
          role:state.isAdmin?'admin':'student'
        };
        document.body.classList.toggle('is-admin',state.isAdmin);
      }
    }

    if(!posts?.error){
      const profileById=new Map(safeArray(state.members).map(p=>[String(p.id),p]));
      const previousById=new Map(safeArray(state.posts).map(p=>[String(p.id),p]));
      state.posts=safeArray(posts.data).map(row=>{
        const author=profileById.get(String(row.author_id))||{};
        const previous=previousById.get(String(row.id))||{};
        const name=author.full_name||previous.user||'NEIS Student';
        return {
          ...previous,
          id:row.id,author_id:row.author_id,circle_id:row.circle_id,pinned:!!row.pinned,
          post_type:row.post_type||'post',is_live:true,created_at:row.created_at,
          user:name,initials:typeof initials==='function'?initials(name):String(name).slice(0,2).toUpperCase(),
          color:previous.color||'#006f5b',
          meta:[...new Set([author.grade,author.branch,author.campus].filter(Boolean).map(v=>String(v).trim()))].join(' · ')||previous.meta||'NEIS Circle',
          time:typeof formatDate==='function'?formatDate(row.created_at):(previous.time||''),
          kind:row.kind||'Discussion',title:row.title||'',body:row.body||'',tags:safeArray(row.tags),
          image_url:row.image_url||'',image_urls:safeArray(row.image_urls).filter(Boolean),
          image_display_mode:row.image_display_mode==='fill'?'fill':'fit',
          link_button_label:row.link_button_label||'',link_button_url:row.link_button_url||'',
          youtube_url:row.youtube_url||'',
          likes:reactions?.error?(previous.likes||0):(reactionCounts[row.id]||0),
          comments:comments?.error?(previous.comments||0):(commentCounts[row.id]||0)
        };
      });
    }

    if(!reactions?.error){state.postReactionKeys=safeArray(reactions.data).map(row=>[row.post_id,row.user_id,row.reaction||'like'].map(String).join('|'));state.liked=safeArray(reactions.data).filter(row=>same(row.user_id,authUser?.id)).map(row=>row.post_id)}
    if(!bookmarks?.error)state.saved=safeArray(bookmarks.data).map(row=>row.post_id);
    if(!articles?.error)state.articles=safeArray(articles.data);
    state.platformReady=!posts?.error&&!profiles?.error;
    try{save()}catch(error){console.warn('[NEIS] cache save skipped',error)}
  }

  function renderHomeFallback(error){
    console.error('[NEIS] Home render fallback activated',error);
    window.__neisLastRenderError=String(error?.stack||error?.message||error||'unknown');
    const view=document.querySelector('#view');
    if(!view)return;
    const posts=safeArray(state.posts).filter(post=>!post?.circle_id);
    const members=safeArray(state.members);
    const card=post=>{
      try{return typeof postCard==='function'?postCard(post):''}
      catch(cardError){
        console.error('[NEIS] post card fallback',cardError,post);
        return '<article class="post" data-post="'+esc(post?.id||'')+'"><div class="post-top"><div class="post-person"><b>'+esc(post?.user||'NEIS Student')+'</b><small>'+esc(post?.meta||'NEIS Circle')+'</small></div></div><h3>'+esc(post?.title||'')+'</h3><p dir="auto">'+esc(post?.body||'')+'</p></article>';
      }
    };
    view.innerHTML='<section class="hero"><div class="hero-main"><p class="kicker"><i></i>Welcome back, '+esc(state.profile?.name||'Student')+'.</p><h1>Learn together. Build what matters.</h1><p>Your feed is connected to people you follow and Circles you joined.</p><div style="display:flex;gap:8px;margin-top:20px"><button class="primary" data-nav="circles">Explore Circles</button><button class="secondary" data-nav="connections">Your connections</button></div></div><div class="hero-side"><div class="pulse"><div><strong>'+members.length+'</strong><small>real profiles</small></div><span class="pulse-orb"></span></div><div class="profile-meter"><div class="meter-row"><b>Your identity</b><strong>'+esc(state.profile?.grade||'Student')+'</strong></div><small>'+esc(state.profile?.branch||'Add your branch')+'</small><div class="bar"><i style="width:'+(state.profile?.branch?'100':'55')+'%"></i></div></div></div></section><div class="dashboard"><div class="main-column"><div class="composer-bar"><button data-action="compose">Share something useful…</button><button class="compose" data-action="compose">+</button></div><div class="tabs"><button data-filter="For you">For you</button><button class="active" data-filter="Latest">Latest</button><button data-filter="Questions">Questions</button><button data-filter="Resources">Resources</button></div><div class="feed">'+(posts.length?posts.map(card).join(''):'<div class="empty"><b>No posts yet</b><span>Create the first meaningful post.</span></div>')+'</div></div><aside class="side-column"><section class="side-card"><h3>Suggested people</h3><div class="empty"><b>'+members.length+' profiles loaded</b><span>Open Discover to explore the network.</span></div></section></aside></div>';
    document.body.classList.add('app-ready');
    document.querySelectorAll('[data-nav]').forEach(button=>button.classList.toggle('active',button.dataset.nav==='home'));
    try{if(typeof bindDynamic==='function')bindDynamic()}catch(bindError){console.error('[NEIS] fallback bindDynamic',bindError)}
    try{if(typeof bindV6==='function')bindV6()}catch(bindError){console.error('[NEIS] fallback bindV6',bindError)}
    try{if(typeof syncChrome==='function')syncChrome()}catch(_){}
  }

  if(typeof render==='function'&&!window.__neisRenderGuardV168){
    window.__neisRenderGuardV168=true;
    const appRender=render;
    render=function(){
      try{return appRender()}
      catch(error){
        console.error('[NEIS] render failed',error);
        if(state?.view==='home'&&authUser&&state.onboardingComplete===true){
          renderHomeFallback(error);
          return;
        }
        throw error;
      }
    };
  }

  async function hydrate(options={}){
    if(hydratePromise)return hydratePromise;
    if(!options.force&&lastSuccessAt&&Date.now()-lastSuccessAt<15000)return true;
    hydratePromise=(async()=>{
      if(!sb&&typeof initSupabase==='function')await initSupabase();
      if(!sb)return false;
      const sessionResult=await safeQuery('session',sb.auth.getSession(),5000);
      const session=sessionResult.data?.session||null;
      if(sessionResult.error||!session)return false;
      authUser=session.user;

      const profileCache=window.NEISProfileCache?.read?.(authUser.id)||null;
      const canUseProfileCache=!!(
        profileCache?.fresh &&
        Array.isArray(profileCache.rows) &&
        profileCache.rows.length &&
        state.onboardingComplete===true
      );
      const profileRequest=canUseProfileCache
        ? Promise.resolve({data:profileCache.rows,error:null,cached:true})
        : safeQuery('profiles',sb.from('profiles').select('id,full_name,username,avatar_url,grade,branch,campus,bio,interests,role,onboarding_complete').order('full_name'),8000);

      const [posts,comments,reactions,bookmarks,profiles,articles]=await Promise.all([
        safeQuery('posts',sb.from('posts').select('id,kind,title,body,tags,image_url,image_urls,image_display_mode,link_button_label,link_button_url,youtube_url,created_at,author_id,circle_id,pinned,post_type').order('created_at',{ascending:false}),8000),
        safeQuery('comments',sb.from('comments').select('post_id').is('deleted_at',null),8000),
        safeQuery('reactions',sb.from('reactions').select('post_id,user_id,reaction'),8000),
        safeQuery('bookmarks',sb.from('bookmarks').select('post_id,user_id').eq('user_id',authUser.id),8000),
        profileRequest,
        safeQuery('articles',sb.from('articles').select('*,author:profiles!articles_author_id_fkey(full_name,username,grade,branch)').order('created_at',{ascending:false}),8000)
      ]);

      if(!profiles.error&&!profiles.cached&&Array.isArray(profiles.data)){
        window.NEISProfileCache?.write?.(authUser.id,profiles.data);
      }
      applyCore(posts,profiles,comments,reactions,bookmarks,articles);
      const criticalOk=!posts.error&&!profiles.error;
      if(criticalOk)lastSuccessAt=Date.now();
      if(state?.view==='home'&&typeof window.NEISPatchHomeRealtime==='function'){
        const patched=window.NEISPatchHomeRealtime();
        if(!patched&&typeof render==='function')render();
      }else if(typeof render==='function')render();
      return criticalOk;
    })().catch(error=>{
      console.error('[NEIS] recovery hydration failed',error);
      return false;
    }).finally(()=>{hydratePromise=null});
    return hydratePromise;
  }

  window.NEISHydrateCore=hydrate;

  if(typeof nav==='function'&&!window.__neisHomeNavGuardV168){
    window.__neisHomeNavGuardV168=true;
    const previousNav=nav;
    nav=function(view){
      const result=previousNav(view);
      if(view==='home'&&(!safeArray(state.posts).length||!safeArray(state.members).length)){
        setTimeout(()=>hydrate({force:true,reason:'home-nav'}),0);
      }
      return result;
    };
  }

  setTimeout(async()=>{
    const ok=await hydrate({force:true,reason:'startup'});
    if(!ok&&!startupRetryUsed){
      startupRetryUsed=true;
      setTimeout(()=>hydrate({force:true,reason:'startup-retry'}),1800);
    }
  },650);
})();