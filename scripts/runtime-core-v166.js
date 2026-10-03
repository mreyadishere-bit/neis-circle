/* NEIS Circle v167 — resilient canonical core hydration.
   Critical home/profile data loads independently so one failing request cannot empty the app.
   Home navigation also forces a lightweight recovery pass. */
(function(){
  'use strict';
  if(window.__neisCanonicalCoreHydrationV167Installed)return;
  window.__neisCanonicalCoreHydrationV167Installed=true;

  const FALLBACK_MAIN_ADMIN_ID='25b556a3-ec6f-49e7-ac6c-1b09720e3bfd';
  const safeArray=value=>Array.isArray(value)?value:[];
  const same=(a,b)=>String(a??'')===String(b??'');
  const currentAdminId=()=>typeof NEIS_ADMIN_ID!=='undefined'?NEIS_ADMIN_ID:FALLBACK_MAIN_ADMIN_ID;
  const timeout=(label,ms)=>new Promise((_,reject)=>setTimeout(()=>reject(new Error(label+'_timeout')),ms));

  let running=null;
  let retryTimer=null;
  let bootRetryCount=0;
  let lastCoreSuccessAt=0;
  let fullHydrationQueued=false;

  function logQueryError(label,result){
    if(result?.error)console.error(`[NEIS] ${label} load failed`,result.error);
  }

  async function safeQuery(label,promise,ms=8000){
    try{
      const result=await Promise.race([promise,timeout(label,ms)]);
      return result&&typeof result==='object'?result:{data:null,error:new Error(label+'_invalid_result')};
    }catch(error){
      console.error(`[NEIS] ${label} load failed`,error);
      return {data:null,error};
    }
  }

  function applyProfile(profile,user){
    if(!profile)return;
    const isMainAdmin=same(user?.id,currentAdminId());
    state.isAdmin=profile.role==='admin'||isMainAdmin;
    if(profile.onboarding_complete===true)state.onboardingComplete=true;
    state.profile={
      ...state.profile,
      name:profile.full_name||user?.user_metadata?.full_name||state.profile?.name||'Student',
      username:profile.username||'',
      grade:profile.grade||'',
      branch:profile.branch||'',
      campus:profile.campus||profile.branch||'',
      bio:profile.bio||'',
      interests:Array.isArray(profile.interests)?profile.interests.join(', '):(profile.interests||''),
      role:state.isAdmin?'admin':'student'
    };
    document.body.classList.toggle('is-admin',state.isAdmin);
  }

  function memberMap(rows){
    return new Map(safeArray(rows).map(profile=>[String(profile.id),profile]));
  }

  function applyPosts(rows,profiles,commentResult,reactionResult,bookmarkResult,user){
    const comments={},reactions={};
    if(!commentResult?.error)safeArray(commentResult?.data).forEach(row=>{comments[row.post_id]=(comments[row.post_id]||0)+1});
    if(!reactionResult?.error)safeArray(reactionResult?.data).forEach(row=>{reactions[row.post_id]=(reactions[row.post_id]||0)+1});

    const profileById=memberMap(profiles);
    const previousById=new Map(safeArray(state.posts).map(post=>[String(post.id),post]));

    state.posts=safeArray(rows).map(post=>{
      const author=profileById.get(String(post.author_id))||{};
      const previous=previousById.get(String(post.id))||{};
      const name=author.full_name||previous.user||'NEIS Student';
      return {
        ...previous,
        id:post.id,
        author_id:post.author_id,
        circle_id:post.circle_id,
        pinned:!!post.pinned,
        post_type:post.post_type||'post',
        is_live:true,
        created_at:post.created_at,
        user:name,
        initials:typeof initials==='function'?initials(name):String(name).split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase(),
        color:previous.color||'#006f5b',
        meta:[...new Set([author.grade,author.branch,author.campus].filter(Boolean).map(value=>String(value).trim()))].join(' · ')||previous.meta||'NEIS Circle',
        time:typeof formatDate==='function'?formatDate(post.created_at):(previous.time||''),
        kind:post.kind,
        title:post.title||'',
        body:post.body||'',
        tags:safeArray(post.tags),
        image_url:post.image_url||'',
        image_urls:safeArray(post.image_urls).filter(Boolean),
        image_display_mode:post.image_display_mode==='fill'?'fill':'fit',
        link_button_label:post.link_button_label||'',
        link_button_url:post.link_button_url||'',
        youtube_url:post.youtube_url||'',
        likes:reactionResult?.error?(previous.likes||0):(reactions[post.id]||0),
        comments:commentResult?.error?(previous.comments||0):(comments[post.id]||0)
      };
    });

    if(!reactionResult?.error){
      state.liked=safeArray(reactionResult.data).filter(row=>same(row.user_id,user.id)).map(row=>row.post_id);
    }
    if(!bookmarkResult?.error){
      state.saved=safeArray(bookmarkResult.data).map(row=>row.post_id);
    }
  }

  function scheduleRetry(delay=900){
    clearTimeout(retryTimer);
    retryTimer=setTimeout(()=>hydrate({force:true,reason:'retry'}),delay);
  }

  function queueFullHydration(){
    if(fullHydrationQueued)return;
    fullHydrationQueued=true;
    setTimeout(async()=>{
      try{
        if(!authUser||typeof loadLiveData!=='function')return;
        await Promise.race([loadLiveData(),timeout('extended_load',15000)]);
        if(typeof render==='function')render();
      }catch(error){
        console.warn('[NEIS] extended feature hydration skipped',error);
      }finally{
        fullHydrationQueued=false;
      }
    },120);
  }

  async function performHydration(reason){
    if(!sb&&typeof initSupabase==='function')await initSupabase();
    if(!sb){
      if(bootRetryCount++<4)scheduleRetry(700+bootRetryCount*500);
      return false;
    }

    const sessionResult=await safeQuery('session',sb.auth.getSession(),5000);
    if(sessionResult.error)return false;
    const session=sessionResult.data?.session||null;
    if(!session){
      if(bootRetryCount++<4)scheduleRetry(700+bootRetryCount*500);
      return false;
    }

    authUser=session.user;
    bootRetryCount=0;

    const [
      postResult,
      commentResult,
      reactionResult,
      bookmarkResult,
      memberResult,
      articleResult,
      circleResult
    ]=await Promise.all([
      safeQuery('posts',sb.from('posts')
        .select('id,kind,title,body,tags,image_url,image_urls,image_display_mode,link_button_label,link_button_url,youtube_url,created_at,author_id,circle_id,pinned,post_type')
        .order('created_at',{ascending:false}),9000),
      safeQuery('comments',sb.from('comments').select('post_id').is('deleted_at',null),8000),
      safeQuery('reactions',sb.from('reactions').select('post_id,user_id'),8000),
      safeQuery('bookmarks',sb.from('bookmarks').select('post_id,user_id').eq('user_id',authUser.id),8000),
      safeQuery('profiles',sb.from('profiles')
        .select('id,full_name,username,avatar_url,grade,branch,campus,bio,interests,role,onboarding_complete')
        .order('full_name'),9000),
      safeQuery('articles',sb.from('articles')
        .select('*,author:profiles!articles_author_id_fkey(full_name,username,grade,branch)')
        .order('created_at',{ascending:false}),9000),
      safeQuery('circles',sb.from('circles').select('*').order('created_at',{ascending:false}),9000)
    ]);

    [postResult,memberResult,commentResult,reactionResult,bookmarkResult,articleResult,circleResult]
      .forEach((result,index)=>logQueryError(['posts','profiles','comments','reactions','bookmarks','articles','circles'][index],result));

    let changed=false;
    let profilesForPosts=safeArray(state.members);

    if(!memberResult.error){
      const members=safeArray(memberResult.data);
      state.members=members;
      profilesForPosts=members;
      const ownProfile=members.find(profile=>same(profile.id,authUser.id));
      if(ownProfile)applyProfile(ownProfile,authUser);
      changed=true;
    }

    if(!postResult.error){
      applyPosts(postResult.data,profilesForPosts,commentResult,reactionResult,bookmarkResult,authUser);
      changed=true;
    }

    if(!articleResult.error){
      state.articles=safeArray(articleResult.data);
      changed=true;
    }
    if(!circleResult.error){
      state.circleRows=safeArray(circleResult.data);
      changed=true;
    }

    const criticalReady=!postResult.error&&!memberResult.error;
    if(criticalReady){
      state.platformReady=true;
      lastCoreSuccessAt=Date.now();
    }else{
      scheduleRetry(1400);
    }

    if(state.view==='home'){
      const input=document.querySelector('#globalSearch');
      if(input&&!String(input.value||'').trim())state.query='';
      if(!['For you','Latest','Questions','Resources'].includes(state.filter))state.filter='Latest';
    }

    if(changed){
      try{save()}catch(error){console.warn('[NEIS] local cache save skipped',error)}
      if(typeof render==='function')render();
    }

    if(criticalReady)queueFullHydration();
    return criticalReady;
  }

  function hydrate(options={}){
    const force=options===true||options?.force===true;
    if(running)return running;
    if(!force&&lastCoreSuccessAt&&Date.now()-lastCoreSuccessAt<5000)return Promise.resolve(true);
    running=performHydration(options?.reason||'manual')
      .catch(error=>{console.error('[NEIS] canonical core hydration failed',error);scheduleRetry(1400);return false})
      .finally(()=>{running=null});
    return running;
  }

  window.NEISHydrateCore=hydrate;

  if(typeof nav==='function'&&!window.__neisHomeNavRecoveryInstalled){
    window.__neisHomeNavRecoveryInstalled=true;
    const appNav=nav;
    nav=function(view){
      let result;
      try{result=appNav(view)}
      finally{
        if(view==='home')setTimeout(()=>hydrate({force:true,reason:'home-nav'}),0);
      }
      return result;
    };
  }

  setTimeout(()=>hydrate({force:true,reason:'startup'}),0);
  setTimeout(()=>hydrate({force:true,reason:'startup-retry'}),900);
  window.addEventListener('online',()=>hydrate({force:true,reason:'online'}));
  window.addEventListener('focus',()=>hydrate({reason:'focus'}));
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible')hydrate({reason:'visible'});
  });
})();