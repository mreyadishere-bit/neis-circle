/* NEIS Circle v165 — final runtime stability guard.
   Keeps authenticated data hydrated and prevents stale/empty legacy shells. */
(function(){
  'use strict';

  const MAIN_ADMIN_ID='25b556a3-ec6f-49e7-ac6c-1b09720e3bfd';
  let repairing=false,lastRepair=0;

  function same(a,b){return String(a||'')===String(b||'')}

  function mapPost(p,comments,reactions){
    const name=p.profiles?.full_name||'NEIS Student';
    return {
      id:p.id,author_id:p.author_id,circle_id:p.circle_id,pinned:!!p.pinned,
      post_type:p.post_type||'post',is_live:true,created_at:p.created_at,
      user:name,initials:(name||'ST').split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase(),
      color:'#006f5b',
      meta:[...new Set([p.profiles?.grade,p.profiles?.branch,p.profiles?.campus].filter(Boolean).map(v=>String(v).trim()))].join(' · ')||'NEIS Circle',
      time:typeof formatDate==='function'?formatDate(p.created_at):'',
      kind:p.kind,title:p.title,body:p.body,tags:p.tags||[],
      image_url:p.image_url||'',image_urls:Array.isArray(p.image_urls)?p.image_urls.filter(Boolean):[],
      image_display_mode:p.image_display_mode==='fill'?'fill':'fit',
      link_button_label:p.link_button_label||'',link_button_url:p.link_button_url||'',youtube_url:p.youtube_url||'',
      likes:reactions[p.id]||0,comments:comments[p.id]||0
    };
  }

  async function directHydrate(){
    if(!sb||!authUser)return false;
    const uid=authUser.id;
    const [postRes,commentRes,reactionRes,bookmarkRes,profileRes,memberRes,articleRes,circleRes]=await Promise.all([
      sb.from('posts').select('id,kind,title,body,tags,image_url,image_urls,image_display_mode,link_button_label,link_button_url,youtube_url,created_at,author_id,circle_id,pinned,post_type,profiles!posts_author_id_fkey(full_name,grade,branch,campus)').order('created_at',{ascending:false}),
      sb.from('comments').select('post_id').is('deleted_at',null),
      sb.from('reactions').select('post_id,user_id'),
      sb.from('bookmarks').select('post_id,user_id').eq('user_id',uid),
      sb.from('profiles').select('full_name,username,grade,branch,campus,bio,interests,role,onboarding_complete').eq('id',uid).maybeSingle(),
      sb.from('profiles').select('id,full_name,username,grade,branch,campus,bio,interests,role').order('full_name'),
      sb.from('articles').select('*,author:profiles!articles_author_id_fkey(full_name,username,grade,branch)').order('created_at',{ascending:false}),
      sb.from('circles').select('*').order('created_at',{ascending:false})
    ]);

    if(postRes.error||profileRes.error){
      console.error('[NEIS stability] core hydration failed',postRes.error||profileRes.error);
      return false;
    }

    const cc={},rc={};
    (commentRes.data||[]).forEach(x=>cc[x.post_id]=(cc[x.post_id]||0)+1);
    (reactionRes.data||[]).forEach(x=>rc[x.post_id]=(rc[x.post_id]||0)+1);

    const p=profileRes.data||{};
    state.isAdmin=p.role==='admin'||same(uid,MAIN_ADMIN_ID);
    state.onboardingComplete=p.onboarding_complete===true;
    if(state.onboardingComplete)window.NEISCacheOnboardingComplete?.();
    else window.NEISClearOnboardingComplete?.();
    state.profile={
      name:p.full_name||authUser.user_metadata?.full_name||'Student',
      username:p.username||'',
      grade:p.grade||'',
      branch:p.branch||'',
      campus:p.campus||'',
      bio:p.bio||'',
      interests:Array.isArray(p.interests)?p.interests.join(', '):(p.interests||''),
      role:state.isAdmin?'admin':'student'
    };
    state.posts=(postRes.data||[]).map(row=>mapPost(row,cc,rc));
    state.liked=(reactionRes.data||[]).filter(x=>same(x.user_id,uid)).map(x=>x.post_id);
    state.saved=(bookmarkRes.data||[]).map(x=>x.post_id);
    if(!memberRes.error)state.members=memberRes.data||[];
    if(!articleRes.error)state.articles=articleRes.data||[];
    if(!circleRes.error)state.circleRows=circleRes.data||[];
    state.platformReady=true;
    document.body.classList.toggle('is-admin',state.isAdmin);
    try{save()}catch(_){}
    return true;
  }

  async function ensureHealthy(reason){
    if(repairing||!document.visibilityState||document.visibilityState==='hidden')return;
    if(Date.now()-lastRepair<1200)return;
    repairing=true;lastRepair=Date.now();
    try{
      if(!sb&&typeof initSupabase==='function')await initSupabase();
      if(!sb)return;

      const sessionRes=await sb.auth.getSession();
      const session=sessionRes.data?.session||null;
      if(!session)return;
      authUser=session.user;

      let loaded=false;
      try{
        if(typeof loadLiveData==='function'){
          await Promise.race([
            loadLiveData(),
            new Promise((_,reject)=>setTimeout(()=>reject(new Error('live_data_timeout')),12000))
          ]);
          loaded=state.platformReady===true && Array.isArray(state.members) && state.members.length>0;
        }
      }catch(error){
        console.warn('[NEIS stability] normal load failed',reason,error);
      }

      if(!loaded)loaded=await directHydrate();
      if(!loaded)return;

      if(typeof setupBanner==='function')setupBanner=()=>'';
      document.querySelectorAll('.setup-banner').forEach(node=>node.remove());

      const raw=(location.hash||'#/home').replace(/^#\/?/,'').split('?')[0]||'home';
      if(raw==='home'&&typeof applyRoute==='function')applyRoute();
      else if(typeof render==='function')render();
    }catch(error){
      console.error('[NEIS stability] repair failed',reason,error);
    }finally{
      repairing=false;
    }
  }

  window.NEISEnsureHealthy=ensureHealthy;

  document.addEventListener('click',event=>{
    const home=event.target?.closest?.('[data-nav="home"]');
    if(!home||!authUser)return;
    event.preventDefault();
    event.stopImmediatePropagation();
    state.view='home';
    state.query='';
    state.activeConversationId='';
    state.activeCircleId='';
    state.activeProfileId='';
    if(location.hash==='#/home'){
      if(typeof applyRoute==='function')applyRoute();
      else if(typeof render==='function')render();
    }else{
      history.pushState(null,'','#/home');
      if(typeof applyRoute==='function')applyRoute();
      else if(typeof render==='function')render();
    }
    setTimeout(()=>ensureHealthy('home-click'),0);
  },true);

  window.addEventListener('focus',()=>ensureHealthy('focus'));
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')ensureHealthy('visible')});
  setTimeout(()=>ensureHealthy('startup'),250);
  setTimeout(()=>ensureHealthy('startup-retry'),1800);
})();