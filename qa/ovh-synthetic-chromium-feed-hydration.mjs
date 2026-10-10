import { chromium } from 'playwright';

const jwt=process.env.NEIS_BROWSER_TEST_TOKEN||'';
if(!/^eyJ[A-Za-z0-9_\-.]+$/.test(jwt))throw new Error('SYNTHETIC_JWT_MISSING');
const fakeId='00000000-0000-4000-8000-000000000000';
const browser=await chromium.launch({headless:true});
let failures=0;
try{
 for(const origin of ['https://neiscircle.site','https://www.neiscircle.site']){
  const context=await browser.newContext({serviceWorkers:'block'});
  const page=await context.newPage();
  const api=[];
  page.on('response',res=>{
   try{
    const u=new URL(res.url());
    if(u.hostname!=='supabase.neiscircle.site'||!u.pathname.startsWith('/rest/v1/'))return;
    const table=u.pathname.split('/').pop();
    if(!['posts','profiles','comments','reactions'].includes(table))return;
    api.push({table,status:res.status()});
   }catch{}
  });
  page.on('requestfailed',req=>{
   try{
    const u=new URL(req.url());
    if(u.hostname==='supabase.neiscircle.site'&&u.pathname.startsWith('/rest/v1/'))
     api.push({table:u.pathname.split('/').pop(),failed:true});
   }catch{}
  });
  try{
   await page.goto(origin,{waitUntil:'domcontentloaded',timeout:30000});
   await page.waitForFunction(()=>typeof window.NEISHydrateCore==='function'&&typeof sb!=='undefined'&&!!sb?.auth?.getSession,{timeout:25000});
   const result=await page.evaluate(async({jwt,fakeId})=>{
    const user={id:fakeId,user_metadata:{full_name:'Synthetic diagnostic'},app_metadata:{provider:'google'},aud:'authenticated'};
    const session={access_token:jwt,expires_at:Math.floor(Date.now()/1000)+100,user,token_type:'bearer'};
    sb.auth.getSession=async()=>({data:{session},error:null});
    authUser=user;
    state.onboardingComplete=true;
    state.view='home';
    state.members=[];
    state.posts=[];
    try{window.NEISProfileCache?.clear?.(fakeId)}catch{}
    let hydration=false;
    try{
     hydration=await Promise.race([
      window.NEISHydrateCore({force:true,reason:'synthetic-browser-readonly'}),
      new Promise((_,reject)=>setTimeout(()=>reject(new Error('HYDRATION_TIMEOUT')),25000))
     ]);
    }catch(e){return{status:'ERROR',errorClass:String(e?.name||'unknown').replace(/[^a-z]/gi,''),members:state.members?.length||0,posts:state.posts?.length||0}};
    return {status:hydration?'OK':'FAILED',members:state.members?.length||0,posts:state.posts?.length||0};
   },{jwt,fakeId});
   console.log('BROWSER_ORIGIN='+new URL(origin).hostname);
   console.log('BROWSER_HYDRATION='+JSON.stringify(result));
   console.log('BROWSER_REST_NETWORK='+JSON.stringify(api.slice(-18)));
   if(result.members<200||result.posts<100)failures++;
  }catch(e){
   console.log('BROWSER_ORIGIN='+new URL(origin).hostname);
   console.log('BROWSER_PROBE_FAILED='+String(e?.name||'unknown').replace(/[^a-z]/gi,''));
   failures++;
  }finally{await context.close()}
 }
}finally{await browser.close()}
console.log('BROWSER_PUBLIC_DATA_HYDRATION_PASS='+String(failures===0));
if(failures)process.exitCode=1;
