/* NEIS Circle: minimal activity signal. No analytics or behavior tracking. */
(()=>{
 'use strict';
 if(window.__neisActivityV1)return;
 window.__neisActivityV1=true;
 const interval=5*60*1000;
 let lastAttempt=0, inFlight=false;
 const authenticated=()=>typeof authUser!=='undefined'&&!!authUser?.id&&
   typeof state!=='undefined'&&state?.onboardingComplete===true&&
   typeof sb!=='undefined'&&!!sb;
 const isVisible=()=>document.visibilityState==='visible'&&document.body.classList.contains('app-ready');
 async function record(){
   if(!authenticated()||!isVisible()||inFlight)return;
   const now=Date.now();
   if(now-lastAttempt<interval)return;
   lastAttempt=now;
   inFlight=true;
   try{
     // PostgREST authenticates using the actual session JWT; the RPC
     // ignores client-provided user IDs and updates only auth.uid().
     const {error}=await sb.rpc('neis_mark_active');
     if(error)console.warn('[NEIS] Last-active update unavailable',error.code||'unknown');
   }catch(_){
     // Activity updates are best-effort and never block normal application use.
   }finally{inFlight=false}
 }
 let lastInteraction=0;
 function onInteraction(){
   const now=Date.now();
   if(now-lastInteraction<15000)return;
   lastInteraction=now;
   void record();
 }
 document.addEventListener('pointerdown',onInteraction,{passive:true});
 document.addEventListener('keydown',onInteraction,{passive:true});
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void record()});
 window.addEventListener('focus',()=>void record());
 const observer=new MutationObserver(()=>{
   if(document.body.classList.contains('app-ready'))void record();
 });
 observer.observe(document.body,{attributes:true,attributeFilter:['class']});
 // Initial signal after authenticated hydration, including active sessions.
 void record();
})();
