/* NEIS Circle v166 — canonical core hydration.
   One idempotent startup pass after all feature layers are loaded.
   It never intercepts clicks and never replaces feature-specific handlers. */
(function(){
  'use strict';
  if(window.__neisCanonicalCoreHydrationInstalled)return;
  window.__neisCanonicalCoreHydrationInstalled=true;

  const MAIN_ADMIN_ID='25b556a3-ec6f-49e7-ac6c-1b09720e3bfd';
  let running=false,complete=false;

  const safeArray=value=>Array.isArray(value)?value:[];
  const same=(a,b)=>String(a||'')===String(b||'');

  function applyProfile(p,user){
    if(!p)return;
    state.isAdmin=p.role==='admin'||same(user?.id,MAIN_ADMIN_ID);
    state.onboardingComplete=p.onboarding_complete===true;
    state.profile={
      ...state.profile,
      name:p.full_name||user?.user_metadata?.full_name||state.profile?.name||'Student',
      username:p.username||'',
      grade:p.grade||'',
      branch:p.branch||'',
      campus:p.campus||'',
      bio:p.bio||'',
      interests:Array.isArray(p.interests)?p.interests.join(', '):(p.interests||''),
      role:state.isAdmin?'admin':'student'
    };
    document.body.classList.toggle('is-admin',state.isAdmin);
  }

  function applyPosts(rows,commentRows,reactionRows,bookmarkRows,user){
    const cc={},rc={};
    safeArray(commentRows).forEach(x=>cc[x.post_id]=(cc[x.post_id]||0)+1);
    safeArray(reactionRows).forEach(x=>rc[x.post_id]=(rc[x.post_id]||0)+1);
    state.posts=safeArray(rows).map(p=>{
      const author=p.profiles||p.profile||{};
      const name=author.full_name||'NEIS Student';
      return {
        id:p.id,
        author_id:p.author_id,
        circle_id:p.circle_id,
        pinned:!!p.pinned,
        post_type:p.post_type||'post',
        is_live:true,
        created_at:p.created_at,
        user:name,
        initials:typeof initials==='function'?initials(name):String(name).split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase(),
        color:'#006f5b',
        meta:[...new Set([author.grade,author.branch,author.campus].filter(Boolean).map(v=>String(v).trim()))].join(' · ')||'NEIS Circle',
        time:typeof formatDate==='function'?formatDate(p.created_at):'',
        kind:p.kind,
        title:p.title||'',
        body:p.body||'',
        tags:safeArray(p.tags),
        image_url:p.image_url||'',
        image_urls:safeArray(p.image_urls).filter(Boolean),
        image_display_mode:p.image_display_mode==='fill'?'fill':'fit',
        link_button_label:p.link_button_label||'',
        link_button_url:p.link_button_url||'',
        youtube_url:p.youtube_url||'',
        likes:rc[p.id]||0,
        comments:cc[p.id]||0
      };
    });
    state.liked=safeArray(reactionRows).filter(x=>same(x.user_id,user.id)).map(x=>x.post_id);
    state.saved=safeArray(bookmarkRows).map(x=>x.post_id);
  }

  async function hydrate(){
    if(running||complete)return;
    running=true;
    try{
      if(!sb&&typeof initSupabase==='function')await initSupabase();
      if(!sb)return;

      const sessionRes=await sb.auth.getSession();
      if(sessionRes.error)throw sessionRes.error;
      const session=sessionRes.data?.session||null;
      if(!session)return;
      authUser=session.user;

      const [profileRes,postRes,commentRes,reactionRes,bookmarkRes,memberRes,articleRes,circleRes]=await Promise.all([
        sb.from('profiles').select('full_name,username,grade,branch,campus,bio,interests,role,onboarding_complete').eq('id',authUser.id).maybeSingle(),
        sb.from('posts').select('id,kind,title,body,tags,image_url,image_urls,image_display_mode,link_button_label,link_button_url,youtube_url,created_at,author_id,circle_id,pinned,post_type,profiles!posts_author_id_fkey(full_name,grade,branch,campus)').order('created_at',{ascending:false}),
        sb.from('comments').select('post_id').is('deleted_at',null),
        sb.from('reactions').select('post_id,user_id'),
        sb.from('bookmarks').select('post_id,user_id').eq('user_id',authUser.id),
        sb.from('profiles').select('id,full_name,username,grade,branch,bio,interests,role').order('full_name'),
        sb.from('articles').select('*,author:profiles!articles_author_id_fkey(full_name,username,grade,branch)').order('created_at',{ascending:false}),
        sb.from('circles').select('*').order('created_at',{ascending:false})
      ]);

      if(profileRes.error)throw profileRes.error;
      if(postRes.error)throw postRes.error;
      applyProfile(profileRes.data,authUser);
      applyPosts(postRes.data,commentRes.data,reactionRes.data,bookmarkRes.data,authUser);

      if(!memberRes.error)state.members=safeArray(memberRes.data);
      if(!articleRes.error)state.articles=safeArray(articleRes.data);
      if(!circleRes.error)state.circleRows=safeArray(circleRes.data);
      state.platformReady=true;

      if(state.view==='home'){
        const input=document.querySelector('#globalSearch');
        if(input&&!String(input.value||'').trim())state.query='';
        if(!['For you','Latest','Questions','Resources'].includes(state.filter))state.filter='Latest';
      }

      try{save()}catch(error){console.warn('[NEIS] local cache save skipped',error)}
      complete=true;

      if(typeof render==='function')render();

      // Let the full feature loader finish once in the background.
      setTimeout(async()=>{
        try{
          if(typeof loadLiveData==='function'){
            await Promise.race([
              loadLiveData(),
              new Promise((_,reject)=>setTimeout(()=>reject(new Error('extended_load_timeout')),15000))
            ]);
            if(typeof render==='function')render();
          }
        }catch(error){
          console.warn('[NEIS] extended feature hydration skipped',error);
        }
      },0);
    }catch(error){
      console.error('[NEIS] canonical core hydration failed',error);
    }finally{
      running=false;
    }
  }

  window.NEISHydrateCore=hydrate;
  setTimeout(hydrate,0);
  window.addEventListener('focus',()=>{if(!complete)hydrate()},{once:true});
})();